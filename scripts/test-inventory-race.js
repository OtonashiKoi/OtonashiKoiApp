"use strict";
// 重演「獎勵憑空消失」的競態，驗證 save() 的源頭防護。
// 用假玩家 __race_test__，測完刪除，不碰真實資料。
require("dotenv").config();
const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const PID = "__race_test__";
const CHEST_ITEM = "worldboss_chest_test";

function entry(uuid, name) {
  return { uuid, itemId: `it_${uuid}`, name, itemType: "equipment", equipSlot: "weapon" };
}
function chest(uuid) {
  return { uuid, itemId: CHEST_ITEM, name: "測試寶箱", itemType: "consumable", stackCount: 1 };
}

async function main() {
  const repos = createMongoRepositories();
  const repo = repos.progressRepository;
  const db = await getMongoDb();
  const coll = db.collection("progress");
  await coll.deleteOne({ playerId: PID });
  await coll.insertOne({
    playerId: PID, level: 10, inventory: [entry("base1", "初始劍")],
    updatedAt: new Date().toISOString()
  });

  let pass = 0, fail = 0;
  const check = (label, cond, detail = "") => {
    if (cond) { pass++; console.log(`  ✅ ${label}`); }
    else { fail++; console.log(`  ❌ ${label} ${detail}`); }
  };
  const chestEntry = async () => {
    const doc = await coll.findOne({ playerId: PID });
    return doc.inventory.find((e) => e.itemId === CHEST_ITEM) || null;
  };
  const uuidsNow = async () => (await coll.findOne({ playerId: PID })).inventory.map((e) => e.uuid);

  console.log("情境 A：save 不動背包（profile 類流程），期間發第 1 顆寶箱");
  {
    const loaded = await repo.findByPlayerId(PID);
    loaded.level = 11;
    await repo.addOrStackInventoryItem(PID, CHEST_ITEM, chest("chestA"));
    await repo.save(loaded);
    const c = await chestEntry();
    check("寶箱 entry 存活", Boolean(c), JSON.stringify(await uuidsNow()));
    check("疊加數 = 1", c && (c.stackCount || 1) === 1, c && String(c.stackCount));
    check("level 有存到", (await coll.findOne({ playerId: PID })).level === 11);
  }

  console.log("情境 B：save 有動背包（新增戰利品），期間疊第 2 顆寶箱");
  {
    const loaded = await repo.findByPlayerId(PID);
    loaded.inventory.push(entry("rewardB", "戰利品B"));
    await repo.addOrStackInventoryItem(PID, CHEST_ITEM, chest("chestB"));
    await repo.save(loaded);
    const c = await chestEntry();
    const uuids = await uuidsNow();
    check("戰利品有進包", uuids.includes("rewardB"), JSON.stringify(uuids));
    check("疊加數 = 2（競態疊加沒被吃）", c && c.stackCount === 2, c && String(c.stackCount));
    check("沒有重複 entry", new Set(uuids).size === uuids.length, JSON.stringify(uuids));
  }

  console.log("情境 C：save 刪東西（分解類流程），期間疊第 3 顆寶箱");
  {
    const loaded = await repo.findByPlayerId(PID);
    loaded.inventory = loaded.inventory.filter((e) => e.uuid !== "base1");
    await repo.addOrStackInventoryItem(PID, CHEST_ITEM, chest("chestC"));
    await repo.save(loaded);
    const c = await chestEntry();
    const uuids = await uuidsNow();
    check("刪除有生效", !uuids.includes("base1"), JSON.stringify(uuids));
    check("疊加數 = 3", c && c.stackCount === 3, c && String(c.stackCount));
  }

  console.log("情境 C2：呼叫方把寶箱 entry 整個刪掉（用光），期間又疊第 4 顆");
  {
    const loaded = await repo.findByPlayerId(PID);
    loaded.inventory = loaded.inventory.filter((e) => e.itemId !== CHEST_ITEM);
    await repo.addOrStackInventoryItem(PID, CHEST_ITEM, chest("chestD"));
    await repo.save(loaded);
    const c = await chestEntry();
    check("競態那顆用差額重建（sc=1）", c && (c.stackCount || 1) === 1, c && String(c.stackCount));
  }

  console.log("情境 D：同物件連續 save 兩次，中間疊寶箱");
  {
    const loaded = await repo.findByPlayerId(PID);
    loaded.level = 12;
    const saved = await repo.save(loaded);
    await repo.addOrStackInventoryItem(PID, CHEST_ITEM, chest("chestE"));
    saved.level = 13;
    await repo.save(saved);
    const c = await chestEntry();
    check("第二次 save 後疊加數 = 2", c && c.stackCount === 2, c && String(c.stackCount));
    check("level=13", (await coll.findOne({ playerId: PID })).level === 13);
  }

  console.log("情境 E：無戳記 fallback（序列化過的物件 → 舊行為）");
  {
    const loaded = await repo.findByPlayerId(PID);
    const stripped = JSON.parse(JSON.stringify(loaded));
    delete stripped._id;
    stripped.level = 14;
    await repo.save(stripped);
    check("save 正常完成 level=14", (await coll.findOne({ playerId: PID })).level === 14);
  }

  await coll.deleteOne({ playerId: PID });
  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
