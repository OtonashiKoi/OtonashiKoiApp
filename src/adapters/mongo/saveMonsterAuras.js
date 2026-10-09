"use strict";

// Aura admission owns only these two fields, never a combat/transition snapshot.
async function saveMonsterAuras({ collection, state, auras, zoneKey }) {
  const filter = {
    "value.activeMonsterSeq": state.activeMonsterSeq,
    "value.currentHp": { $gt: 0 },
    "value.activeTransition": null,
    "value.activeEvent": null,
    "value.normalLiveSpawnAt": state.normalLiveSpawnAt ?? null,
    "value.activeHealerAuras": state.activeHealerAuras ?? null,
    "value.activeHealerAura": state.activeHealerAura ?? null,
  };
  const update = { $set: { "value.activeHealerAuras": auras, "value.activeHealerAura": null, updatedAt: new Date().toISOString() } };
  const primary = await collection("monsters");
  const id = `monsterState:${zoneKey}`;
  const result = await primary.updateOne({ _id: id, ...filter }, update);
  if (!result.matchedCount && await primary.findOne({ _id: id }, { projection: { _id: 1 } })) return false;
  const legacy = await (await collection("monsterState")).updateOne({ _id: zoneKey, ...filter }, update);
  return Boolean(result.matchedCount || legacy.matchedCount);
}

module.exports = { saveMonsterAuras };
