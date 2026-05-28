"use strict";
/**
 * 重發所有有面板的頻道
 * 透過後台 API 呼叫各個 publish endpoint
 */
require("dotenv").config();
const http = require("node:http");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const API_HOST = process.env.ADMIN_API_HOST || "127.0.0.1";
const API_PORT = Number(process.env.ADMIN_API_PORT || process.env.PORT || 5566);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// featureKey → 對應的 publish endpoint
const PUBLISH_MAP = {
  player_panel:                   "/admin/channel-layout/publish-player-panel",
  player_query:                   "/admin/channel-layout/publish-player-query",
  coin_shop:                      "/admin/channel-layout/publish-coin-shop",
  weekly_quest:                   "/admin/channel-layout/publish-weekly-quest",
  daily_quest:                    "/admin/channel-layout/publish-daily-quest",
  idle_zone:                      "/admin/channel-layout/publish-idle-zone",
  pet_panel:                      "/admin/channel-layout/publish-pet-panel",
  casino_wheel:                   "/admin/channel-layout/publish-casino",
  pk_arena:                       "/admin/channel-layout/publish-pk-arena",
  tower_hall:                     "/admin/channel-layout/publish-tower-hall",
  auction_house:                  "/admin/auction/publish",
  // monster zones（共用同一個 endpoint，自動依 channelId 對應 featureKey 推 zone）
  monster_zone_beginner:          "/admin/channel-layout/publish-monster-zone",
  monster_zone:                   "/admin/channel-layout/publish-monster-zone",
  monster_zone_mid:               "/admin/channel-layout/publish-monster-zone",
  monster_zone_ancient_city:      "/admin/channel-layout/publish-monster-zone",
  monster_zone_ancient_city_deep: "/admin/channel-layout/publish-monster-zone",
  monster_zone_dragon_realm:      "/admin/channel-layout/publish-monster-zone",
  monster_zone_elite:             "/admin/channel-layout/publish-monster-zone",
};

function callApi(path, channelId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ channelId });
    const req = http.request({
      host: API_HOST,
      port: API_PORT,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Authorization": `Bearer ${ADMIN_PASSWORD}`,
      },
      timeout: 15_000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (err) => { resolve({ status: 0, body: err.message }); });
    req.write(body);
    req.end();
  });
}

async function main() {
  const db = await getMongoDb();
  const layout = await db.collection("channelLayout").findOne({ _id: "default" });
  // 注意：value.discord.bindings 才是實際資料
  const bindings = layout?.value?.discord?.bindings || layout?.discord?.bindings || [];
  const targets = bindings.filter((b) => b.enabled && b.channelId && PUBLISH_MAP[b.featureKey]);

  console.log(`API: http://${API_HOST}:${API_PORT}`);
  console.log(`要重發的面板：${targets.length} 個`);
  console.log("─".repeat(80));

  let ok = 0, fail = 0;
  for (const b of targets) {
    const path = PUBLISH_MAP[b.featureKey];
    const label = `${b.featureKey.padEnd(35)} → ${b.channelId}`;
    process.stdout.write(`▶ ${label} ... `);
    const result = await callApi(path, b.channelId);
    if (result.status >= 200 && result.status < 300) {
      console.log(`✅ HTTP ${result.status}`);
      ok++;
    } else {
      console.log(`❌ HTTP ${result.status}：${(result.body || "").slice(0, 120)}`);
      fail++;
    }
    // 間隔 600ms 緩衝 Discord rate limit
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log("─".repeat(80));
  console.log(`完成：成功 ${ok} ／ 失敗 ${fail}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
