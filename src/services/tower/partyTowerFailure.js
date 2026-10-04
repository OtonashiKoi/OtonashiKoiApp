"use strict";

// Explain only facts captured by this floor; never infer missing healing or deaths.
function analyzePartyFailure(room, result, maxHp) {
  const members = room.members || [];
  const initial = room.liveCombat?.initialMembers || [];
  const alive = new Map(initial.map(m => [m.discordId, m.currentHp > 0]));
  const deathChain = [];
  for (const [index, action] of (result.memberLogs || []).entries()) {
    for (const hp of action.partyHpAfter || []) {
      if (alive.get(hp.discordId) === true && hp.hp <= 0) {
        const member = members.find(m => m.discordId === hp.discordId);
        deathChain.push({ discordId: hp.discordId, name: member?.name || hp.name,
          role: member?.towerRole, action: index + 1 });
      }
      alive.set(hp.discordId, hp.hp > 0);
    }
  }
  const summary = result.summary || {};
  const sum = rows => (rows || []).reduce((n, row) => n + Math.max(0, Number(row.value) || 0), 0);
  const remainingHp = Math.max(0, Math.round(Number(result.monsterHpFinal) || 0));
  const evidence = { remainingHp, remainingHpPct: maxHp > 0 ? Math.min(100, Math.round(remainingHp / maxHp * 100)) : null,
    damageTaken: summary.damageTaken || [], healing: summary.healing || [], deathChain };
  let reason = `全隊倒地；怪物剩餘 ${remainingHp} HP${evidence.remainingHpPct === null ? "" : `（${evidence.remainingHpPct}%）`}。`;
  if (Array.isArray(summary.damageTaken) && Array.isArray(summary.healing)) {
    reason += `本層承傷 ${sum(summary.damageTaken)}／治療 ${sum(summary.healing)}。`;
  }
  if (deathChain.length) reason += `倒地順序：${deathChain.map(d => `${d.name}（第${d.action}行動）`).join(" → ")}。`;
  return { reason, evidence };
}

module.exports = { analyzePartyFailure };
