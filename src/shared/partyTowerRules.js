"use strict";
const { normalizeTowerRole } = require("./towerRoles");
const DIFFICULTIES = Object.freeze({
  normal: { key: "normal", label: "一般", minLevel: 30, totalFloors: 30 },
  challenge: { key: "challenge", label: "挑戰", minLevel: 40, totalFloors: 50 },
});
const ROLES = Object.freeze({
  tank: { hp: 1.2, defense: 1.2, damage: 0.7, dodge: 1, aura: 1, label: "坦克", emoji: "🛡️" },
  support: { hp: 1, defense: 0.8, damage: 1, dodge: 1, aura: 1.25, label: "輔助", emoji: "💚" },
  dps: { hp: 0.85, defense: 0.8, damage: 1.2, dodge: 0.8, aura: 1, label: "輸出", emoji: "⚔️" },
});
function difficulty(key = "normal") {
  if (!DIFFICULTIES[key]) throw new Error("請選擇一般或挑戰難度");
  return DIFFICULTIES[key];
}
function roleStats(stats, role) {
  const r = ROLES[normalizeTowerRole(role)];
  if (!r) throw new Error("請選擇坦克、輔助或輸出");
  const next = { ...stats, maxHp: Math.max(1, Math.round(stats.maxHp * r.hp)) };
  for (const key of ["def", "flatDef", "mdef", "magicDef", "flatMagicDef"]) {
    if (typeof stats[key] === "number") next[key] = stats[key] * r.defense;
  }
  next.dodge = Number(stats.dodge || 0) * r.dodge;
  return next;
}
function assertParty(members, key, requireReady = true) {
  const d = difficulty(key);
  if (members.length < 2 || members.length > 5) throw new Error("組隊需要 2～5 人，單人不能出發");
  if (members.filter(m => m.towerRole === "tank").length !== 1) throw new Error("隊伍必須恰好有一名坦克");
  if (members.some(m => !ROLES[m.towerRole])) throw new Error("所有隊員都必須選擇站位");
  if (members.some(m => m.level < d.minLevel)) throw new Error(`所有出戰人物都需要 Lv.${d.minLevel} 以上`);
  if (requireReady && members.some(m => !m.ready)) throw new Error("請等待所有隊員準備完成");
}
function selectTarget(members, damage, random = Math.random) {
  const living = members.filter(m => m.currentHp > 0);
  for (const role of ["tank", "dps", "support"]) {
    const group = living.filter(m => m.towerRole === role);
    if (!group.length) continue;
    const max = Math.max(...group.map(m => Number(damage.get(m.discordId)?.damageDealt || 0)));
    const tied = group.filter(m => Number(damage.get(m.discordId)?.damageDealt || 0) === max);
    return tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))];
  }
  return null;
}
function scaleMonster(monster, key = "normal") {
  const calc = { ...monster.calc };
  calc.maxHp = Math.max(1, Math.round(Number(calc.maxHp || monster.maxHp || 1) * 5));
  const attackMultiplier = key === "challenge" ? (monster.isBoss ? 2.5 : 2) : 1.5;
  calc.atk = Math.max(1, Math.round(Number(calc.atk || 1) * attackMultiplier));
  return { ...monster, calc };
}
module.exports = { DIFFICULTIES, ROLES, difficulty, roleStats, assertParty, selectTarget, scaleMonster };
