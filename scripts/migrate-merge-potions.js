#!/usr/bin/env node
"use strict";
// 一次性：把各玩家背包裡分散的「可疊藥水」合併成一堆(stackCount)。
// 與 shared/inventoryStacking.js 的 normalize 同邏輯(同款 itemId 合併、保留第一件、加總 stackCount)。
// 之後靠 normalize 在存檔/讀取時自動維持；此腳本只是讓現況立即生效。可重跑(idempotent)。
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { isStackMergeable } = require("../src/shared/inventoryStacking");
const APPLY = process.argv.includes("--apply");

function mergeInv(inv) {
  if (!Array.isArray(inv)) return { inv, changed: false };
  const out = [];
  const byId = new Map();
  let changed = false;
  for (const e of inv) {
    if (!e || typeof e !== "object" || e.locked || !isStackMergeable(e.itemId)) { out.push(e); continue; }
    const id = String(e.itemId);
    const cnt = Math.max(1, Math.trunc(Number(e.stackCount) || 1));
    const ex = byId.get(id);
    if (ex) { ex.stackCount = Math.max(1, Number(ex.stackCount) || 1) + cnt; changed = true; continue; }
    const norm = { ...e, stackCount: cnt };
    byId.set(id, norm);
    out.push(norm);
  }
  return { inv: out, changed };
}

(async () => {
  const c = new MongoClient(process.env.MONGO_URL || "mongodb://127.0.0.1:27017");
  await c.connect();
  const db = c.db(process.env.MONGO_DB || "equipmentGame");
  const col = db.collection("progress");
  const all = await col.find({}).toArray();
  let touched = 0, slotsSaved = 0;
  for (const p of all) {
    const before = (p.inventory || []).length;
    const { inv, changed } = mergeInv(p.inventory || []);
    if (!changed) continue;
    touched++;
    slotsSaved += before - inv.length;
    if (APPLY) await col.updateOne({ _id: p._id }, { $set: { inventory: inv, updatedAt: new Date().toISOString() } });
  }
  console.log(`[${APPLY ? "APPLIED" : "DRY-RUN"}] 玩家 ${all.length}｜需合併 ${touched} 位｜共省 ${slotsSaved} 格背包`);
  if (!APPLY) console.log("（預覽。加 --apply 實際寫入）");
  await c.close();
})().catch((e) => { console.error(e); process.exit(1); });
