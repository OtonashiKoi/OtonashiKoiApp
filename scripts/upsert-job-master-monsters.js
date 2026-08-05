"use strict";
/**
 * 轉職劇情的「師傅戰」怪物（11 隻，對應 11 位師傅）。
 *
 * ‧ `enabled: false`：`getMonsterById` 不看 enabled，劇情戰照樣載得到，
 *   但不會出現在任何戰鬥區的怪物池（跟一般怪完全隔離）。
 * ‧ 血量＝該職業「Lv35／B階+5／徽章 Lv20」實測單場輸出 × 1.2
 *   （量測見 scripts/sim-t1-damage-table.js；每個職業打自己的師傅，所以逐職業給）。
 *   → 多數人一場打得完，運氣差的重打一次；劇情戰 mustWin 可重試，不卡關。
 * ‧ 攻擊力壓在「打得痛但不會秒殺」的區間：Lv35 玩家血池約 VIT×25+200。
 *
 * 用法：node scripts/upsert-job-master-monsters.js [--apply]
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.argv.includes("--apply");
const ART = "https://otonashikoi.org/monster-art/masters";

// [職業key, 師傅名, 實測單場輸出, 攻擊力]
const MASTERS = [
  ["swordsman", "白鷺", 4762, 260],
  ["warrior", "鐵砧", 8571, 300],
  ["dwarf_warrior", "石鬍子", 3750, 240],
  ["rogue", "影七", 7692, 250],
  ["mage", "灰燼夫人", 5660, 280],
  ["healer", "無傷", 2913, 200],
  ["archer", "遠山", 4545, 260],
  ["tactician", "枯棋", 4615, 240],
  ["bard", "斷弦", 4000, 230],
  ["barrier_mage", "壁", 2521, 190],
  ["gambler", "老千", 3947, 250],
];

(async () => {
  const db = await getMongoDb();
  const col = db.collection("monsters");
  let created = 0, updated = 0;

  console.log("═══ 師傅戰怪物 ═══");
  console.log("id".padEnd(30) + "名稱".padEnd(14) + "血量".padEnd(10) + "攻擊");
  console.log("─".repeat(62));

  for (const [key, name, dmg, atk] of MASTERS) {
    const id = `master-${key.replace(/_/g, "-")}`;
    const hp = Math.round(dmg * 1.2);
    const doc = {
      id,
      name: `${name}（試煉）`,
      zone: null,                  // 不屬於任何戰鬥區
      level: 38,
      maxHp: hp,
      str: 45, agi: 30, vit: 40, int: 30, dex: 35, luk: 25,
      atk,
      def: 25,
      defIgnorePct: 0,
      expReward: 0,                // 劇情戰不給經驗金幣（獎勵是轉職本身）
      goldReward: 0,
      entryFee: 0,
      isBoss: true,
      enabled: false,              // ← 不進怪物池，只有劇情戰叫得到
      spawnRate: 0,
      imageUrl: `${ART}/${key}.png`,
      imageThumbnailUrl: `${ART}/${key}.png`,
      drops: [],
      dropTheme: "job_master",
      monsterCardSkill: null,
      _jobMaster: key,             // 標記：日後要批次撈找得到
      updatedAt: new Date().toISOString(),
    };
    const existing = await col.findOne({ id });
    console.log(`  ${existing ? "~" : "+"} ${id.padEnd(28)}${doc.name.padEnd(14)}${String(hp).padEnd(10)}${atk}`);
    if (existing) updated++; else created++;
    if (APPLY) {
      if (existing) await col.updateOne({ id }, { $set: doc });
      else await col.insertOne({ ...doc, createdAt: new Date().toISOString() });
    }
  }
  console.log(`\n新增 ${created} 隻、更新 ${updated} 隻。${APPLY ? "✅ 已寫入" : "（試跑，加 --apply 才生效）"}`);
  console.log(`圖請放到 ${ART}/<職業key>.png（使用者自備）`);
  process.exit(0);
})().catch((e) => { console.error("失敗：", e.message); process.exit(1); });
