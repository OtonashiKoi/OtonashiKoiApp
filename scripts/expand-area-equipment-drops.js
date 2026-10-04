#!/usr/bin/env node
"use strict";

// Add ordinary-monster sources for non-S equipment currently confined to a
// boss in its area. Boss cards and S equipment keep their existing sources.
// Dry-run by default. --apply requires a verified pre-change BSON backup.

require("dotenv").config();
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { MongoClient } = require("mongodb");

const AREA_ZONES = [
  "beginner", "normal", "mid", "ancient_city", "ancient_city_deep",
  "dragon_realm", "hellfire"
];
const WORLD_BOSS_TARGETS = {
  elite: "ancient_city_deep",
  dragon_king_lair: "dragon_realm",
  hellfire_depths: "hellfire"
};
const CHANCE_BY_TIER = { D: 1.5, C: 1, B: 0.9, A: 0.5 };

function isOrdinaryEquipment(item) {
  return item?.itemType === "equipment"
    && ["D", "C", "B", "A"].includes(String(item.tier || "").toUpperCase())
    && item.equipSlot !== "special"
    && !item.monsterCardOf
    && !item.monsterCardSkill
    && !/卡$/.test(String(item.name || ""));
}

function chanceFor(tier, zone) {
  const base = CHANCE_BY_TIER[tier];
  // Keep gear one tier above the area's main progression scarce at entry.
  if ((zone === "beginner" || zone === "normal") && tier === "C") return 0.4;
  if (zone === "mid" && tier === "B") return 0.35;
  return base;
}

function buildPlan(monsters, items) {
  const itemById = new Map(items.map((item) => [String(item.id), item]));
  const monstersByZone = new Map(AREA_ZONES.map((zone) => [zone, monsters.filter((m) => m.enabled && m.zone === zone)]));
  const planned = new Map();
  const normalSourceIds = new Set();
  const bossesByItem = new Map();

  for (const monster of monsters.filter((m) => m.enabled && m.zone && !m.zone.startsWith("event"))) {
    for (const drop of monster.drops || []) {
      const id = String(drop.itemId);
      if (!isOrdinaryEquipment(itemById.get(id))) continue;
      if (monster.isBoss) {
        if (!bossesByItem.has(id)) bossesByItem.set(id, new Set());
        bossesByItem.get(id).add(monster.zone);
      } else {
        normalSourceIds.add(id);
      }
    }
  }

  function hasNormalSourceInZone(itemId, zone) {
    return (monstersByZone.get(zone) || []).some((monster) => !monster.isBoss &&
      ((monster.drops || []).some((drop) => String(drop.itemId) === itemId)
        || (planned.get(String(monster._id)) || []).some((drop) => drop.itemId === itemId)));
  }

  function addSources(itemId, zone) {
    if (hasNormalSourceInZone(itemId, zone)) return;
    const item = itemById.get(itemId);
    const candidates = (monstersByZone.get(zone) || []).filter((monster) => !monster.isBoss)
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0) || String(a.id).localeCompare(String(b.id)));
    if (!candidates.length) throw new Error(`No enabled normal monster for ${zone}`);
    const start = crypto.createHash("sha256").update(`${zone}:${itemId}`).digest().readUInt32BE(0) % candidates.length;
    for (let offset = 0; offset < Math.min(2, candidates.length); offset++) {
      const monster = candidates[(start + offset) % candidates.length];
      const key = String(monster._id);
      if (!planned.has(key)) planned.set(key, []);
      planned.get(key).push({ itemId, itemName: item.name, chance: chanceFor(item.tier, zone) });
    }
    normalSourceIds.add(itemId);
  }

  // Equipment on an area's boss becomes obtainable from two of its ordinary monsters.
  for (const zone of AREA_ZONES) {
    const ids = [...bossesByItem.entries()].filter(([, zones]) => zones.has(zone)).map(([id]) => id).sort();
    for (const itemId of ids) addSources(itemId, zone);
  }

  // World-boss-only A gear also needs a normal-area source; S gear is excluded above.
  for (const [itemId, sourceZones] of [...bossesByItem.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (normalSourceIds.has(itemId)) continue;
    const worldZone = Object.keys(WORLD_BOSS_TARGETS).find((zone) => sourceZones.has(zone));
    if (worldZone) addSources(itemId, WORLD_BOSS_TARGETS[worldZone]);
  }

  return [...planned.entries()].map(([monsterId, drops]) => ({
    monster: monsters.find((m) => String(m._id) === monsterId),
    drops
  }));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const backupArg = process.argv.find((arg) => arg.startsWith("--backup-dir="));
  const backupDir = backupArg?.slice("--backup-dir=".length);
  if (apply && (!backupDir || !fs.existsSync(path.join(backupDir, "monsters.bson")))) {
    throw new Error("--apply requires --backup-dir=PATH with monsters.bson");
  }
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");
    const [monsters, items] = await Promise.all([
      db.collection("monsters").find({ id: { $exists: true } }).toArray(),
      db.collection("items").find({}, { projection: { id: 1, name: 1, itemType: 1, tier: 1, equipSlot: 1, monsterCardOf: 1, monsterCardSkill: 1 } }).toArray()
    ]);
    const plan = buildPlan(monsters, items);
    const added = plan.reduce((sum, row) => sum + row.drops.length, 0);
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", monsters: plan.length, added, byZone: plan.reduce((out, row) => {
      out[row.monster.zone] = (out[row.monster.zone] || 0) + row.drops.length;
      return out;
    }, {}) }, null, 2));
    if (!apply) return;
    let committed = 0;
    for (const { monster, drops } of plan) {
      for (const drop of drops) {
        const result = await db.collection("monsters").updateOne(
          { _id: monster._id, "drops.itemId": { $ne: drop.itemId } },
          { $push: { drops: drop }, $set: { updatedAt: new Date().toISOString() } }
        );
        if (result.modifiedCount !== 1) throw new Error(`Drop was not added: ${monster.name} / ${drop.itemName}`);
        committed++;
      }
    }
    console.log(`Committed ${committed} new ordinary-monster drop entries`);
  } finally {
    await client.close();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildPlan, isOrdinaryEquipment, chanceFor };
