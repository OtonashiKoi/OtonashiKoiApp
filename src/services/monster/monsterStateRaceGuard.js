const { normalMaxHp, scaleNormalMonster } = require("./normalCoopScaling");

function boundedMonsterCurrentHp(state, monster) {
  const maxHp = normalMaxHp(state, monster);
  if (state?.currentHp === undefined || state?.currentHp === null) return maxHp;
  const hp = Number(state.currentHp);
  return Number.isFinite(hp) ? Math.max(0, Math.min(maxHp, hp)) : maxHp;
}

async function repairMonsterHpOverflow({ monsterService, state, monster, zoneKey }) {
  const stateHp = Number(state?.currentHp);
  const maxHp = normalMaxHp(state, monster);
  if (state?.activeTransition || state?.activeEvent || Number(state?.activeMonsterSeq) !== Number(monster?.seq)) {
    return { state, repaired: false };
  }
  if (Number.isFinite(stateHp) && stateHp <= maxHp) return { state, repaired: false };
  const correctedState = { ...state, currentHp: maxHp };
  const repaired = await monsterService.saveStateIfActiveMonster(
    correctedState, zoneKey, monster.seq, state.currentHp
  );
  return { state: repaired ? correctedState : await monsterService.getState(zoneKey), repaired };
}

async function settleActiveMonsterDamage({
  monsterService, zoneKey, monster, discordId, displayName, playerLevel, totalDamage, totalTaken,
  selfDamage = totalDamage, directDamageBySource = {}, supportAssistBySource = {}, maxAttempts = 4
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const freshState = await monsterService.getState(zoneKey);
    if (
      Number(freshState?.activeMonsterSeq) !== Number(monster.seq) || freshState?.activeTransition ||
      freshState?.activeEvent || Number(freshState?.currentHp) <= 0
    ) break;
    const prev = freshState.damageMap || {};
    const damageMap = {
      ...prev,
      [discordId]: {
        name: displayName,
        level: playerLevel,
        damage: (prev[discordId]?.damage || 0) + selfDamage,
        taken: (prev[discordId]?.taken || 0) + totalTaken,
        assist: Number(prev[discordId]?.assist) || 0,
      }
    };
    for (const [sourceId, amount] of Object.entries(directDamageBySource)) {
      const damage = Math.max(0, Math.round(Number(amount) || 0));
      if (!sourceId || sourceId === discordId || damage <= 0) continue;
      const prior = damageMap[sourceId] || { name: sourceId, level: 1, damage: 0, taken: 0 };
      damageMap[sourceId] = { ...prior, damage: (Number(prior.damage) || 0) + damage };
    }
    for (const [sourceId, amount] of Object.entries(supportAssistBySource)) {
      const assist = Math.max(0, Math.round(Number(amount) || 0));
      if (!sourceId || sourceId === discordId || assist <= 0) continue;
      const prior = damageMap[sourceId] || { name: sourceId, level: 1, damage: 0, taken: 0 };
      damageMap[sourceId] = { ...prior, assist: (Number(prior.assist) || 0) + assist };
    }
    const participants = [...new Set([...(Array.isArray(freshState.participants) ? freshState.participants : []), discordId])];
    const scaled = scaleNormalMonster(freshState, monster, damageMap);
    const currentHp = Math.max(0, scaled.currentHp - totalDamage);
    const candidateState = { ...freshState, ...scaled, currentHp, damageMap, participants, lastHitAt: new Date().toISOString() };
    const saved = await monsterService.saveStateIfActiveMonster(
      candidateState, zoneKey, monster.seq, freshState.currentHp
    );
    if (saved) return { savedState: candidateState, currentHp, damageMap };
  }
  return { savedState: null, currentHp: null, damageMap: {} };
}

module.exports = { boundedMonsterCurrentHp, repairMonsterHpOverflow, settleActiveMonsterDamage };
