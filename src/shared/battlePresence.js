"use strict";

const monsterBattlePlayers = new Set();
const pkBattlePlayers = new Set();

function setPresence(targetSet, ids = [], enabled = true) {
  const list = Array.isArray(ids) ? ids : [ids];
  for (const id of list) {
    if (!id) continue;
    if (enabled) targetSet.add(id);
    else targetSet.delete(id);
  }
}

function replacePresence(targetSet, ids = []) {
  targetSet.clear();
  setPresence(targetSet, ids, true);
}

function getBattlePresenceState() {
  return {
    monster: [...monsterBattlePlayers],
    pk: [...pkBattlePlayers],
  };
}

function setMonsterBattlePresence(ids = [], enabled = true) {
  setPresence(monsterBattlePlayers, ids, enabled);
}

function clearMonsterBattlePresence(ids = []) {
  setPresence(monsterBattlePlayers, ids, false);
}

function isMonsterBattleActive(discordId) {
  return monsterBattlePlayers.has(discordId);
}

function replaceMonsterBattlePresence(ids = []) {
  replacePresence(monsterBattlePlayers, ids);
}

function setPkBattlePresence(ids = [], enabled = true) {
  setPresence(pkBattlePlayers, ids, enabled);
}

function clearPkBattlePresence(ids = []) {
  setPresence(pkBattlePlayers, ids, false);
}

function isPkBattleActive(discordId) {
  return pkBattlePlayers.has(discordId);
}

function replacePkBattlePresence(ids = []) {
  replacePresence(pkBattlePlayers, ids);
}

module.exports = {
  getBattlePresenceState,
  setMonsterBattlePresence,
  clearMonsterBattlePresence,
  isMonsterBattleActive,
  replaceMonsterBattlePresence,
  setPkBattlePresence,
  clearPkBattlePresence,
  isPkBattleActive,
  replacePkBattlePresence,
};
