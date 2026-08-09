"use strict";
/**
 * 世界王戰鬥模擬器 —— **忠實複製線上真實呼叫點**。
 *
 * 為什麼要有這支：先前每次做平衡測試都是手刻 runCombatLoop 的參數，
 * 結果一路漏東西，量出來的數字一再失真：
 *   ① mHpInit 傳整隻王的滿血（實際是打「部位」）→ 毒傷灌水 3 倍
 *   ② 沒傳 isWorldBoss → **DOT 完全沒吃到王的 def%**（毒傷再灌水約 2 倍）
 *   ③ 沒套 worldBossPhase（階段 atk×/def×）
 *   ④ 沒套 applyWorldBossTargetToMonster / ToPlayerStats（部位修正）
 *   ⑤ 沒套古龍王破鱗削弱
 *   ⑥ 沒傳 zone → 裝備的區域條件特效（S 龍系武器在龍王巢穴 +20%）沒生效
 *   ⑦ 沒傳 monsterElement → 屬性相剋沒算
 * 以後所有世界王平衡測試都走這裡，不要再自己拼 options。
 *
 * 對照來源：src/bot/handlers/monsterZoneHandlers.js 的出戰流程（約 2855~3040 行）。
 */
const { runCombatLoop } = require("../../src/shared/combatLoop");
const { calcPlayerStats } = require("../../src/shared/combatStats");
const jbo = require("./jobBattleOptions");

/**
 * 建立一個綁定某隻世界王的模擬器。
 * @param {object} sc      createServiceContext()
 * @param {object} db      getMongoDb()
 * @param {string} zoneKey 例：dragon_king_lair / elite / hellfire_depths
 * @param {string} part    要打的部位（預設挑第一個沒破的）
 * @param {object} opts    { fresh:true } ＝ 用「滿血新王」（全部位滿血、無破鱗、100% 階段）——
 *                         平衡測試一律用這個！live 狀態會隨玩家攻打逐時變動（階段強化/部位破壞削弱），
 *                         曾造成「排行榜每跑一次數字都不同」的假象（2026-07-23 教訓）。
 */
