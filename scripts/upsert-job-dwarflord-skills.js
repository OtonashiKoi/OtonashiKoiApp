"use strict";
// 矮人戰士長的 4 個技能（全部與暈眩連動）。
//
// 設計主軸：**暈眩是矮人的武器，不是運氣**
//   製造暈眩 → 暈眩期無視防禦爆發（被動「山碎」）→ 暈眩結束仍留破綻
//
//   1. 震地重擊（沿用強化）必定暈眩；一般怪 3 回合、世界王 2 回合（被動「巨神之握」把
//      boss 上限從 1 放寬到 2，全遊戲唯一例外）＋ 敵方 ATK -15%
//   2. 崩山（新）**自訂觸發 on_target_stunned**：目標暈眩中必定發動，不吃 35% 隨機閘門
//      → 「打暈就爆發」成為穩定連段，而不是碰運氣
//   3. 餘震（新）暈眩期間才進隨機池；敵方防禦 -25%（3 回合）→ 讓暈眩價值延續到暈眩之後
//   4. 鐵壁（沿用）保命
//
// ⚠️ 數值稀釋：實測名目加成只有約 45~50% 會反映到最終傷害（該玩家約一半輸出來自
//    怪物卡技能與 DOT，那些不走普通攻擊的加成路徑）→ 數字刻意抓高，實測後再校準。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const BADGE_ID = "job_dwarflord_t2_v1";

const SKILLS = [
  {
    key: "dwarf_iron_wall",
    name: "鐵壁",
    description: "受傷降低25%、DEF+15，持續2回合。",
    cooldownTurns: 2,
    condition: {},
    procEffects: [
      { key: "damage_reduction", target: "self", params: { value: 25, duration: { mode: "turns", value: 2 } } },
      { key: "def_up", target: "self", params: { value: 15, mode: "flat", duration: { mode: "turns", value: 2 } } },
    ],
  },
  {
    key: "dwarflord_quake_strike",
    name: "震地重擊",
    description: "大地為之龜裂——敵方必定暈眩（一般怪 3 回合／世界王 2 回合）並 ATK -15%，持續 2 回合。",
    cooldownTurns: 4,
    condition: {},
    procEffects: [
      // 暈眩 3 回合：一般怪吃滿 3，世界王被 capMonsterStun 壓成 2（巨神之握放寬後的上限）
      { key: "stun", target: "enemy", params: { value: 100, duration: { mode: "turns", value: 3 } } },
      { key: "atk_down", target: "enemy", params: { value: 15, duration: { mode: "turns", value: 2 } } },
    ],
  },
  {
    key: "dwarflord_mountain_breaker",
    name: "崩山",
    description: "趁其倒地，傾全山之力砸下——本回合終傷 +40%、爆擊傷害 +30%，持續 2 回合。",
    // 自訂觸發：目標暈眩中必定發動（不吃 35% 隨機閘門、也不佔隨機池）
    trigger: "on_target_stunned",
    chance: 100,
    cooldownTurns: 3,
    condition: {},
    procEffects: [
      { key: "final_damage_up", target: "self", params: { value: 40, duration: { mode: "turns", value: 2 } } },
      { key: "crit_damage_up", target: "self", params: { value: 30, duration: { mode: "turns", value: 2 } } },
    ],
  },
  {
    key: "dwarflord_aftershock",
    name: "餘震",
    description: "震盪順著骨骼蔓延，敵方防禦 -25%，持續 3 回合。",
    cooldownTurns: 5,
    // 目標暈眩中才進隨機池（combatLoop 的 c.targetStunned 判定，兩種暈眩都算）
    condition: { targetStunned: true },
    procEffects: [
      { key: "def_down", target: "enemy", params: { value: 25, duration: { mode: "turns", value: 3 } } },
    ],
  },
];

async function main() {
  const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");
  await client.connect();
  const items = client.db("equipmentGame").collection("items");

  const badge = await items.findOne({ id: BADGE_ID });
  if (!badge) throw new Error(`找不到矮人戰士長徽章 ${BADGE_ID}，請先跑 upsert-job-dwarflord.js`);

  await items.updateOne(
    { id: BADGE_ID },
    { $set: { jobSkills: SKILLS, updatedAt: new Date().toISOString() } }
  );

  console.log(`已寫入 ${SKILLS.length} 個技能到 矮人戰士長徽章：`);
  for (const s of SKILLS) {
    const trig = s.trigger ? `自訂觸發 ${s.trigger}` : (s.condition?.targetStunned ? "隨機池(需目標暈眩)" : "隨機池");
    console.log(`  ${s.name.padEnd(5)}｜CD ${s.cooldownTurns}｜${trig}`);
    for (const p of s.procEffects) console.log(`      → ${p.target} ${p.key} ${JSON.stringify(p.params)}`);
  }
  console.log("\n被動（不在 jobSkills，走 jobAdvancement.stunMastery）：");
  console.log("  山碎    ：對暈眩中的目標無視防禦%（固定防禦 flatDef 仍在）");
  console.log("  巨神之握：世界王暈眩上限 1 → 2 回合（全遊戲唯一例外）");
  console.log("  巨神震擊：世界王暈眩條（見 dwarfStunGauge.js）");
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
