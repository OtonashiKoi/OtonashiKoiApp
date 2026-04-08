/**
 * 修正中階區（mid）monsterState 卡住問題並觸發重發面板
 * 症狀：activeMonsterSeq 為預設值 1，但中階區怪物 seq 從 6 開始
 * 執行：node scripts/fix-mid-zone-state.js
 */
"use strict";

require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const API_BASE = `http://localhost:${config.api.port}`;

async function main() {
  const mongoUri = config.storage.mongoUri;
  const dbName   = config.storage.mongoDbName;

  if (!mongoUri) {
    console.error("❌ MONGODB_URI 未設定");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(dbName);

  // 1. 讀取現有 mid state
  const stateCol = db.collection("monsterState");
  const existing = await stateCol.findOne({ _id: "mid" });
  console.log("📋 現有 mid state:", JSON.stringify(existing?.value || null, null, 2));

  // 2. 找第一個啟用中的 mid 怪物
  const monstersCol = db.collection("monsters");
  const midMonsters = await monstersCol
    .find({ zone: "mid", enabled: true })
    .sort({ seq: 1 })
    .toArray();

  if (!midMonsters.length) {
    console.error("❌ 找不到任何啟用中的中階區怪物，請先在後台啟用怪物");
    await client.close();
    process.exit(1);
  }

  const first = midMonsters[0];
  // 簡單計算 maxHp（與 calcStats 一致）
  const maxHp = (first.vit || 1) * 15 + 50;

  const correctedState = {
    activeMonsterSeq: first.seq,
    currentHp: maxHp,
    killCount: existing?.value?.killCount || {},
    participants: [],
    damageMap: {}
  };
  console.log(`✅ 修正為 seq=${first.seq}（${first.name}），HP=${maxHp}`);

  // 3. 寫回 DB
  await stateCol.updateOne(
    { _id: "mid" },
    { $set: { value: correctedState, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  console.log("✅ DB state 已更新");

  await client.close();

  // 4. 呼叫 admin API 重發中階區面板
  console.log("🔄 嘗試透過 API 重發中階區面板...");
  try {
    const http = require("http");

    // 取得 channel layout 找到 monster_zone_mid 的 channelId
    const layoutRes = await httpGet(`${API_BASE}/admin/channel-layout`);
    const bindings = layoutRes?.data?.discord?.bindings || [];
    const midBinding = bindings.find((b) => b.featureKey === "monster_zone_mid");

    if (!midBinding?.channelId) {
      console.warn("⚠️  找不到 monster_zone_mid 的 channelId 綁定，請手動從管理後台重發面板");
    } else {
      const publishRes = await httpPost(
        `${API_BASE}/admin/channel-layout/publish-monster-zone`,
        { channelId: midBinding.channelId }
      );
      console.log("✅ 面板重發成功：", JSON.stringify(publishRes));
    }
  } catch (e) {
    console.warn("⚠️  API 呼叫失敗（Bot 可能尚未啟動）：", e.message);
    console.warn("   → 請手動從管理後台「重發面板」中階區");
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname } = new URL(url);
    const req = require("http").request(
      { hostname, port: Number(port) || 80, path: pathname, method: "GET",
        headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const { hostname, port, pathname } = new URL(url);
    const req = require("http").request(
      { hostname, port: Number(port) || 80, path: pathname, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
