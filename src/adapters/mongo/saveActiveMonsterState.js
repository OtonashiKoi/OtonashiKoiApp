async function saveActiveMonsterState({ collection, state, zoneKey, expectedMonsterSeq, expectedCurrentHp }) {
  const stateDocId = `monsterState:${zoneKey}`;
  const now = new Date().toISOString();
  const activeStateFilter = {
    "value.activeMonsterSeq": Number(expectedMonsterSeq),
    "value.activeTransition": null,
    "value.activeEvent": null,
    "value.currentHp": expectedCurrentHp !== null && expectedCurrentHp !== undefined && Number.isFinite(Number(expectedCurrentHp))
      ? Number(expectedCurrentHp)
      : { $gt: 0 }
  };
  const monstersCol = await collection("monsters");
  const primary = await monstersCol.updateOne(
    { _id: stateDocId, ...activeStateFilter },
    { $set: { value: state, updatedAt: now } }
  );

  if (primary.matchedCount === 0) {
    // canonical 已存在但條件不符＝怪物已死亡／切換；只在舊資料確實沒有 canonical 時回退。
    const canonicalExists = await monstersCol.findOne({ _id: stateDocId }, { projection: { _id: 1 } });
    if (canonicalExists) return false;
    const legacyCol = await collection("monsterState");
    const legacy = await legacyCol.updateOne(
      { _id: zoneKey, ...activeStateFilter },
      { $set: { value: state, updatedAt: now } }
    );
    if (legacy.matchedCount === 0) return false;
    await monstersCol.updateOne(
      { _id: stateDocId },
      { $set: { value: state, updatedAt: now } },
      { upsert: true }
    );
    return true;
  }

  // canonical 是讀取來源；legacy 只能用相同條件同步，不能反向覆蓋新怪。
  await (await collection("monsterState")).updateOne(
    { _id: zoneKey, ...activeStateFilter },
    { $set: { value: state, updatedAt: now } }
  );
  return true;
}

module.exports = { saveActiveMonsterState };
