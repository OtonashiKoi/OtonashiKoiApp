"use strict";
/**
 * 測試 10 張龍族卡 passive 是否真的生效
 *
 * 流程：
 *  1. 取一個 Lv.40 玩家當基底
 *  2. 對每張卡：把卡塞進 equipped.special_1，跑 N 場戰鬥 vs 古龍王
 *  3. 比較裝卡 vs 不裝卡的 DPR / 平均回合 / 戰鬥日誌關鍵字
 *  4. 檢查每個 passive 預期出現的 log 痕跡
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 30;
const MAX_ROUNDS = 15;

const CARDS_TO_TEST = [
  { name: "飛龍幼崽卡", expected: ["combo_up", "bonus_first_hit"],
    keywords: [/連擊/, /連斬/, /浪潮/, /劍勢|連段/], statCheck: (ps, base) => ps.combo > base.combo },
  { name: "龍蜥武士卡", expected: ["reflect_damage", "counter_attack"],
    keywords: [/反彈|反震|反擊/, /反射/], statCheck: null },
  { name: "火翼龍人卡", expected: ["bonus_vs_burning", "on_hit_heal"],
    keywords: [/燃燒|灼燒|HP/, /回復|回血/], statCheck: null },
  { name: "冰鱗龍人卡", expected: ["debuff_immunity", "bonus_when_hp_high"],
    keywords: [/免疫|無視/], statCheck: null },
  { name: "雷霆飛龍卡", expected: ["combo_damage_up", "crit_rate_up"],
    keywords: [/暴擊|爆擊|連擊/], statCheck: (ps, base) => ps.crit > base.crit },
  { name: "黑曜龍騎卡", expected: ["bonus_vs_boss", "bonus_vs_stunned"],
    keywords: [/BOSS|暈眩|擊暈/], statCheck: null },
  { name: "黃金幼龍(稀)卡", expected: ["life_regen", "on_kill_heal", "post_battle_heal"],
    keywords: [/回復|回血/], statCheck: null },
  { name: "暗影龍將卡", expected: ["bonus_when_hp_low", "bonus_reduction_when_hp_low", "execute_under_hp_pct"],
    keywords: [/斬殺|處決/], statCheck: null },
  { name: "龍翼魔法師卡", expected: ["shield", "bonus_while_shielded", "control_immunity"],
    keywords: [/護盾|盾/], statCheck: null },
  { name: "古龍王(B)卡", expected: ["stack_on_hit_offense", "stack_on_taken_defense", "physical_damage_reduction", "magic_damage_reduction"],
    keywords: [/戰意|疊加|物理|魔法|減傷/], statCheck: null },
];

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const intStat = m.int || 0;
  const vit = m.vit || 0;
  return {
    maxHp: m.maxHp || (level * 800 + vit * 200),
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : level + vit,
    level, agi: m.agi || 1, int: intStat, dex: m.dex || 1, luk: m.luk || 0,
    dodge: Math.min(50, (m.agi || 1) * 0.5),
    hit: Math.min(100, 80 + (m.dex || 1)),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi || 1) * 0.5)),
    defIgnorePct: m.defIgnorePct || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + intStat * 0.01),
    dmgMax: 1.0,
  };
}

function runScenario(playerProgress, monster, card) {
  const baseEquipped = { ...(playerProgress.equipment || {}) };
  // 確保 special_1 是測試卡，清掉 2/3 避免干擾
  const eq = { ...baseEquipped, special_1: card, special_2: null, special_3: null };
  const ps = calcPlayerStats(playerProgress.attributes || {}, eq, [], playerProgress.inventory || [], { pkRating: null });
  const mCalc = buildMonsterCalc(monster);

  let wins = 0, totalDmg = 0, totalRounds = 0, deaths = 0;
  const logKeywords = new Map();
  const sampleLog = [];

  for (let i = 0; i < RUNS; i++) {
    const r = runCombatLoop(ps, mCalc, monster.name, mCalc.maxHp, MAX_ROUNDS, {
      playerLevel: playerProgress.level,
      equipped: eq,
      inventory: playerProgress.inventory || [],
      monsterIsBoss: !!monster.isBoss,
    });
    if (r.outcome === "win") wins++;
    if (r.outcome === "lose") deaths++;
    totalDmg += r.totalDamage || 0;
    totalRounds += r.roundLogs?.length || 0;

    // 收集 log 關鍵字
    for (const line of (r.roundLogs || []).join("\n").split("\n")) {
      const lc = line.toLowerCase();
      for (const kw of ["反擊", "反彈", "反震", "護盾", "斬殺", "處決", "燃燒", "回血", "回復",
                         "連擊", "暴擊", "爆擊", "免疫", "戰意", "疊加", "暈眩", "boss"]) {
        if (line.includes(kw) || lc.includes(kw.toLowerCase())) {
          logKeywords.set(kw, (logKeywords.get(kw) || 0) + 1);
        }
      }
    }
    if (i === 0) sampleLog.push(...(r.roundLogs || []).slice(0, 3));
  }

  return { ps, wins, totalDmg, totalRounds, deaths, logKeywords, sampleLog };
}

async function main() {
  const db = await getMongoDb();

  // 取一個健康 Lv.40 玩家（11 件、不要 chanyan 那種異常）
  const candidates = await db.collection("progress").find({ level: 40 }).limit(100).toArray();
  let testPlayer = null;
  for (const p of candidates) {
    const eq = p.equipment || {};
    const count = ["weapon","shield","armor","garment","shoes","head_top","head_mid","head_low","accessory_l","accessory_r","job_eq"].filter(s => eq[s]).length;
    if (count >= 10) { testPlayer = p; break; }
  }
  if (!testPlayer) { console.error("no suitable Lv.40 player"); process.exit(1); }
  console.log(`測試玩家：${testPlayer.playerId} Lv.${testPlayer.level} (${Object.keys(testPlayer.equipment||{}).filter(s=>testPlayer.equipment[s]).length} 件裝備)`);

  const dragonKing = await db.collection("monsters").findOne({ name: "古龍王(B)" });
  if (!dragonKing) { console.error("no dragon king"); process.exit(1); }
  console.log(`測試對手：${dragonKing.name} Lv.${dragonKing.level} HP=${dragonKing.maxHp}`);

  // 基準（清掉 special 槽）
  const baseEq = { ...(testPlayer.equipment || {}), special_1: null, special_2: null, special_3: null };
  const baseStats = calcPlayerStats(testPlayer.attributes || {}, baseEq, [], testPlayer.inventory || [], { pkRating: null });
  console.log(`基準（無卡）：ATK=${baseStats.atk} DEF=${baseStats.def} HP=${baseStats.maxHp} 命中=${baseStats.hit} 迴避=${baseStats.dodge} 爆擊=${baseStats.crit} 連擊=${baseStats.combo}`);

  console.log(`\n${"═".repeat(110)}`);
  console.log(`對每張卡跑 ${RUNS} 場 vs ${dragonKing.name}（max ${MAX_ROUNDS} 回合/場）`);
  console.log("═".repeat(110));

  const baseRun = runScenario({ ...testPlayer, equipment: baseEq }, dragonKing, null);
  console.log(`\n基準（無卡）：DPR=${(baseRun.totalDmg/baseRun.totalRounds).toFixed(1)} 勝率=${(baseRun.wins/RUNS*100).toFixed(0)}% 平均回合=${(baseRun.totalRounds/RUNS).toFixed(1)} 陣亡=${baseRun.deaths}`);

  console.log("─".repeat(110));
  console.log([
    "卡片".padEnd(16), "passive", "DPR".padStart(7), "勝率".padStart(5), "回合".padStart(5),
    "陣亡".padStart(4), "關鍵字命中（次數）"
  ].join("  "));
  console.log("─".repeat(110));

  for (const card of CARDS_TO_TEST) {
    const cardDoc = await db.collection("items").findOne({ name: card.name, equipSlot: "special" });
    if (!cardDoc) { console.log(`✗ ${card.name} 找不到`); continue; }
    // 用 inventory 格式塞進 special_1（須符合 progress.inventory 物件格式）
    const cardEntry = {
      uuid: "test-" + cardDoc.id,
      itemId: cardDoc.id,
      itemName: cardDoc.name,
      itemType: cardDoc.itemType,
      equipSlot: cardDoc.equipSlot,
      equipStats: cardDoc.equipStats || { str:0,agi:0,vit:0,int:0,dex:0,luk:0 },
      tier: cardDoc.tier,
      passiveEffects: cardDoc.passiveEffects || [],
      procEffects: cardDoc.procEffects || [],
      combatEffects: cardDoc.combatEffects || [],
      useEffects: cardDoc.useEffects || [],
      monsterCardSkill: cardDoc.monsterCardSkill || null,
    };
    const run = runScenario(testPlayer, dragonKing, cardEntry);
    const dpr = (run.totalDmg / run.totalRounds).toFixed(1);
    const wr  = (run.wins / RUNS * 100).toFixed(0) + "%";
    const ar  = (run.totalRounds / RUNS).toFixed(1);

    // 比較關鍵字相對基準的差異
    const kwHits = [];
    for (const [kw, count] of run.logKeywords.entries()) {
      const baseCount = baseRun.logKeywords.get(kw) || 0;
      if (count > baseCount) kwHits.push(`${kw}+${count - baseCount}`);
    }
    // stat check
    let statNote = "";
    if (card.statCheck) {
      statNote = card.statCheck(run.ps, baseStats) ? "✓stat" : "✗stat";
    }

    console.log([
      card.name.padEnd(15),
      card.expected.join(",").slice(0, 40).padEnd(40),
      String(dpr).padStart(7),
      wr.padStart(5),
      ar.padStart(5),
      String(run.deaths).padStart(4),
      (kwHits.slice(0, 6).join(",") + (statNote ? " " + statNote : "")).slice(0, 60),
    ].join("  "));
  }
  console.log("─".repeat(110));
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
