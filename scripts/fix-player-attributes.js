"use strict";

/**
 * fix-player-attributes.js
 *
 * 審計並修正所有玩家的屬性點數：
 *
 * 正確公式：
 *   sum(attributes) + statusPoints == 6 + (level-1)*2 + grantedStatusPoints
 *
 * 由於無法追蹤每位玩家的道具發放紀錄，
 * 本腳本計算「超出升級應得點數的部分」(excess)：
 *   excess = (sum(attrs) + statusPoints) - (6 + (level-1)*2)
 *
 * excess > 0：從最高屬性往下扣，最低扣到 1
 * excess < 0：缺少的部分隨機分配到六大屬性（與升級規則一致）
 *
 * 執行：node scripts/fix-player-attributes.js
 * 加 --dry-run 只列印不寫入
 */

const { MongoClient } = require("mongodb");

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = "equipment_game";
const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  const db = client.db(DB_NAME);
  const col = db.collection("progress");

  const all = await col.find({}).toArray();
  console.log(`共找到 ${all.length} 筆 progress 記錄`);

  let fixed = 0;
  let deficient = 0;
  let ok = 0;

  for (const p of all) {
    const level = Math.max(1, Number(p.level) || 1);
    const attrs = p.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    const sp = Number(p.statusPoints) || 0;

    const sumAttrs = ATTR_KEYS.reduce((s, k) => s + Math.max(0, Number(attrs[k]) || 0), 0);
    const pool = sumAttrs + sp;
    const expected = 6 + (level - 1) * 2;
    const excess = pool - expected;

    if (excess === 0) {
      ok++;
      continue;
    }

    if (excess < 0) {
      const deficit = -excess;
      deficient++;
      const newAttrs = { ...attrs };
      for (const k of ATTR_KEYS) {
        if (!Number.isInteger(newAttrs[k]) || newAttrs[k] < 1) newAttrs[k] = 1;
      }
      // 隨機分配到六大屬性（與升級規則一致）
      for (let i = 0; i < deficit; i++) {
        const k = ATTR_KEYS[Math.floor(Math.random() * ATTR_KEYS.length)];
        newAttrs[k] += 1;
      }
      const attrLine = ATTR_KEYS.map(k => `${k}:${attrs[k] || 0}→${newAttrs[k]}`).join(" ");
      console.log(`[缺少] playerId=${p.playerId} level=${level} pool=${pool} expected=${expected} deficit=${deficit}`);
      console.log(`  屬性：${attrLine}`);
      if (!isDryRun) {
        await col.updateOne(
          { _id: p._id },
          { $set: { attributes: newAttrs, updatedAt: new Date().toISOString() } }
        );
      }
      continue;
    }

    // excess > 0 → 從最高屬性往下扣
    console.log(`[修正] playerId=${p.playerId} level=${level} pool=${pool} expected=${expected} excess=${excess}`);

    const newAttrs = { ...attrs };
    // 確保所有屬性都有值
    for (const k of ATTR_KEYS) {
      if (!Number.isInteger(newAttrs[k]) || newAttrs[k] < 1) newAttrs[k] = 1;
    }

    let toRemove = excess;

    // 優先從 statusPoints 扣（不影響屬性分布）
    if (sp > 0 && toRemove > 0) {
      const fromSp = Math.min(sp, toRemove);
      toRemove -= fromSp;
      if (!isDryRun) {
        await col.updateOne(
          { _id: p._id },
          { $inc: { statusPoints: -fromSp }, $set: { updatedAt: new Date().toISOString() } }
        );
      }
      console.log(`  statusPoints: ${sp} → ${sp - fromSp}`);
    }

    // 剩餘的從最高屬性往下扣
    while (toRemove > 0) {
      // 找目前最高屬性
      const maxKey = ATTR_KEYS.reduce((best, k) => newAttrs[k] > newAttrs[best] ? k : best, ATTR_KEYS[0]);
      const canRemove = Math.min(toRemove, newAttrs[maxKey] - 1); // 最低保留 1
      if (canRemove <= 0) break; // 全部已是 1，無法再扣
      newAttrs[maxKey] -= canRemove;
      toRemove -= canRemove;
    }

    if (toRemove > 0) {
      console.warn(`  ⚠ 無法完全修正，剩餘 ${toRemove} 點無法扣除（所有屬性已達最低值 1）`);
    }

    const attrLine = ATTR_KEYS.map(k => `${k}:${attrs[k]}→${newAttrs[k]}`).join(" ");
    console.log(`  屬性：${attrLine}`);

    if (!isDryRun) {
      await col.updateOne(
        { _id: p._id },
        { $set: { attributes: newAttrs, updatedAt: new Date().toISOString() } }
      );
    }

    fixed++;
  }

  console.log(`\n統計：OK=${ok} 多扣=${fixed} 補回=${deficient}（缺少的點數已補到 statusPoints）`);
  if (isDryRun) console.log("（dry-run 模式，未實際寫入）");

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
