"use strict";
const { difficulty } = require("./partyTowerRules");

// Entry level and floor number are different concepts: high difficulty never starts at Lv.1.
const SEGMENTS = Object.freeze({
  normal: [
    { end: 10, label: "古城前庭", zones: ["ancient_city"], min: 20, max: 29, bossZones: ["ancient_city"], bossMin: 30, bossMax: 30 },
    { end: 20, label: "霧隱林地", zones: ["mistwood"], min: 30, max: 34, bossZones: ["mistwood"], bossMin: 40, bossMax: 40 },
    { end: 30, label: "霧林深處", zones: ["mistwood"], min: 35, max: 39, bossZones: ["mistwood"], bossMin: 40, bossMax: 40 },
  ],
  challenge: [
    { end: 10, label: "古城深處", zones: ["ancient_city_deep"], min: 40, max: 44, bossZones: ["ancient_city_deep"], bossMin: 50, bossMax: 50 },
    { end: 20, label: "龍族之領", zones: ["dragon_realm"], min: 40, max: 45, bossZones: ["dragon_realm"], bossMin: 50, bossMax: 50 },
    { end: 30, label: "地獄火焰", zones: ["hellfire"], min: 44, max: 47, bossZones: ["hellfire"], bossMin: 50, bossMax: 50 },
    { end: 40, label: "鐵鳴礦城", zones: ["metal_mine"], min: 44, max: 48, bossZones: ["metal_mine"], bossMin: 50, bossMax: 50 },
    { end: 50, label: "高階決戰", zones: ["ancient_city_deep", "dragon_realm", "hellfire", "metal_mine"], min: 48, max: 50,
      bossZones: ["ancient_city_deep", "dragon_realm", "hellfire", "metal_mine"], bossMin: 50, bossMax: 50 },
  ],
});

function encounterPlan(key, floor) {
  const d = difficulty(key);
  if (!Number.isInteger(floor) || floor < 1 || floor > d.totalFloors) throw new Error("樓層超出副本範圍");
  const bands = SEGMENTS[key], index = bands.findIndex(b => floor <= b.end), band = bands[index];
  const start = index ? bands[index - 1].end + 1 : 1;
  const isBoss = floor % 5 === 0;
  return { ...band, start, isBoss, target: isBoss ? band.bossMax : band.min + (band.max - band.min) * (floor - start) / (band.end - start) };
}

function encounterPool(all, key, floor) {
  const plan = encounterPlan(key, floor);
  const min = plan.isBoss ? plan.bossMin : plan.min, max = plan.isBoss ? plan.bossMax : plan.max;
  const zones = plan.isBoss ? plan.bossZones : plan.zones;
  return all.filter(m => m.enabled !== false && !m.allZones && zones.includes(m.zone)
    && Boolean(m.isBoss) === plan.isBoss && Number(m.level) >= min && Number(m.level) <= max);
}

function pickMonster(all, key, floor, random = Math.random) {
  const plan = encounterPlan(key, floor), pool = encounterPool(all, key, floor);
  if (!pool.length) throw Object.assign(new Error(`第 ${floor} 樓「${plan.label}」缺少${plan.isBoss ? "BOSS" : "怪物"}資料`), { status: 503 });
  const distance = Math.min(...pool.map(m => Math.abs(Number(m.level) - plan.target)));
  const nearest = pool.filter(m => Math.abs(Number(m.level) - plan.target) === distance);
  return nearest[Math.min(nearest.length - 1, Math.floor(random() * nearest.length))];
}

module.exports = { SEGMENTS, encounterPlan, encounterPool, pickMonster };
