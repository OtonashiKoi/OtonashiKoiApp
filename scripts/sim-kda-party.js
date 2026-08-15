"use strict";
/**
 * KDA 貢獻榜預演：全職業「同場共打一王」模擬。
 *
 * 情境（使用者指定）：17 職業全員參戰、技能被動全開、同階裝備（S 武器＋中和防具）、
 * 同一套配點模式（主屬性 40／VIT 24／其餘 10）——公平比較基準與 balance-job-matrix 一致。
 *
 * 演算法（v3・2026-08-07 改為與正式計分同源）：
 *   K_i ＝ 職業 i 在「全光環世界」的場均輸出（含 DoT）
 *   A_p ＝ **直接彙總 combatLoop 原生 assistLedger 歸戶**（Σ 全隊每場 avgAssistBySource[p]）——
 *          與上線 KDA 計分一模一樣的管線（含 B 案同 key 按值比例分帳），不再用留一法另算一套。
 *   D_i ＝ 全光環世界的陣亡率 → 存活係數 = max(0.5, 1 − max(0, 死亡率−免責10%) × 0.8)
 *   排名 C ＝ (K + 0.7×A) × 存活係數
 *
 * v2（2026-08-07 使用者指示補齊）：
 *   ‧ 吟遊詩人（詩人二轉）入列，隊伍光環吃連奏倍率 auraMult(streak=3)=×1.6（穩定中手假設）
 *   ‧ 矮人戰士長「巨神震擊」窗口攤提進 A：他場均 R 回合敲條、門檻 300 → 每場開窗機率 R/300，
 *     開窗時假設全隊各打 1 場，正式公式按受益玩家有效輸出的 10% 給控制助攻。
 *   ‧ 排名公式（使用者定案 2026-08-07）：C = (K + 0.7×A) × 存活係數；另出 K 榜／A 榜分榜
 *
 * 用法：RUNS=400 node scripts/sim-kda-party.js [zoneKey]
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { createWorldBossSim } = require("./lib/simWorldBoss");
const { withSeed } = require("./lib/seededRandom");
const { JOBS, PRESETS, buildAttrs, buildEquipment, buildExtraOptions } = require("./lib/survivalPresets");
const { collectEquipmentEffects } = require("../src/shared/effectEngine");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { scaleSupportPartyEffect } = require("../src/shared/supportAuraScaling");

const RUNS = Number(process.env.RUNS) || 400;
const ZONE = process.argv[2] || "dragon_king_lair";
const BASE_PLAYER = "386854676433207318";
// PRESET=hybrid 可切換全員配點世界（output=玻璃砲測試、hybrid=貼近實戰的生存配點）
const OUTPUT_PRESET = PRESETS.find((p) => p.key === (process.env.PRESET || "output"));
const EXEMPT_DEATH = 0.10; // KDA 免責門檻（設計文件假設值）
const A_WEIGHT = 0.7;      // A 打折係數（使用者定案 2026-08-07）
const BARD_STREAK = 3;     // 吟遊詩人連奏假設（穩定中手；滿檔 5、生手 0）
// RESIST=full：防具插滿怪物同屬性石（與 balance-survival-matrix 同開關）
const RESIST_MODE = String(process.env.RESIST || "none");

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const items = db.collection("items");
  const sim = await createWorldBossSim(sc, db, ZONE, null, { fresh: true });
  const base = await db.collection("progress").findOne({ playerId: BASE_PLAYER });

  // ── 準備職業名單：裝備、屬性、隊伍光環 ──
  const roster = [];
  for (const job of JOBS) {
    const [label, , wt, mainStat] = job;
    const eq = await buildEquipment(items, base.equipment, job, OUTPUT_PRESET);
    if (!eq) { console.log(`⚠️ 跳過 ${label}（缺裝備）`); continue; }
    // 七屬性抗性：RESIST=full 時防具依階級洞數插滿怪物同屬性石
    if (RESIST_MODE === "full" && sim.boss.element) {
      const { ARMOR_SLOTS, getElementSocketCapacity } = require("../src/shared/elementSystem");
      for (const slot of ARMOR_SLOTS) {
        const it = eq[slot];
        if (!it) continue;
        const cap = getElementSocketCapacity(it.tier);
        if (cap > 0) eq[slot] = { ...it, elements: { [sim.boss.element]: cap } };
      }
    }
    const attrs = buildAttrs(mainStat, OUTPUT_PRESET);
    const stats = calcPlayerStats(attrs, eq, [], base.inventory || [], {});
    // 隊伍光環：與 DC 出戰流程同源——裝備被動效果中 target==='party' 的，經提供者屬性縮放
    const auras = [];
    try {
      // 吟遊詩人：隊伍光環吃連奏倍率（與 DC 出戰流程同規則）
      const bardSong = require("../src/shared/bardSong");
      const _bardMult = bardSong.hasSong?.(eq.job_eq) ? bardSong.auraMult(BARD_STREAK) : 1;
      for (const ef of collectEquipmentEffects(eq, "passive", { equipped: eq, inventory: [], zone: ZONE })) {
        if (!ef || ef.target !== "party") continue;
        const boosted = _bardMult > 1 ? {
          ...ef,
          value: ef.value != null ? Number(ef.value) * _bardMult : ef.value,
          params: { ...(ef.params || {}), value: (Number(ef.params?.value ?? ef.value ?? 0)) * _bardMult },
        } : ef;
        const scaled = scaleSupportPartyEffect(boosted, { providerStats: stats, jobName: label, equipped: eq });
        // isSelfAura:false + sourceDiscordId ＝ 正式歸戶管線（assistLedger）認得的外部提供者格式
        auras.push({ ...scaled, sourceName: label, sourceJobName: label, isSelfAura: false, sourceDiscordId: label });
      }
    } catch (_) { /* 光環蒐集失敗視為無光環 */ }
    roster.push({ label, job, eq, attrs, auras, extraOptions: buildExtraOptions(job) });
  }

  const allAuras = roster.flatMap((r) => r.auras);
  const providers = roster.filter((r) => r.auras.length > 0);
  console.log(`\n【KDA 團戰預演】${sim.info}`);
  console.log(`${roster.length} 職業全員參戰｜每格 ${RUNS} 場｜光環提供者 ${providers.length} 名：${providers.map((p) => `${p.label}(${p.auras.length})`).join("、")}\n`);

  // ── 跑一個「世界」：指定光環集合下，全隊各自的場均輸出 ──
  function runWorld(auraSet, excludeLabel = null) {
    const out = new Map();
    for (const r of roster) {
      const progress = { ...base, attributes: r.attrs, equipment: r.eq };
      const res = withSeed(`kda:${r.label}:${RUNS}`, () =>
        sim.run(progress, { runs: RUNS, equipment: r.eq, extraOptions: { ...r.extraOptions, partyEffects: auraSet } })
      );
      out.set(r.label, res);
      process.stdout.write(".");
    }
    console.log(excludeLabel ? ` （無 ${excludeLabel} 世界）` : " （全光環世界）");
    return out;
  }

  const full = runWorld(allAuras);

  // ── A ＝ 彙總正式歸戶（assistLedger）：全隊每個職業場均分給各提供者的當量加總 ──
  //    自己打的場次不會分給自己（combatLoop 不可自益），這裡把「提供者＝自己職業」的份濾掉再加總。
  const assist = new Map(roster.map((r) => [r.label, 0]));
  for (const r of roster) {
    const res = full.get(r.label);
    for (const [src, amt] of Object.entries(res.avgAssistBySource || {})) {
      if (src === r.label) continue;
      assist.set(src, (assist.get(src) || 0) + (Number(amt) || 0));
    }
  }

  // ── 巨神震擊窗口攤提（矮人戰士長的 A）──
  // 他場均 R 回合＝敲條 R 點，門檻 300 → 每場期望開窗 R/300 次；
  // 正式控制助攻池＝窗口內受益玩家有效輸出的 10%，不是用「少受多少傷」反推。
  const dl = roster.find((r) => r.label.includes("矮人戰士長"));
  if (dl) {
    const { thresholdFor } = require("../src/shared/dwarfStunGauge");
    const { CONTROL_WINDOW_ASSIST_PCT } = require("../src/shared/supportContribution");
    const th = thresholdFor(ZONE);
    const dlRounds = full.get(dl.label).avgRounds || 0;
    const fullWindowAssist = roster
      .filter((r) => r.label !== dl.label)
      .reduce((sum, r) => sum + (Number(full.get(r.label)?.avgDmg) || 0) * CONTROL_WINDOW_ASSIST_PCT / 100, 0);
    const perBattleWindows = dlRounds / th;
    assist.set(dl.label, (assist.get(dl.label) || 0) + perBattleWindows * fullWindowAssist);
    console.log(` （巨神震擊窗口：場均 ${dlRounds.toFixed(1)} 敲/門檻 ${th} ＝ 每場 ${(perBattleWindows * 100).toFixed(1)}% 開窗率｜滿窗 A ${Math.round(fullWindowAssist).toLocaleString()}）`);
  }

  // ── 組 KDA 榜（C = (K + 0.7A) × 存活係數，使用者定案 2026-08-07）──
  const rows = roster.map((r) => {
    const f = full.get(r.label);
    const K = f.avgDmg || 0;
    const A = assist.get(r.label) || 0;
    const dr = f.deathRate || 0;
    const coef = Math.max(0.5, 1 - Math.max(0, dr - EXEMPT_DEATH) * 0.8);
    return { label: r.label, K, A, dr, rounds: f.avgRounds, coef, C: (K + A_WEIGHT * A) * coef };
  }).sort((a, b) => b.C - a.C);

  const fmt = (n) => Math.round(n).toLocaleString();
  console.log("\n══ 綜合榜　C = (K + 0.7×A) × 存活係數 ══");
  console.log("名次  職業                K(場均輸出)  A(場均助攻)   D(陣亡)  存活係數   貢獻分C");
  console.log("─".repeat(88));
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(3)}   ${r.label.padEnd(18)} ${fmt(r.K).padStart(10)} ${fmt(r.A).padStart(12)} ${(r.dr * 100).toFixed(0).padStart(7)}% ${r.coef.toFixed(2).padStart(8)} ${fmt(r.C).padStart(10)}`
    );
  });
  console.log("─".repeat(88));
  const kBoard = [...rows].sort((a, b) => b.K - a.K).slice(0, 5);
  const aBoard = [...rows].filter((r) => r.A > 0).sort((a, b) => b.A - a.A);
  console.log(`\n══ K 榜（輸出）前五 ══`);
  kBoard.forEach((r, i) => console.log(`${i + 1}. ${r.label} ${fmt(r.K)}`));
  console.log(`\n══ A 榜（助攻）══`);
  aBoard.forEach((r, i) => console.log(`${i + 1}. ${r.label} ${fmt(r.A)}`));
  const totalK = rows.reduce((s, r) => s + r.K, 0);
  console.log(`\n全隊場均總輸出 ${fmt(totalK)}｜A 總量 ${fmt(rows.reduce((s, r) => s + r.A, 0))}（占 ${((rows.reduce((s, r) => s + r.A, 0) / totalK) * 100).toFixed(1)}%）`);
  console.log(`免責門檻 ${EXEMPT_DEATH * 100}%｜A 權重 ${A_WEIGHT}｜吟遊詩人連奏假設 ${BARD_STREAK} 層`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
