// 將 game.json 資料一次性遷移到 MongoDB
// 執行: node scripts/migrate-to-mongo.js
"use strict";

require("dotenv").config();
const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "equipment_game";
const JSON_DATA_PATH = process.env.JSON_DATA_PATH || "./data/game.json";

if (!MONGODB_URI) {
  console.error("❌ 請在 .env 設定 MONGODB_URI");
  process.exit(1);
}

async function migrate() {
  const raw = fs.readFileSync(path.resolve(JSON_DATA_PATH), "utf-8");
  const data = JSON.parse(raw);

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  console.log("✅ MongoDB 連線成功");

  const db = client.db(MONGODB_DB_NAME);

  // ── players (object → array) ──────────────────────────────────────
  const players = Object.values(data.players || {});
  if (players.length) {
    await db.collection("players").deleteMany({});
    await db.collection("players").insertMany(players);
    console.log(`✅ players: ${players.length} 筆`);
  }

  // ── wallets (object → array) ──────────────────────────────────────
  const wallets = Object.values(data.wallets || {});
  if (wallets.length) {
    await db.collection("wallets").deleteMany({});
    await db.collection("wallets").insertMany(wallets);
    console.log(`✅ wallets: ${wallets.length} 筆`);
  }

  // ── progress (object → array) ─────────────────────────────────────
  const progress = Object.values(data.progress || {});
  if (progress.length) {
    await db.collection("progress").deleteMany({});
    await db.collection("progress").insertMany(progress);
    console.log(`✅ progress: ${progress.length} 筆`);
  }

  // ── transactions (array) ──────────────────────────────────────────
  const transactions = data.transactions || [];
  if (transactions.length) {
    await db.collection("transactions").deleteMany({});
    await db.collection("transactions").insertMany(transactions);
    console.log(`✅ transactions: ${transactions.length} 筆`);
  }

  // ── checkins (array) ──────────────────────────────────────────────
  const checkins = data.checkins || [];
  if (checkins.length) {
    await db.collection("checkins").deleteMany({});
    await db.collection("checkins").insertMany(checkins);
    console.log(`✅ checkins: ${checkins.length} 筆`);
  }

  // ── shopItems (array) ─────────────────────────────────────────────
  const shopItems = data.shopItems || [];
  if (shopItems.length) {
    await db.collection("shopItems").deleteMany({});
    await db.collection("shopItems").insertMany(shopItems);
    console.log(`✅ shopItems: ${shopItems.length} 筆`);
  }

  // ── items (array) ─────────────────────────────────────────────────
  const items = data.items || [];
  if (items.length) {
    await db.collection("items").deleteMany({});
    await db.collection("items").insertMany(items);
    console.log(`✅ items: ${items.length} 筆`);
  }

  // ── adminActionLogs (array) ───────────────────────────────────────
  const adminActionLogs = data.adminActionLogs || [];
  if (adminActionLogs.length) {
    await db.collection("adminActionLogs").deleteMany({});
    await db.collection("adminActionLogs").insertMany(adminActionLogs);
    console.log(`✅ adminActionLogs: ${adminActionLogs.length} 筆`);
  }

  // ── accessControl (singleton) ─────────────────────────────────────
  if (data.accessControl) {
    await db.collection("accessControl").updateOne(
      { _id: "default" },
      { $set: { value: data.accessControl, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    console.log("✅ accessControl: 1 筆");
  }

  // ── channelLayout (singleton) ─────────────────────────────────────
  if (data.channelLayout) {
    await db.collection("channelLayout").updateOne(
      { _id: "default" },
      { $set: { value: data.channelLayout, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    console.log("✅ channelLayout: 1 筆");
  }

  // ── playerTiers (singleton) ───────────────────────────────────────
  if (data.playerTiers) {
    await db.collection("playerTiers").updateOne(
      { _id: "default" },
      { $set: { value: data.playerTiers, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    console.log("✅ playerTiers: 1 筆");
  }

  // ── 建立索引 ──────────────────────────────────────────────────────
  await Promise.all([
    db.collection("players").createIndex({ discordId: 1 }, { unique: true }),
    db.collection("wallets").createIndex({ playerId: 1 }, { unique: true }),
    db.collection("progress").createIndex({ playerId: 1 }, { unique: true }),
    db.collection("transactions").createIndex({ playerId: 1, createdAt: -1 }),
    db.collection("adminActionLogs").createIndex({ createdAt: -1 }),
    db.collection("checkins").createIndex({ discordId: 1, occurredAt: -1 }),
    db.collection("shopItems").createIndex({ id: 1 }, { unique: true }),
    db.collection("items").createIndex({ id: 1 }, { unique: true }),
  ]);
  console.log("✅ 索引建立完成");

  await client.close();
  console.log("\n🎉 遷移完成！");
}

migrate().catch((err) => {
  console.error("❌ 遷移失敗:", err.message);
  process.exit(1);
});
