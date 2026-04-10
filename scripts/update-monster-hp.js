"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

const HP_UPDATES = [
  // Normal zone
  { name: "小史(小)", zone: "normal", maxHp: 5000 },
  { name: "哥布",     zone: "normal", maxHp: 6000 },
  { name: "石頭",     zone: "normal", maxHp: 5500 },
  { name: "小狼",     zone: "normal", maxHp: 6000 },
  { name: "大史(B)",  zone: "normal", maxHp: 9000 },
  // Mid zone
  { name: "甲蟹",     zone: "mid", maxHp: 4500 },
  { name: "牙牙狼",   zone: "mid", maxHp: 5000 },
  { name: "巨巨",     zone: "mid", maxHp: 3500 },
  { name: "黑暗弓手", zone: "mid", maxHp: 4500 },
  { name: "米拉桑(B)",zone: "mid", maxHp: 7000 },
];

(async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");

  for (const u of HP_UPDATES) {
    const result = await db.collection("monsters").updateOne(
      { name: u.name, zone: u.zone },
      { $set: { maxHp: u.maxHp, "calc.maxHp": u.maxHp, updatedAt: new Date().toISOString() } }
    );
    console.log(`${u.name} (${u.zone}): maxHp=${u.maxHp} matched=${result.matchedCount} modified=${result.modifiedCount}`);
  }

  // 同步刷新各區怪物狀態：如果目前血量超過新上限，壓回新上限
  console.log("\n--- 同步怪物狀態血量 ---");
  for (const zone of ["normal", "mid"]) {
    const stateKey = `monster_state_${zone}`;
    const stateDoc = await db.collection("monster_states").findOne({ key: stateKey })
      || await db.collection("settings").findOne({ key: stateKey });

    if (!stateDoc) { console.log(`[${zone}] 找不到 state，跳過`); continue; }

    const activeSeq = stateDoc.activeMonsterSeq;
    const monster = await db.collection("monsters").findOne({ seq: activeSeq, zone });
    if (!monster) { console.log(`[${zone}] 找不到 active monster (seq=${activeSeq})`); continue; }

    const newMax = monster.maxHp;
    const currentHp = stateDoc.currentHp;
    if (currentHp > newMax) {
      const col = stateDoc.key ? "monster_states" : "settings";
      await db.collection(col).updateOne({ key: stateKey }, { $set: { currentHp: newMax } });
      console.log(`[${zone}] currentHp 壓回 ${newMax}（原 ${currentHp}）`);
    } else {
      console.log(`[${zone}] currentHp=${currentHp} 在新上限 ${newMax} 以內，不變`);
    }
  }

  await client.close();
  console.log("\nDone.");
})();