async function createWorldBossSim(sc, db, zoneKey, part = null, opts = {}) {
  const handlers = require("../../src/bot/handlers/monsterZoneHandlers");
  const list = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
  const boss = list.find((m) => m.isBoss || m.calc?.isBoss);
  if (!boss) throw new Error(`${zoneKey} 找不到世界王`);

  const stateDoc = await db.collection("monsters").findOne({ _id: `monsterState:${zoneKey}` });
  const state = stateDoc?.value || {};
  const fresh = Boolean(opts.fresh);
  const partsHp = fresh
    ? { ...(state.worldBossPartsMaxHp || state.worldBossPartsHp || {}) }
    : (state.worldBossPartsHp || {});
  const targetPart = part || Object.keys(partsHp).find((k) => Number(partsHp[k]) > 0) || Object.keys(partsHp)[0] || "head";
  const partHp = Math.max(1, Number(partsHp[targetPart]) || boss.calc.maxHp);

  // 階段修正（依整王剩餘血量百分比）
  const wbSvc = sc.worldBossServiceFor(zoneKey);
  let monsterStats = boss.calc;
  let phase = null;
  if (wbSvc) {
    const cfg = await wbSvc.getConfig();
    const totalMax = Object.values(state.worldBossPartsMaxHp || {}).reduce((s, v) => s + (Number(v) || 0), 0) || boss.calc.maxHp;
    const totalNow = fresh ? totalMax : (Object.values(partsHp).reduce((s, v) => s + (Number(v) || 0), 0) || totalMax);
    phase = wbSvc.resolvePhase(cfg, totalMax > 0 ? (totalNow / totalMax) * 100 : 100);
    if (phase) {
      monsterStats = {
        ...boss.calc,
        atk: Math.max(1, Math.round((boss.calc.atk || 0) * Math.max(0.1, Number(phase.atkMultiplier || 1)))),
        def: Math.max(0, Math.min(75, (boss.calc.def || 0) * Math.max(0.1, Number(phase.defMultiplier || 1)))),
      };
    }
  }

  return {
    zoneKey, part: targetPart, partHp, boss, phase,
    info: `${boss.name}${fresh ? "（滿血新王基準）" : "（live 狀態）"}・${targetPart}｜部位HP ${partHp.toLocaleString()}｜atk${monsterStats.atk} def${monsterStats.def} flatDef${monsterStats.flatDef}${phase ? `｜階段 atk×${phase.atkMultiplier} def×${phase.defMultiplier}` : ""}`,

    /**
     * 跑 N 場，回傳統計。
     * @param {object} progress 玩家 progress 文件
     * @param {object} opts     { runs, equipmentOverride, extraOptions }
     */
    /**
     * 單場：回傳原始 runCombatLoop 結果（含 shadowGauge/combatStats 等），
     * 給「連打序列」逐場追蹤氣條/連段用。忠實度調整與 run() 完全相同。
     */
    single(progress, { equipment = null, extraOptions = {} } = {}) {
      const agg = this.run(progress, { runs: 1, equipment, extraOptions, _raw: true });
      return agg;
    },

    run(progress, { runs = 200, equipment = null, extraOptions = {}, _raw = false } = {}) {
      const eq = equipment || progress.equipment || {};
      let pStats = calcPlayerStats(progress.attributes || {}, eq, [], progress.inventory || [], { pkRating: progress.pkRating });
      let mStats = monsterStats;
      let mEquipped = boss.equipment || {};

      // 部位修正（玩家側與怪物側）
      const adjP = handlers.applyWorldBossTargetToPlayerStats(pStats, targetPart, zoneKey);
      if (adjP?.stats) pStats = adjP.stats;
      const adjM = handlers.applyWorldBossTargetToMonster(mStats, mEquipped, targetPart, zoneKey);
      if (adjM?.monsterStats) mStats = adjM.monsterStats;
      if (adjM?.monsterEquipped) mEquipped = adjM.monsterEquipped;
      // 古龍王：依已破壞部位套破鱗削弱
      if (handlers.applyDragonKingBreakWeaken && zoneKey === "dragon_king_lair") {
        const w = handlers.applyDragonKingBreakWeaken(mStats, mEquipped, partsHp);
        if (w?.monsterStats) mStats = w.monsterStats;
        if (w?.monsterEquipped) mEquipped = w.monsterEquipped;
      }

      // 職業完整戰鬥參數（自我光環＋所有身分技氣條）——單一來源 jobBattleOptions，
      // 不在這裡手拼。呼叫端顯式傳的 extraOptions 仍然優先（覆寫在下方展開順序）。
      const jobOpts = jbo.buildBattleOptions({
        equipped: eq, pStats, inventory: progress.inventory || [],
        ctx: extraOptions?._ctx || null, stance: extraOptions?.stance || null,
      });

      const acc = { dmg: 0, poison: 0, dotTotal: 0, deaths: 0, rounds: 0, hits: 0, taken: 0, wins: 0, maxHit: 0, maxHitSum: 0, assistBySource: {} };
      let lastRaw = null;
      for (let i = 0; i < runs; i++) {
        const r = runCombatLoop(pStats, mStats, boss.name, partHp, undefined, {
          playerLevel: progress.level || 1,
          equipped: eq,
          inventory: progress.inventory || [],
          monsterEquipped: mEquipped,
          monsterIsBoss: true,
          isWorldBoss: true,              // ← 關鍵：DOT 才會吃王的 def%
          worldBossPhase: phase || null,
          zone: zoneKey,                  // ← 裝備的區域條件特效
          monsterElement: boss.element || null,
          playerActiveEffects: [],
          ...jobOpts,
          ...extraOptions,
        });
        acc.dmg += r.totalDamage || 0;
        acc.taken += r.damageTaken || 0;
        acc.hits += r.combatStats?.attackCount || 0;
        acc.rounds += (r.nextRound || 2) - 1;
        if (r.outcome === "lose") acc.deaths++;
        if (r.outcome === "win") acc.wins++;
        const mh = Number(r.maxHitTaken) || 0;
        acc.maxHitSum += mh;
        if (mh > acc.maxHit) acc.maxHit = mh;
        // KDA 助攻歸戶累加（combatLoop 原生 assistLedger＝與正式計分同源）
        for (const [sid, amt] of Object.entries(r.assistLedger?.bySource || {})) {
          acc.assistBySource[sid] = (acc.assistBySource[sid] || 0) + (Number(amt) || 0);
        }
        const t = JSON.stringify(r.roundLogs);
        for (const m of (t.match(/受到 \*\*(\d+)\*\* 點毒素/g) || [])) acc.poison += Number(m.match(/(\d+)/)[1]);
        lastRaw = r;
      }
      if (_raw) return lastRaw;
      return {
        atk: pStats.atk, maxHp: pStats.maxHp, combo: pStats.combo, crit: pStats.crit,
        avgDmg: acc.dmg / runs,
        avgPoison: acc.poison / runs,
        poisonPct: acc.dmg > 0 ? (acc.poison / acc.dmg) * 100 : 0,
        deathRate: acc.deaths / runs,
        avgRounds: acc.rounds / runs,
        avgTaken: acc.taken / runs,
        maxHit: acc.maxHit,               // 全部場次中最痛的一擊（爆發條件驗收用）
        avgMaxHit: acc.maxHitSum / runs,  // 每場最痛一擊的平均
        // 場均助攻歸戶（提供者 → 當量/場）：與正式 KDA 計分同源（combatLoop assistLedger）
        avgAssistBySource: Object.fromEntries(Object.entries(acc.assistBySource).map(([k, v]) => [k, v / runs])),
      };
    },
  };
}

module.exports = { createWorldBossSim };
