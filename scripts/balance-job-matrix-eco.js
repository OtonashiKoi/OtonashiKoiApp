"use strict";
/**
 * 全職業強度對照表 —— **玩家生態還原版**（第三版方法論，取代前兩版的缺陷）。
 *
 * 前兩版的問題：
 *   標準化版：一套裝逼所有職業穿 → 抹掉防具閃避 → 對「靠閃避活」的盜賊系系統性不利
 *   真實頂配版：混入玩家投資度（有人 +50 強化、有人裸裝、6 個職業沒人玩只能代配）
 *
 * 這一版的四個原則：
 *   ① 裝備是真的：從全服 Lv45+ 玩家抽「防具+飾品+卡片」真實模板庫（依總強化取前 8 套）
 *      —— 附魔、套裝、卡片都是遊戲裡真實存在的組合
 *   ② 每個職業穿最適合自己的：每職業試穿 8 套模板 × 3 種配點原型（攻/閃/坦）快篩取最佳
 *   ③ 跨場機制吃得到：連打序列 —— COMBO 隨勝敗累積（劍鬼吃得到連段與斬）、
 *      氣條/集氣跨場沿用、斬/血祭依策略自動施放
 *   ④ 多場景並列：世界王連打／中怪連打（勝率）／巨神震擊窗口
 *
 * 用法：node scripts/balance-job-matrix-eco.js [zoneKey]
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { createWorldBossSim } = require("./lib/simWorldBoss");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");
const zc = require("../src/shared/zoneCombo");
const bgm = require("../src/shared/berserkGauge");
const ja = require("../src/shared/jobAdvancement");
const { collectEquipmentEffects } = require("../src/shared/effectEngine");
const { scaleSupportPartyEffects } = require("../src/shared/supportAuraScaling");

const ZONE = process.argv[2] || "dragon_king_lair";
// 第 3 參數＝職業名過濾（regex）：只重測被改的職業、其他引用既有數字（省 token/時間）
const ONLY = process.argv[3] ? new RegExp(process.argv[3]) : null;
const SCREEN_RUNS = 40;       // 模板×配點快篩
const WB_SEQS = 30, WB_LEN = 10;   // 世界王連打
const MID_SEQS = 15, MID_LEN = 20; // 中怪連打
const STUN_RUNS = 200;             // 巨神震擊窗口

// 職業列：label / 徽章 / 武器型 / 主屬性 / 特性旗標
const ROWS = [
  ["一轉 劍士",        "job_swordsman_v1",       "sword_2h", "str", {}],
  ["二轉 聖劍士(攻)",   "job_holyblade_t2_v1",    "sword_2h", "str", { stance: "attack", t1: "job_swordsman_v1" }],
  ["二轉 聖劍士(防)",   "job_holyblade_t2_v1",    "sword_1h", "str", { stance: "defense", shield: true, t1: "job_swordsman_v1" }],
  ["二轉 劍鬼",        "job_swordoni_t2_v1",     "sword_2h", "str", { comboJob: true, t1: "job_swordsman_v1" }],
  ["一轉 戰士",        "job_warrior_v1",         "axe_2h",   "str", {}],
  ["二轉 狂戰士",      "job_berserker_t2_v1",    "axe_2h",   "str", { berserk: true, t1: "job_warrior_v1" }],
  ["二轉 狂戰士(血祭)", "job_berserker_t2_v1",    "axe_2h",   "str", { berserk: true, sacrifice: true, t1: "job_warrior_v1" }],
  ["一轉 矮人戰士",     "job_dwarf_warrior_v1",   "mace_2h",  "str", {}],
  ["二轉 矮人戰士長",   "job_dwarflord_t2_v1",    "mace_2h",  "str", { t1: "job_dwarf_warrior_v1" }],
  ["一轉 盜賊",        "job_rogue_v1",           "dagger",   "agi", { dual: true }],
  ["二轉 影舞者",      "job_shadowdancer_t2_v1", "dagger",   "agi", { dual: true, shadow: true, t1: "job_rogue_v1" }],
  ["一轉 法師",        "job_mage_v1",            "staff_2h", "int", {}],
  ["二轉 元素師(嵐暴)", "job_elementalist_t2_v1", "staff_2h", "int", { stance: "storm", t1: "job_mage_v1" }],
  ["二轉 元素師(炎圈)", "job_elementalist_t2_v1", "staff_2h", "int", { stance: "fire",  t1: "job_mage_v1" }],
  ["二轉 元素師(凍霜)", "job_elementalist_t2_v1", "staff_2h", "int", { stance: "frost", t1: "job_mage_v1" }],
  ["一轉 治療師",      "job_healer_v1",          "staff_1h", "int", { shield: true }],
  ["二轉 聖靈師",      "job_spiritmaster_t2_v1", "staff_1h", "int", { shield: true, spirit: true, t1: "job_healer_v1" }],
  ["一轉 弓箭手",      "job_archer_v1",          "bow",      "dex", {}],
  ["二轉 神射手",      "job_sniper_t2_v1",       "bow",      "dex", { sniperG: true, t1: "job_archer_v1" }],
  ["二轉 兵聖",        "job_sage_t2_v1",         "sword_1h", "int", { shield: true, sageG: true, t1: "job_tactician_v1" }],
  ["一轉 軍師",        "job_tactician_v1",       "sword_1h", "int", { shield: true }],
  ["一轉 詩人",        "job_bard_v1",            "bow",      "dex", {}],
  // 吟遊詩人：演奏是玩家操作技巧，模擬用固定假設——
  //   滿檔＝困難全對＋連奏5（傷害×1.92＋每場開場和弦350%）＝天花板；不演奏＝×1.0 素體對照
  ["二轉 吟遊詩人(滿檔演奏)", "job_minstrel_t2_v1", "bow",    "dex", { bardMult: 1.92, bardChord: 350, t1: "job_bard_v1" }],
  ["二轉 吟遊詩人(不演奏)",   "job_minstrel_t2_v1", "bow",    "dex", { t1: "job_bard_v1" }],
  ["一轉 結界師",      "job_barrier_mage_v1",    "staff_1h", "int", { shield: true }],
  // 聖域師：符文結界/共鳴反爆全在 combatLoop 內自動跑（吃徽章判定）；聖域窗口是區域條（eco 不計）
  ["二轉 聖域師",      "job_sanctum_t2_v1",      "staff_1h", "int", { shield: true, t1: "job_barrier_mage_v1" }],
  ["一轉 賭徒",        "job_gambler_v1",         "dice",     "luk", {}],
  // 賭神：魔法骰(破防25)在武器層自動生效；命運骰/手氣跨場串接走 diceG 旗標
  ["二轉 賭神",        "job_dicegod_t2_v1",      "dice",     "luk", { diceG: true, t1: "job_gambler_v1" }],
];

// 104 屬性點的三種原型
function attrBuilds(main) {
  const mk = (o) => ({ str: 10, agi: 10, vit: 10, int: 10, dex: 10, luk: 10, ...o });
  const builds = [];
  builds.push(["攻", mk({ [main]: 40, vit: 24 })]);                       // 40+24+40=104
  if (main === "agi") builds.push(["閃", mk({ agi: 44, vit: 20 })]);      // 44+20+40=104
  else builds.push(["閃", mk({ [main]: 30, agi: 30, vit: 14 })]);         // 30+30+14+30=104
  builds.push(["坦", mk({ [main]: 30, vit: 38, str: main === "str" ? 30 : 9, agi: 9, int: main === "int" ? 30 : 9, dex: main === "dex" ? 30 : 9, luk: main === "luk" ? 30 : 9 })]);
  // 坦型修正：上面寫法會重複,改手算
  builds[builds.length - 1] = ["坦", (() => { const a = mk({ [main]: 30, vit: 38 }); // 30+38 = 68, 其餘 4 屬各 9 = 36 → 104
    for (const k of ["str", "agi", "int", "dex", "luk"]) if (k !== main && k !== "vit") a[k] = 9;
    return a; })()];
  return builds;
}

const ARMOR_SLOTS = ["head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_l", "accessory_r", "title_eq", "special_1", "special_2", "special_3", "anchor"];

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const items = db.collection("items");
  // fresh:true＝滿血新王基準（live 狀態隨玩家攻打逐時變動，排行榜必須用固定基準才可跨場次比較）
  const sim = await createWorldBossSim(sc, db, ZONE, null, { fresh: true });

  // ── 模板庫：Lv45+ 玩家的防具組合,依總強化取前 8 套 ──
  const all = await db.collection("progress").find({ level: { $gte: 45 } }).toArray();
  const templates = all.map((p) => {
    const t = {};
    let enh = 0, pieces = 0;
    for (const slot of ARMOR_SLOTS) {
      const it = p.equipment?.[slot];
      if (!it) continue;
      t[slot] = JSON.parse(JSON.stringify(it));
      enh += Number(it.enhanceLevel) || 0;
      pieces++;
    }
    return { owner: p.playerId, t, enh, pieces, inventory: p.inventory || [], level: p.level };
  }).filter((x) => x.pieces >= 6).sort((a, b) => b.enh - a.enh).slice(0, 8);
  console.log(`\n【全職業強度對照・玩家生態還原版】${sim.info}`);
  console.log(`模板庫：${templates.length} 套真實防具（總強化 ${templates.map((t) => "+" + t.enh).join(" / ")}）`);
  console.log(`每職業：8 模板 × 3 配點快篩(${SCREEN_RUNS}場) → 世界王連打 ${WB_LEN}×${WB_SEQS}｜中怪連打 ${MID_LEN}×${MID_SEQS}｜窗口 ${STUN_RUNS} 場\n`);

  // 中怪
  const hell = await sc.monsterService.listMonsters({ includeDisabled: false, zone: "hellfire" });
  const wolf = hell.filter((m) => (m.calc?.maxHp || 0) > 3000).sort((a, b) => b.calc.maxHp - a.calc.maxHp)[0];

  // 武器準備
  const weaponCache = {};
  const getWeapon = async (wt) => {
    if (!weaponCache[wt]) {
      // ⚠️ 每類 S 武器有 3 把（龍系/獄焰/真銀），findOne 看 DB 自然順序＝文件一更新就換人，
      // 曾造成 STR 系整線輸出跨場次掉 3 倍的假象。固定挑基礎攻擊最高的那把（頂配玩家的合理選擇）。
      const list = await items.find({ weaponType: wt, tier: "S" }).toArray();
      list.sort((a, b) => (Number(b?.effect?.value) || 0) - (Number(a?.effect?.value) || 0));
      weaponCache[wt] = list[0] || null;
    }
    return weaponCache[wt];
  };
  const offDagger = await items.findOne({ weaponType: "offhand_dagger", tier: "A" });
  const shieldItem = await items.findOne({ equipSlot: "shield", tier: "A", weaponType: null });

  const buildEquip = async (tpl, badgeId, wt, flags) => {
    const badge = await items.findOne({ id: badgeId });
    const weapon = await getWeapon(wt);
    const eq = JSON.parse(JSON.stringify(tpl.t));
    eq.job_eq = { ...badge, itemId: badge.id, itemName: badge.name, uuid: "eco-b" };
    eq.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name, uuid: "eco-w", enhanceLevel: 5 };
    delete eq.offhand; delete eq.shield;
    if (flags.dual && offDagger) eq.shield = { ...offDagger, itemId: offDagger.id, itemName: offDagger.name, uuid: "eco-o", enhanceLevel: 5 };
    if (flags.shield && shieldItem) eq.shield = { ...shieldItem, itemId: shieldItem.id, itemName: shieldItem.name, uuid: "eco-s", enhanceLevel: 5 };
    return eq;
  };

  // 一場戰鬥（含職業特性狀態機）。ctx 保存跨場狀態。
  const battleOnce = (progress, eq, flags, ctx, target /* null=世界王 */, extraBase = {}) => {
    const benefits = Boolean(flags.comboJob);
    const comboEffects = benefits ? zc.comboBuffs(ctx.combo) : [];
    const extras = { ...extraBase, playerActiveEffects: [...comboEffects], zoneComboCount: ctx.combo };
    // 自己的隊伍光環（治療師回血/軍師增傷等）——正式環境的戰鬥本來就含自己的光環，
    // 舊版 eco 漏帶 → 光環職業（治療/軍師/兵聖/聖靈師）一直被低估。掩護射擊已在 combatLoop 內排除自我。
    if (ctx._selfAura === undefined) {
      const _ps0 = ctx.ps || (ctx.ps = calcPlayerStats(progress.attributes, eq, [], progress.inventory || [], {}));
      const _raw = collectEquipmentEffects(eq, "passive", { equipped: eq, inventory: progress.inventory || [] })
        .filter((e) => e.target === "party")
        .map((e) => ({ ...e, isSelfAura: true, sourceName: "自己", sourceJobName: e.srcItem || "" }));
      ctx._selfAura = _raw.length ? scaleSupportPartyEffects(_raw, { providerStats: _ps0, equipped: eq }) : null;
    }
    if (ctx._selfAura) extras.partyEffects = ctx._selfAura;
    let consumed = false;
    if (flags.shadow) extras.shadowGaugeGrids = ctx.grids;
    if (flags.berserk) {
      const full = ctx.gauge >= 5;
      if (full) {
        extras.warGaugeCritBonus = 30;
        extras.playerActiveEffects.push(...bgm.buffs({ critRateBonus: 30 }));
      }
      ctx._gaugeFull = full;
    }
    if (flags.sacrifice) {
      extras.sacrificeHpCostPct = 30;
      extras.sacrificeAtkUpPct = 25;
      extras.playerActiveEffects.push(...bgm.sacrificeBuffs({ atkUpPct: 25 }));
    }
    if (flags.stance) extras.stance = flags.stance;
    // 聖靈師：精靈血量跨場串接（倒下 → 下一場 50% 重召，仿 sunSpirit.read）
    if (flags.spirit) extras.sunSpiritHpPct = ctx.spiritPct == null ? 100 : (ctx.spiritPct <= 0 ? 50 : ctx.spiritPct);
    // 神射手：震盪值跨場串接（掩護射擊是利他機制，不在自己場內、eco 不計）
    if (flags.sniperG) extras.sniperGaugeGrids = ctx.sniperGrids || 0;
    // 兵聖：計謀值跨場串接（知彼/教學相長走 route 層圖鑑，eco 不計）
    if (flags.sageG) extras.sageGaugeGrids = ctx.sageGrids || 0;
    // 賭神：命運骰格數＋手氣層跨場串接
    if (flags.diceG) {
      extras.diceGaugeGrids = ctx.diceGrids || 0;
      extras.diceLuckStacks = ctx.diceLuck || 0;
    }
    // 吟遊詩人：演奏倍率＋開場完美和弦（固定假設，見 ROWS 註解）
    if (flags.bardMult) {
      extras.bardDamageMult = flags.bardMult;
      if (flags.bardChord) extras.bardChordPct = flags.bardChord;
    }

    let r;
    if (!target) {
      r = sim.single(progress, { equipment: eq, extraOptions: extras });
    } else {
      const ps = ctx.ps || (ctx.ps = calcPlayerStats(progress.attributes, eq, [], progress.inventory || [], {}));
      r = runCombatLoop(ps, target.calc, target.name, target.calc.maxHp, 15, {
        playerLevel: 50, equipped: eq, inventory: progress.inventory || [],
        monsterIsBoss: !!(target.isBoss || target.calc?.isBoss), monsterEquipped: target.equipment || {},
        ...extras,
      });
    }
    // 跨場狀態更新
    const outcome = r.outcome;
    const nx = zc.nextCombo(ctx.combo, "eco", outcome, Date.now(), {
      hasDeathGuard: benefits, diedOnce: ctx.diedOnce, consumed,
    });
    ctx.combo = nx.count; ctx.diedOnce = nx.diedOnce;
    if (flags.shadow) ctx.grids = Number(r.shadowGauge) || 0;
    if (flags.berserk) ctx.gauge = ctx._gaugeFull ? 1 : Math.min(5, ctx.gauge + 1);
    if (flags.spirit) ctx.spiritPct = Number(r.sunSpirit?.hpPct) || 0;
    if (flags.sniperG) ctx.sniperGrids = Number(r.sniperGauge) || 0;
    if (flags.sageG) ctx.sageGrids = Number(r.sageGauge) || 0;
    if (flags.diceG) { ctx.diceGrids = Number(r.diceGauge) || 0; ctx.diceLuck = Number(r.diceLuck) || 0; }
    return r;
  };

  const runSeq = (progress, eq, flags, seqs, len, target) => {
    let dmg = 0, deaths = 0, wins = 0, rounds = 0;
    for (let s0 = 0; s0 < seqs; s0++) {
      const ctx = { combo: 0, diedOnce: false, grids: 0, gauge: 0, ps: null };
      for (let i = 0; i < len; i++) {
        const r = battleOnce(progress, eq, flags, ctx, target);
        dmg += r.totalDamage || 0;
        rounds += (r.nextRound || 2) - 1;
        if (r.outcome === "lose") deaths++;
        if (r.outcome === "win") wins++;
      }
    }
    const N = seqs * len;
    return { avg: dmg / N, death: deaths / N, win: wins / N, rounds: rounds / N };
  };

  const rows = [];
  for (const [label, badgeId, wt, main, flags] of ROWS) {
    if (ONLY && !ONLY.test(label)) continue;
    // ── 快篩（兩段式）：8 模板 × 3 配點 ──
    // 40 場的單段快篩雜訊太大：同職業早晚跑會選出不同配點原型（法師坦型存活 8.7 回合 vs
    // 攻型 3.4 回合），整張表跟著大幅波動。改成 40 場粗篩取前 3 → 各 160 場複篩定案。
    const screenCands = [];
    for (const tpl of templates) {
      const eq = await buildEquip(tpl, badgeId, wt, flags);
      for (const [aName, attrs] of attrBuilds(main)) {
        const prog = { playerId: "eco", level: 50, attributes: attrs, equipment: eq, inventory: tpl.inventory };
        const r = sim.run(prog, { runs: SCREEN_RUNS, equipment: eq, extraOptions: flags.stance ? { stance: flags.stance } : {} });
        screenCands.push({ dmg: r.avgDmg, tpl, eq, attrs, aName, prog });
      }
    }
    screenCands.sort((a, b) => b.dmg - a.dmg);
    let best = null;
    for (const cand of screenCands.slice(0, 3)) {
      const r = sim.run(cand.prog, { runs: SCREEN_RUNS * 4, equipment: cand.eq, extraOptions: flags.stance ? { stance: flags.stance } : {} });
      if (!best || r.avgDmg > best.dmg) best = { ...cand, dmg: r.avgDmg };
    }
    const prog = { playerId: "eco", level: 50, attributes: best.attrs, equipment: best.eq, inventory: best.tpl.inventory };
    // ── 正式：世界王連打／中怪連打／窗口 ──
    const wb = runSeq(prog, best.eq, flags, WB_SEQS, WB_LEN, null);
    const mid = runSeq(prog, best.eq, flags, MID_SEQS, MID_LEN, wolf);
    const stun = sim.run(prog, { runs: STUN_RUNS, equipment: best.eq, extraOptions: {
      teamStunRounds: 999,
      ...(flags.stance ? { stance: flags.stance } : {}),
      ...(flags.bardMult ? { bardDamageMult: flags.bardMult, bardChordPct: flags.bardChord || 0 } : {}), // 巨神窗口也要吃演奏
    } });
    rows.push({ label, build: `${best.aName}型/+${best.tpl.enh}`, wb, mid, stunDmg: stun.avgDmg, badgeId, t1: flags.t1 });
    console.log(`  ✔ ${label}（${best.aName}型・模板+${best.tpl.enh}）`);
  }

  // ── 輸出 ──
  rows.sort((a, b) => b.wb.avg - a.wb.avg);
  const topWb = rows[0].wb.avg;
  const topMid = Math.max(...rows.map((r) => r.mid.avg));
  const topStun = Math.max(...rows.map((r) => r.stunDmg));
  const t1Map = Object.fromEntries(rows.filter((r) => !r.t1).map((r) => [r.badgeId, r.wb.avg]));
  console.log("\n職業                 配裝      ┃ 世界王連打：存活 陣亡%   均傷    相對  vs一轉 ┃ 中怪連打：均傷   勝率  相對 ┃ 巨神窗口   相對");
  console.log("─".repeat(128));
  for (const r of rows) {
    const uplift = r.t1 && t1Map[r.t1] ? (r.wb.avg / t1Map[r.t1]).toFixed(2) + "x" : "  —  ";
    console.log(
      `${r.label.padEnd(18)} ${r.build.padEnd(9)} ┃ ${r.wb.rounds.toFixed(1).padStart(4)} ${(r.wb.death * 100).toFixed(0).padStart(4)}% ` +
      `${Math.round(r.wb.avg).toLocaleString().padStart(8)} ${(r.wb.avg / topWb).toFixed(2)}x ${uplift.padStart(6)} ┃ ` +
      `${Math.round(r.mid.avg).toLocaleString().padStart(8)} ${(r.mid.win * 100).toFixed(0).padStart(4)}% ${(r.mid.avg / topMid).toFixed(2)}x ┃ ` +
      `${Math.round(r.stunDmg).toLocaleString().padStart(9)} ${(r.stunDmg / topStun).toFixed(2)}x`
    );
  }
  console.log("─".repeat(128));
  console.log("配裝欄＝快篩選出的最佳配點原型/模板總強化。模板為真實玩家防具（含附魔/套裝/卡片），各職業自選最合身的一套。");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
