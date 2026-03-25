const { readData, writeData } = require("../db/store");
const { createItem, totalStats } = require("./equipmentService");
const { fight } = require("./monsterService");

function createNewUser(discordId, name) {
  return {
    discordId,
    name,
    level: 1,
    exp: 0,
    gold: 100,
    stats: { str: 5, dex: 5, int: 5 },
    equipped: { weapon: null, armor: null, accessory: null },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const rarityRank = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5
};

function itemScore(item) {
  if (!item) return 0;
  const rarity = rarityRank[item.rarity] || 0;
  const stats = (item.stats.atk || 0) + (item.stats.def || 0) + Math.floor((item.stats.hp || 0) * 0.2);
  return rarity * 10000 + stats;
}

function normalizeUserModel(user) {
  // Migration: older versions stored inventory + equipped item IDs.
  if (!user.equipped) {
    user.equipped = { weapon: null, armor: null, accessory: null };
  }

  if (Array.isArray(user.inventory) && user.inventory.length > 0) {
    for (const slot of ["weapon", "armor", "accessory"]) {
      const eqValue = user.equipped[slot];
      if (eqValue && typeof eqValue === "string") {
        const found = user.inventory.find((it) => it.id === eqValue);
        if (found) user.equipped[slot] = found;
      }

      if (!user.equipped[slot] || typeof user.equipped[slot] === "string") {
        const best = user.inventory
          .filter((it) => it.slot === slot)
          .sort((a, b) => itemScore(b) - itemScore(a))[0];
        if (best) user.equipped[slot] = best;
      }
    }
  }

  delete user.inventory;
}

function expToNext(level) {
  return Math.floor(100 * Math.pow(1.18, level - 1));
}

function gainExp(user, amount) {
  user.exp += amount;
  while (user.exp >= expToNext(user.level)) {
    user.exp -= expToNext(user.level);
    user.level += 1;
    user.stats.str += 1;
    user.stats.dex += 1;
    user.stats.int += 1;
    user.gold += 20 * user.level;
  }
}

function equippedItems(user) {
  return Object.values(user.equipped).filter(Boolean);
}

async function getOrCreateUser(discordId, name) {
  const data = await readData();
  if (!data.users[discordId]) {
    data.users[discordId] = createNewUser(discordId, name);
  }
  normalizeUserModel(data.users[discordId]);
  await writeData(data);
  return data.users[discordId];
}

async function openChest(discordId, name) {
  const data = await readData();
  const user = data.users[discordId] || createNewUser(discordId, name);
  data.users[discordId] = user;
  normalizeUserModel(user);

  const chestCost = 35;
  if (user.gold < chestCost) {
    return { ok: false, reason: "gold", user };
  }

  user.gold -= chestCost;
  const item = createItem({ userLevel: user.level });
  const current = user.equipped[item.slot];
  const upgraded = itemScore(item) > itemScore(current);

  if (upgraded) {
    user.equipped[item.slot] = item;
  }

  gainExp(user, 15);
  user.updatedAt = new Date().toISOString();

  await writeData(data);
  return { ok: true, item, user, upgraded, replaced: current || null };
}

async function getInventory(discordId, name) {
  const user = await getOrCreateUser(discordId, name);
  return Object.values(user.equipped).filter(Boolean);
}

async function getProfile(discordId, name) {
  const user = await getOrCreateUser(discordId, name);
  const bonus = totalStats(equippedItems(user));
  const power = Math.floor(
    user.stats.str + user.stats.dex + user.stats.int + bonus.atk + bonus.def + bonus.hp * 0.2
  );
  return { user, bonus, power, nextExp: expToNext(user.level) };
}

function buildStatusRows(level, power, bonus) {
  const basePower = Math.max(1, Math.floor(power - bonus.atk - bonus.def - bonus.hp * 0.2));
  const str = Math.max(1, Math.floor(basePower * 0.52));
  const agi = Math.max(1, Math.floor(level * 2 + 5));
  const vit = Math.max(1, Math.floor(level * 2 + 6));
  const intStat = Math.max(1, Math.floor(level * 2 + 4));
  const dex = Math.max(1, Math.floor(level * 2 + 5));
  const luk = Math.max(1, Math.floor(level + 2));

  const atk = power + bonus.atk;
  const def = Math.floor(power * 0.6 + bonus.def);
  const matk = Math.floor(intStat * 3 + bonus.atk * 0.8);
  const mdef = Math.floor(intStat * 2 + bonus.def * 0.7);
  const hit = Math.floor(dex * 2 + level * 3);
  const flee = Math.floor(agi * 2 + bonus.def);
  const aspd = Math.min(195, 150 + agi + Math.floor(level * 0.8));

  return [
    { leftLabel: "Str", leftValue: `${str}+${bonus.atk}`, rightLabel: "Atk", rightValue: atk },
    { leftLabel: "Agi", leftValue: `${agi}+${bonus.def}`, rightLabel: "Def", rightValue: def },
    { leftLabel: "Vit", leftValue: `${vit}+${Math.floor(bonus.hp * 0.1)}`, rightLabel: "Matk", rightValue: matk },
    { leftLabel: "Int", leftValue: `${intStat}+${Math.floor((bonus.atk + bonus.def) * 0.1)}`, rightLabel: "Mdef", rightValue: mdef },
    { leftLabel: "Dex", leftValue: `${dex}+${Math.floor(bonus.atk * 0.2)}`, rightLabel: "Hit", rightValue: hit },
    { leftLabel: "Luk", leftValue: `${luk}+${Math.floor(bonus.def * 0.1)}`, rightLabel: "Flee", rightValue: flee },
    { leftLabel: "", leftValue: "", rightLabel: "Aspd", rightValue: aspd }
  ];
}

async function getPanelData(discordId, name) {
  const { user, bonus, power, nextExp } = await getProfile(discordId, name);
  return {
    user: {
      discordId: user.discordId,
      name: user.name,
      level: user.level,
      exp: user.exp,
      nextExp,
      gold: user.gold,
      equipped: user.equipped
    },
    bonus,
    power,
    statusRows: buildStatusRows(user.level, power, bonus)
  };
}

async function fightMonster(discordId, name, monsterId) {
  const data = await readData();
  const user = data.users[discordId] || createNewUser(discordId, name);
  data.users[discordId] = user;
  normalizeUserModel(user);

  const bonus = totalStats(equippedItems(user));
  const result = fight(user, bonus, monsterId);

  user.gold += result.rewards.gold;
  gainExp(user, result.rewards.exp);
  user.updatedAt = new Date().toISOString();

  await writeData(data);
  return { user, bonus, result };
}

async function topByPower(limit = 10) {
  const data = await readData();
  const rows = Object.values(data.users).map((user) => {
    normalizeUserModel(user);
    const bonus = totalStats(equippedItems(user));
    const power = Math.floor(
      user.stats.str + user.stats.dex + user.stats.int + bonus.atk + bonus.def + bonus.hp * 0.2
    );
    return { discordId: user.discordId, name: user.name, level: user.level, power };
  });

  rows.sort((a, b) => b.power - a.power);
  return rows.slice(0, limit);
}

module.exports = {
  getOrCreateUser,
  openChest,
  getInventory,
  getProfile,
  getPanelData,
  fightMonster,
  topByPower
};
