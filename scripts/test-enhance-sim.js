// scripts/test-enhance-sim.js
// 模擬 ShopService.enhanceItem 的檢查步驟，輸出每一步的檢查結果
// 用法: node scripts/test-enhance-sim.js <discordId> <targetUuid> <materialUuid>
"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  const discordId = process.argv[2];
  const targetUuid = process.argv[3];
  const materialUuid = process.argv[4];
  if (!discordId) {
    console.error("Usage: node scripts/test-enhance-sim.js <discordId> <targetUuid?> <materialUuid?>");
    process.exit(2);
  }

  const MONGODB_URI = process.env.MONGODB_URI;
  const DB = process.env.MONGODB_DB_NAME || process.env.MONGODB_DB || "equipment_game";
  if (!MONGODB_URI) {
    console.error('Please set MONGODB_URI in .env');
    process.exit(2);
  }

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(DB);

  const progress = (await db.collection('progress').findOne({ playerId: discordId })) || (await db.collection('progress').findOne({ discordId })) || null;
  if (!progress) {
    console.error('No progress found for', discordId);
    await client.close();
    return;
  }

  console.log('Loaded progress for', discordId);
  const equipped = progress.equipment || {};
  const equippedWeapon = equipped.weapon || null;
  const inv = progress.inventory || [];

  console.log('\nEquipped weapon:', equippedWeapon ? JSON.stringify(equippedWeapon, null, 2) : '(none)');
  console.log('\nInventory count:', inv.length);

  // If uuids not provided, pick equipped and first inventory item as defaults
  const pickTarget = targetUuid || (equippedWeapon && equippedWeapon.uuid) || (inv[0] && inv[0].uuid);
  const pickMaterial = materialUuid || (inv.find(i => i.uuid && i.uuid !== pickTarget) && inv.find(i => i.uuid && i.uuid !== pickTarget).uuid) || null;

  console.log('\nUsing targetUuid =', pickTarget);
  console.log('Using materialUuid =', pickMaterial);

  // Simulate checks
  const ENHANCE_MAX = 3;

  if (!pickTarget) { console.log('FAIL: No targetUuid available'); await client.close(); return; }
  if (!pickMaterial) { console.log('FAIL: No materialUuid available in inventory'); await client.close(); return; }

  let target = inv.find(e => e.uuid === pickTarget);
  let targetSlotKey = null;
  if (!target) {
    for (const [k, v] of Object.entries(progress.equipment || {})) {
      if (v?.uuid === pickTarget) { target = v; targetSlotKey = k; break; }
    }
  }

  console.log('\nAfter lookup: target found?', !!target, 'targetSlotKey=', targetSlotKey);
  if (!target) { console.log('FAIL: 找不到目標裝備'); await client.close(); return; }
  if ((target.itemType || 'equipment') !== 'equipment') { console.log('FAIL: 目標不是裝備'); await client.close(); return; }

  const currentLevel = target.enhanceLevel || 0;
  console.log('Current enhanceLevel =', currentLevel);
  if (currentLevel >= ENHANCE_MAX) { console.log('FAIL: 已達強化上限'); await client.close(); return; }

  const matIdx = inv.findIndex(e => e.uuid === pickMaterial);
  console.log('Material index in inventory =', matIdx);
  if (matIdx === -1) { console.log('FAIL: 找不到材料裝備（需在背包中）'); await client.close(); return; }
  const material = inv[matIdx];

  console.log('Material itemName =', material.itemName, 'Target itemName =', target.itemName);
  if (material.itemName !== target.itemName) { console.log('FAIL: 材料名稱與目標不同'); await client.close(); return; }
  if (material.uuid === pickTarget) { console.log('FAIL: 目標與材料不能相同'); await client.close(); return; }

  const stats = target.equipStats || {};
  const mainStat = Object.entries(stats).sort((a,b)=>b[1]-a[1])[0]?.[0];
  console.log('Main stat to enhance =', mainStat);
  if (!mainStat) { console.log('FAIL: 此裝備沒有可強化的屬性'); await client.close(); return; }

  // Simulate applying enhancement
  const newStats = { ...stats, [mainStat]: (stats[mainStat] || 0) + 1 };
  const newLevel = currentLevel + 1;
  const newName = target.itemName.replace(/\s*\+\d+$/, '') + ` +${newLevel}`;

  console.log('\nENHANCE WOULD SUCCEED');
  console.log('New stats:', newStats);
  console.log('New enhanceLevel:', newLevel);
  console.log('New name:', newName);

  await client.close();
}

main().catch(err=>{ console.error(err); process.exit(1); });
