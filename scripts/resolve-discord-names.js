#!/usr/bin/env node
"use strict";
// 把 displayName 還是純數字 Discord ID(或空)的玩家，去 Discord 抓真實名稱回填。
//   解析優先序：伺服器暱稱 nick → 全域顯示名 global_name → 帳號名 username。
//   已離開伺服器者退回 GET /users/{id}。抓不到就維持原樣(不覆蓋)。
//   預設 dry-run 只預覽；加 --apply 實際寫入 players.displayName。可重跑(idempotent)。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const API = "https://discord.com/api/v10";
const APPLY = process.argv.includes("--apply");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isNumericName = (dn, id) => {
  const s = String(dn || "").trim();
  return !s || s === String(id) || /^\d{15,}$/.test(s);
};

async function dcGet(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${TOKEN}` } });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const wait = Math.ceil((Number(body.retry_after) || 1) * 1000) + 100;
      await sleep(wait);
      continue;
    }
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return { error: `${res.status}` };
    return { data: await res.json() };
  }
  return { error: "rate-limited-giveup" };
}

async function resolveName(id) {
  // 1) 伺服器成員(有暱稱優先)
  const m = await dcGet(`/guilds/${GUILD_ID}/members/${id}`);
  if (m.data) {
    const u = m.data.user || {};
    return { name: m.data.nick || u.global_name || u.username || "", via: m.data.nick ? "nick" : (u.global_name ? "global_name" : "username"), inGuild: true };
  }
  // 2) 已離開伺服器 → 查帳號
  const u = await dcGet(`/users/${id}`);
  if (u.data) return { name: u.data.global_name || u.data.username || "", via: u.data.global_name ? "global_name(left)" : "username(left)", inGuild: false };
  return { name: "", via: m.notFound || u.notFound ? "not-found" : (m.error || u.error || "error"), inGuild: false };
}

(async () => {
  if (!TOKEN || !GUILD_ID) { console.error("缺 DISCORD_TOKEN / DISCORD_GUILD_ID"); process.exit(1); }
  const client = new MongoClient(process.env.MONGO_URL || "mongodb://127.0.0.1:27017");
  await client.connect();
  const db = client.db(process.env.MONGO_DB || "equipmentGame");
  const players = db.collection("players");
  const targets = (await players.find({}).toArray()).filter((p) => isNumericName(p.displayName, p.discordId));

  console.log(`需解析 ${targets.length} 位（displayName 為數字/空）\n`);
  let updated = 0, unresolved = 0;
  const unresolvedList = [];
  for (const p of targets) {
    const r = await resolveName(p.discordId);
    const name = String(r.name || "").trim();
    // 抓回來還是純數字/空 → 視為無效，不覆蓋
    if (!name || isNumericName(name, p.discordId)) { unresolved++; unresolvedList.push(`${p.discordId} (${r.via})`); await sleep(220); continue; }
    console.log(`${APPLY ? "SET " : "would"} ${p.discordId} → ${name}  [${r.via}${r.inGuild ? "" : " ·已離開"}]`);
    if (APPLY) { await players.updateOne({ discordId: p.discordId }, { $set: { displayName: name } }); updated++; }
    await sleep(220); // 避免 Discord 限流
  }

  console.log(`\n[${APPLY ? "APPLIED" : "DRY-RUN"}] 解析成功 ${APPLY ? updated : (targets.length - unresolved)}／${targets.length}｜無法解析 ${unresolved}`);
  if (unresolvedList.length) console.log("無法解析(維持原樣):\n  " + unresolvedList.join("\n  "));
  if (!APPLY) console.log("\n（預覽模式。確認無誤後加 --apply 實際寫入）");
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
