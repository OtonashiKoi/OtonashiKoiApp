function boundedMonsterCurrentHp(state, monster) {
  const maxHp = Math.max(0, Number(monster?.calc?.maxHp) || 0);
  if (state?.currentHp === undefined || state?.currentHp === null) return maxHp;
  const hp = Number(state.currentHp);
  return Number.isFinite(hp) ? Math.max(0, Math.min(maxHp, hp)) : maxHp;
}

async function repairMonsterHpOverflow({ monsterService, state, monster, zoneKey }) {
  const stateHp = Number(state?.currentHp);
  const maxHp = Math.max(1, Number(monster?.calc?.maxHp) || 1);
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
  monsterService, zoneKey, monster, discordId, displayName, playerLevel, totalDamage, totalTaken, maxAttempts = 4
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
        damage: (prev[discordId]?.damage || 0) + totalDamage,
        taken: (prev[discordId]?.taken || 0) + totalTaken,
      }
    };
    const participants = [...new Set([...(Array.isArray(freshState.participants) ? freshState.participants : []), discordId])];
    const currentHp = Math.max(0, boundedMonsterCurrentHp(freshState, monster) - totalDamage);
    const candidateState = { ...freshState, currentHp, damageMap, participants };
    const saved = await monsterService.saveStateIfActiveMonster(
      candidateState, zoneKey, monster.seq, freshState.currentHp
    );
    if (saved) return { savedState: candidateState, currentHp, damageMap };
  }
  return { savedState: null, currentHp: null, damageMap: {} };
}

module.exports = { boundedMonsterCurrentHp, repairMonsterHpOverflow, settleActiveMonsterDamage };
