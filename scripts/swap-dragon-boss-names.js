"use strict";
/**
 * 對調龍 BOSS 與卡片名稱（按 id 操作，避免撞名）：
 *   PVE 區（dragon_realm）：古龍王(B) → 龍王(B)，卡片 古龍王(B)卡 → 龍王(B)卡
 *   世界王（dragon_king_lair）：龍王(B) → 古龍王(B)，卡片 龍王卡 → 古龍王(B)卡
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

const PVE_MONSTER_ID = "8016a32e-1870-44d8-a6da-2c27e2cbdcc3"; // dragon_realm boss
const WB_MONSTER_ID = "dragon-king-boss";                      // dragon_king_lair world boss
const PVE_CARD_ID = "monster-card-90df79f6-ce40-4f31-be32-f8d4d8f31c99";
const WB_CARD_ID = "monster-card-dragon-king";

const RENAMES = {
  monsters: [
    { id: PVE_MONSTER_ID, to: "龍王(B)" },
    { id: WB_MONSTER_ID, to: "古龍王(B)" },
  ],
  cards: [
    { id: PVE_CARD_ID, to: "龍王(B)卡", monsterName: "龍王(B)" },
    { id: WB_CARD_ID, to: "古龍王(B)卡", monsterName: "古龍王(B)" },
  ],
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  console.log(`對調龍 BOSS／卡片名稱（dryRun=${dryRun}）`);
  console.log("─".repeat(80));

  // 1. 怪物改名
  for (const m of RENAMES.monsters) {
    const cur = await db.collection("monsters").findOne({ id: m.id });
    if (!cur) { console.warn(`⚠ 找不到怪物 id=${m.id}`); continue; }
    console.log(`怪物 ${cur.zone}：「${cur.name}」→「${m.to}」`);
    if (!dryRun) await db.collection("monsters").updateOne({ id: m.id }, { $set: { name: m.to, updatedAt: NOW } });
  }

  // 2. 卡片改名（name / itemName / monsterCardMeta.monsterName）
  for (const c of RENAMES.cards) {
    const cur = await db.collection("items").findOne({ id: c.id });
    if (!cur) { console.warn(`⚠ 找不到卡片 id=${c.id}`); continue; }
    console.log(`卡片：「${cur.name}」→「${c.to}」（meta.monsterName→${c.monsterName}）`);
    if (!dryRun) {
      const meta = { ...(cur.monsterCardMeta || {}), monsterName: c.monsterName };
      await db.collection("items").updateOne({ id: c.id }, { $set: { name: c.to, itemName: c.to, monsterCardMeta: meta, updatedAt: NOW } });
    }
  }

  // 3. 更新所有怪物 drops 內這兩張卡的顯示名（itemId 不變，只改 itemName）
  const cardNameById = { [PVE_CARD_ID]: "龍王(B)卡", [WB_CARD_ID]: "古龍王(B)卡" };
  const dropMonsters = await db.collection("monsters").find({ "drops.itemId": { $in: [PVE_CARD_ID, WB_CARD_ID] } }).toArray();
  for (const m of dropMonsters) {
    let changed = false;
    const drops = (m.drops || []).map((d) => {
      if (cardNameById[d.itemId] && d.itemName !== cardNameById[d.itemId]) {
        changed = true;
        return { ...d, itemName: cardNameById[d.itemId] };
      }
      return d;
    });
    if (changed) {
      console.log(`  drops 更新：${m.name}（${m.zone}）卡片顯示名`);
      if (!dryRun) await db.collection("monsters").updateOne({ _id: m._id }, { $set: { drops } });
    }
  }

  // 4. 更新玩家背包內這兩張卡的顯示名（itemId 不變）
  const players = await db.collection("progress").find({ "inventory.itemId": { $in: [PVE_CARD_ID, WB_CARD_ID] } }).toArray();
  let invUpdated = 0;
  for (const p of players) {
    let changed = false;
    const inv = (p.inventory || []).map((e) => {
      if (cardNameById[e.itemId] && e.itemName !== cardNameById[e.itemId]) {
        changed = true;
        return { ...e, itemName: cardNameById[e.itemId], name: cardNameById[e.itemId] };
      }
      return e;
    });
    if (changed) { invUpdated++; if (!dryRun) await db.collection("progress").updateOne({ _id: p._id }, { $set: { inventory: inv } }); }
  }
  if (invUpdated) console.log(`  玩家背包卡片顯示名更新：${invUpdated} 位`);

  console.log("─".repeat(80));
  console.log(`完成${dryRun ? "（dry-run，未寫入）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
