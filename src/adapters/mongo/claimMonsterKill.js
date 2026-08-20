function normalizeMonsterSeq(monsterSeq) {
  if (monsterSeq === null || monsterSeq === undefined || monsterSeq === "") return null;
  const value = Number(monsterSeq);
  return Number.isFinite(value) ? value : null;
}

function buildClaimFilter(id, monsterSeq, cutoff) {
  const normalizedSeq = normalizeMonsterSeq(monsterSeq);
  return {
    _id: id,
    // 舊活動怪可能缺 seq，state 會以 null 表示；不可把 null 強轉成 0，
    // 否則四部位全破後永遠拿不到擊殺結算權。
    "value.activeMonsterSeq": normalizedSeq,
    $and: [
      {
        $or: [
          { "value.activeTransition": { $exists: false } },
          { "value.activeTransition": null }
        ]
      },
      {
        $or: [
          { "value.activeEvent": { $exists: false } },
          { "value.activeEvent": null }
        ]
      }
    ],
    $or: [
      { "value.killClaimedSeq": { $ne: normalizedSeq } },
      { "value.killClaimedAt": { $lt: cutoff } },
      { "value.killClaimedAt": { $exists: false } }
    ]
  };
}

function buildClaimUpdate(monsterSeq, now) {
  const normalizedSeq = normalizeMonsterSeq(monsterSeq);
  return {
    $set: {
      "value.killClaimedSeq": normalizedSeq,
      "value.killClaimedAt": now,
      "value.killClaimedBy": process.pid,
      updatedAt: now.toISOString()
    }
  };
}

async function claimMonsterKill({ collection, zoneKey, monsterSeq, timeoutMs = 30 * 1000 }) {
  const stateDocId = `monsterState:${zoneKey}`;
  const now = new Date();
  const cutoff = new Date(now.getTime() - timeoutMs);
  const update = buildClaimUpdate(monsterSeq, now);
  const monstersCol = await collection("monsters");

  // 玩家與掃描器都以 canonical state 為準，擊殺鎖也必須鎖在同一份文件。
  const canonicalClaim = await monstersCol.findOneAndUpdate(
    buildClaimFilter(stateDocId, monsterSeq, cutoff),
    update,
    { returnDocument: "after" }
  );
  if (canonicalClaim?.value) {
    // legacy 僅保留相容鏡像；條件不符時不可反向覆蓋 canonical 的新怪狀態。
    await (await collection("monsterState")).updateOne(
      buildClaimFilter(zoneKey, monsterSeq, cutoff),
      update
    );
    return true;
  }

  // canonical 存在但 claim 失敗，代表已被收付或正在換怪；不可拿 legacy 的舊狀態重試。
  const canonicalExists = await monstersCol.findOne(
    { _id: stateDocId },
    { projection: { _id: 1 } }
  );
  if (canonicalExists) return false;

  // 舊環境尚未建立 canonical 時才向下相容，成功後立即補建 canonical。
  const legacyCol = await collection("monsterState");
  const legacyClaim = await legacyCol.findOneAndUpdate(
    buildClaimFilter(zoneKey, monsterSeq, cutoff),
    update,
    { returnDocument: "after" }
  );
  if (!legacyClaim?.value) return false;

  await monstersCol.updateOne(
    { _id: stateDocId },
    {
      $set: {
        value: legacyClaim.value,
        updatedAt: now.toISOString()
      }
    },
    { upsert: true }
  );
  return true;
}

module.exports = { claimMonsterKill, normalizeMonsterSeq };
