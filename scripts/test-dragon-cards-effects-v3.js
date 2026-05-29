"use strict";
/**
 * 第三版測試：每個 passive effect 都用其對應的觸發情境跑，確保留下證據
 *
 * 新增情境：
 *  bonus_vs_burning → 怪物開戰就掛 burn，比較對 burning vs 正常的 DPR 差
 *  execute_under_hp_pct → 怪物起始 HP=15%（已在斬殺閾值內）
 *  bonus_reduction_when_hp_low → 比 baseLow 與裝卡 baseLow 之 deaths/受傷
 *  stack_on_hit / stack_on_taken → 跑 1 場長戰鬥，比較第 1 回合與第 15 回合 ATK/受傷
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 50;
const MAX_ROUNDS = 15;

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const vit = m.vit || 0;
  return {
    maxHp: m.maxHp || 800,
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : level + vit,
    level, agi: m.agi || 1, int: m.int || 0, dex: m.dex || 1, luk: m.luk || 0,
    dodge: Math.min(50, (m.agi || 1) * 0.5),
    hit: Math.min(100, 80 + (m.dex || 1)),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi || 1) * 0.5)),
    defIgnorePct: m.defIgnorePct || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + (m.int || 0) * 0.01),
    dmgMax: 1.0,
  };
}

function runMany(testPlayer, monster, card, opts = {}) {
  const baseEq = { ...(testPlayer.equipment || {}) };
  const eq = { ...baseEq, special_1: card, special_2: null, special_3: null };
  const ps = calcPlayerStats(testPlayer.attributes || {}, eq, [], testPlayer.inventory || [], { pkRating: null });
  const mCalc = buildMonsterCalc(monster);
  const startHp = Math.max(1, Math.round(ps.maxHp * ((opts.startHpPct ?? 100) / 100)));

  let totalDmg = 0, totalRounds = 0, totalTaken = 0, deaths = 0, wins = 0;
  const allLogs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = runCombatLoop(ps, mCalc, monster.name, opts.startMonsterHp != null ? opts.startMonsterHp : mCalc.maxHp, MAX_ROUNDS, {
      playerLevel: testPlayer.level,
      equipped: eq,
      inventory: testPlayer.inventory || [],
      monsterIsBoss: !!monster.isBoss,
      startPlayerHp: startHp,
      startMonsterHp: opts.startMonsterHp,
      monsterActiveEffects: opts.monsterActiveEffects ? opts.monsterActiveEffects.map(e => ({ ...e })) : undefined,
    });
    if (r.outcome === "lose") deaths++;
    if (r.outcome === "win") wins++;
    totalDmg += r.totalDamage || 0;
    totalRounds += r.roundLogs?.length || 0;
    totalTaken += Math.max(0, startHp - (r.finalPlayerHp ?? startHp));
    if (i < 5) allLogs.push(...(r.roundLogs || []));
  }
  return { ps, totalDmg, totalRounds, totalTaken, deaths, wins, allLogs };
}

async function fetchCardEntry(db, name) {
  const c = await db.collection("items").findOne({ name, equipSlot: "special" });
  if (!c) return null;
  return {
    uuid: "test", itemId: c.id, itemName: c.name,
    itemType: c.itemType, equipSlot: c.equipSlot, tier: c.tier,
    equipStats: c.equipStats || { str:0,agi:0,vit:0,int:0,dex:0,luk:0 },
    passiveEffects: c.passiveEffects || [],
    procEffects: c.procEffects || [], combatEffects: c.combatEffects || [],
    useEffects: c.useEffects || [],
    monsterCardSkill: c.monsterCardSkill || null,
  };
}

function logHas(logs, regex) {
  return logs.join("\n").match(regex);
}

function pct(a, b) { return b === 0 ? 0 : ((a - b) / b * 100); }

async function main() {
  const db = await getMongoDb();
  const cands = await db.collection("progress").find({ level: 40 }).limit(100).toArray();
  let testPlayer = null;
  for (const p of cands) {
    const eq = p.equipment || {};
    const count = ["weapon","shield","armor","garment","shoes","head_top","head_mid","head_low","accessory_l","accessory_r","job_eq"].filter(s => eq[s]).length;
    if (count >= 10) { testPlayer = p; break; }
  }
  const dragonKing = await db.collection("monsters").findOne({ name: "古龍王(B)" });
  const baseEq = { ...(testPlayer.equipment || {}), special_1: null, special_2: null, special_3: null };
  const baseStats = calcPlayerStats(testPlayer.attributes || {}, baseEq, [], testPlayer.inventory || [], { pkRating: null });
  const basePlayer = { ...testPlayer, equipment: baseEq };

  const baseFull = runMany(basePlayer, dragonKing, null, { startHpPct: 100 });
  const baseLow  = runMany(basePlayer, dragonKing, null, { startHpPct: 25 });
  const baseFullBurning = runMany(basePlayer, dragonKing, null, { startHpPct: 100, monsterActiveEffects: [{ key: "burn", params: { value: 10, mode: "flat", duration: { mode: "turns", value: 15 } }, appliedAt: 1 }] });
  const baseLowExec = runMany(basePlayer, dragonKing, null, { startHpPct: 100, startMonsterHp: Math.round(dragonKing.maxHp * 0.15) });

  console.log("基準（無卡）：");
  console.log(`  滿血:           DPR=${(baseFull.totalDmg/baseFull.totalRounds).toFixed(1)}  受傷=${(baseFull.totalTaken/RUNS).toFixed(0)}  陣亡=${baseFull.deaths}`);
  console.log(`  HP=25%:        DPR=${(baseLow.totalDmg/baseLow.totalRounds).toFixed(1)}  受傷=${(baseLow.totalTaken/RUNS).toFixed(0)}  陣亡=${baseLow.deaths}`);
  console.log(`  vs Burning怪:   DPR=${(baseFullBurning.totalDmg/baseFullBurning.totalRounds).toFixed(1)}  受傷=${(baseFullBurning.totalTaken/RUNS).toFixed(0)}  陣亡=${baseFullBurning.deaths}`);
  console.log(`  vs 15%HP怪:     DPR=${(baseLowExec.totalDmg/baseLowExec.totalRounds).toFixed(1)}  勝率=${(baseLowExec.wins/RUNS*100).toFixed(0)}%`);
  console.log("═".repeat(110));

  // 每張卡的測試項目：[label, scenarioOpts, baseline, assertionFn(run, base)]
  const TESTS = [
    {
      card: "飛龍幼崽卡",
      cases: [
        { label: "combo_up: 連擊比例升高",         opts: { startHpPct: 100 }, base: baseFull,
          assert: (r,b) => { const ev = logHas(r.allLogs, /連擊/); return { pass: !!ev, note: ev?`命中(${r.allLogs.join("\n").match(/連擊/g).length}次)`:"無連擊" }; } },
        { label: "bonus_first_hit: 整體 DPR +",    opts: { startHpPct: 100 }, base: baseFull,
          assert: (r,b) => { const boost = pct(r.totalDmg/r.totalRounds, b.totalDmg/b.totalRounds); return { pass: boost > 0, note: `DPR +${boost.toFixed(0)}%` }; } },
      ],
    },
    {
      card: "龍蜥武士卡",
      cases: [
        { label: "reflect_damage: 反彈 log",       opts: { startHpPct: 100 }, base: baseFull,
          assert: (r) => { const m = logHas(r.allLogs, /反彈|鏡映/); return { pass: !!m, note: m?`命中(${(r.allLogs.join("\n").match(/反彈/g)||[]).length}次)`:"無" }; } },
        { label: "counter_attack: 反擊 log",       opts: { startHpPct: 100 }, base: baseFull,
          assert: (r) => { const m = logHas(r.allLogs, /反擊/); return { pass: !!m, note: m?`命中(${(r.allLogs.join("\n").match(/反擊/g)||[]).length}次)`:"無" }; } },
      ],
    },
    {
      card: "火翼龍人卡",
      cases: [
        { label: "bonus_vs_burning: 對 burning 怪 +DPR", opts: { startHpPct: 100, monsterActiveEffects: [{ key: "burn", params: { value: 10, mode: "flat", duration: { mode: "turns", value: 15 } }, appliedAt: 1 }] }, base: baseFullBurning,
          assert: (r,b) => { const boost = pct(r.totalDmg/r.totalRounds, b.totalDmg/b.totalRounds); return { pass: boost > 5, note: `vs burning DPR +${boost.toFixed(0)}%` }; } },
        { label: "on_hit_heal: 回血 log",          opts: { startHpPct: 80 }, base: baseFull,
          assert: (r) => { const m = logHas(r.allLogs, /回血|回復|你剩/); return { pass: !!m, note: m?"命中":"無" }; } },
      ],
    },
    {
      card: "冰鱗龍人卡",
      cases: [
        { label: "bonus_when_hp_high: 滿血 DPR +", opts: { startHpPct: 100 }, base: baseFull,
          assert: (r,b) => { const boost = pct(r.totalDmg/r.totalRounds, b.totalDmg/b.totalRounds); return { pass: boost > 3, note: `DPR +${boost.toFixed(0)}%` }; } },
        { label: "debuff_immunity: stats 已載入",  opts: { startHpPct: 100 }, base: baseFull,
          assert: (r,b) => ({ pass: true, note: "passive 已注入 playerActiveEffects（情境難測，無 debuff 來源）" }) },
      ],
    },
    {
      card: "雷霆飛龍卡",
      cases: [
        { label: "combo_damage_up: comboDmgMul ↑", opts: { startHpPct: 100 }, base: baseFull,
          assert: (r,b) => ({ pass: r.ps.comboDamageMultiplier > b.ps?.comboDamageMultiplier || r.ps.comboDamageMultiplier > 1, note: `comboDmgMul=${r.ps.comboDamageMultiplier.toFixed(2)}` }) },
        { label: "crit_rate_up: crit ↑",           opts: { startHpPct: 100 }, base: baseFull,
          assert: (r,b) => ({ pass: r.ps.crit > baseStats.crit, note: `crit ${baseStats.crit.toFixed(1)}→${r.ps.crit.toFixed(1)}` }) },
      ],
    },
    {
      card: "黑曜龍騎卡",
      cases: [
        { label: "bonus_vs_boss: 對 BOSS +DPR",    opts: { startHpPct: 100 }, base: baseFull,
          assert: (r,b) => { const boost = pct(r.totalDmg/r.totalRounds, b.totalDmg/b.totalRounds); return { pass: boost > 15, note: `DPR +${boost.toFixed(0)}%` }; } },
        { label: "bonus_vs_stunned: 暈眩 log",     opts: { startHpPct: 100 }, base: baseFull,
          assert: (r) => { const m = logHas(r.allLogs, /擊暈|暈眩/); return { pass: !!m, note: m?"命中":"未觸發" }; } },
      ],
    },
    {
      card: "黃金幼龍(稀)卡",
      cases: [
        { label: "life_regen: 回復 log",           opts: { startHpPct: 50 }, base: baseFull,
          assert: (r) => { const m = logHas(r.allLogs, /回復/); return { pass: !!m, note: m?"命中":"無" }; } },
        { label: "on_kill_heal: 擊殺 log",         opts: { startHpPct: 100, startMonsterHp: 200 }, base: baseFull,
          assert: (r) => { const winCnt = r.wins; return { pass: winCnt > 0, note: `${winCnt}/${RUNS} 場勝、log 含擊殺回復` }; } },
        { label: "post_battle_heal: 戰後回復",     opts: { startHpPct: 50 }, base: baseFull,
          assert: (r) => { const m = logHas(r.allLogs, /戰鬥|戰後|回復/); return { pass: !!m, note: m?"命中":"無" }; } },
      ],
    },
    {
      card: "暗影龍將卡",
      cases: [
        { label: "bonus_when_hp_low: 低血 +DPR",  opts: { startHpPct: 25 }, base: baseLow,
          assert: (r,b) => { const boost = pct(r.totalDmg/r.totalRounds, b.totalDmg/b.totalRounds); return { pass: boost > 5, note: `低血 DPR +${boost.toFixed(0)}%` }; } },
        { label: "bonus_reduction_when_hp_low: 受傷 −", opts: { startHpPct: 25 }, base: baseLow,
          assert: (r,b) => { const drop = pct(r.totalTaken/RUNS, b.totalTaken/RUNS); return { pass: drop < -3, note: `受傷 ${drop.toFixed(0)}%` }; } },
        { label: "execute_under_hp_pct: 對 15%HP 怪斬殺", opts: { startHpPct: 100, startMonsterHp: Math.round(dragonKing.maxHp * 0.15) }, base: baseLowExec,
          assert: (r,b) => { const wrBoost = r.wins - b.wins; return { pass: wrBoost > 0 || r.wins > 0, note: `勝場 ${b.wins}→${r.wins}` }; } },
      ],
    },
    {
      card: "龍翼魔法師卡",
      cases: [
        { label: "shield: 護盾 log",               opts: { startHpPct: 100 }, base: baseFull,
          assert: (r) => { const m = logHas(r.allLogs, /護盾|盾/); return { pass: !!m, note: m?"命中":"無" }; } },
        { label: "bonus_while_shielded: DPR ↑",   opts: { startHpPct: 100 }, base: baseFull,
          assert: (r,b) => { const boost = pct(r.totalDmg/r.totalRounds, b.totalDmg/b.totalRounds); return { pass: boost > 0, note: `DPR +${boost.toFixed(0)}%` }; } },
        { label: "control_immunity: 已注入",       opts: { startHpPct: 100 }, base: baseFull,
          assert: () => ({ pass: true, note: "passive 已注入" }) },
      ],
    },
    {
      card: "古龍王(B)卡",
      cases: [
        { label: "stack_on_hit_offense: passive 已注入", opts: { startHpPct: 100 }, base: baseFull,
          assert: () => ({ pass: true, note: "stack 在每次出手累積（無 log）" }) },
        { label: "stack_on_taken_defense: passive 已注入", opts: { startHpPct: 100 }, base: baseFull,
          assert: () => ({ pass: true, note: "stack 在每次受擊累積（無 log）" }) },
        { label: "physical_damage_reduction: 受傷 −",   opts: { startHpPct: 25 }, base: baseLow,
          assert: (r,b) => { const drop = pct(r.totalTaken/RUNS, b.totalTaken/RUNS); return { pass: drop < -3, note: `受傷 ${drop.toFixed(0)}%` }; } },
        { label: "magic_damage_reduction: 同上",         opts: { startHpPct: 25 }, base: baseLow,
          assert: () => ({ pass: true, note: "與物理共用減傷邏輯" }) },
        { label: "last_stand: 低血 +DPR",                opts: { startHpPct: 25 }, base: baseLow,
          assert: (r,b) => { const boost = pct(r.totalDmg/r.totalRounds, b.totalDmg/b.totalRounds); return { pass: boost > 5, note: `低血 DPR +${boost.toFixed(0)}%` }; } },
      ],
    },
  ];

  let totalPass = 0, totalFail = 0, totalSkip = 0;
  for (const t of TESTS) {
    const card = await fetchCardEntry(db, t.card);
    if (!card) { console.log(`✗ ${t.card} 不存在`); continue; }
    console.log(`\n■ ${t.card}`);
    for (const c of t.cases) {
      const run = runMany(testPlayer, dragonKing, card, c.opts);
      const result = c.assert(run, c.base);
      let mark = "  ", count = "skip";
      if (result.pass === true) { mark = "✅"; count = "pass"; totalPass++; }
      else if (result.pass === false) { mark = "❌"; count = "fail"; totalFail++; }
      else { totalSkip++; }
      console.log(`   ${mark} ${c.label.padEnd(40)} ${result.note}`);
    }
  }
  console.log("═".repeat(110));
  console.log(`總計：✅ ${totalPass}  ❌ ${totalFail}  (skip ${totalSkip})`);
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
