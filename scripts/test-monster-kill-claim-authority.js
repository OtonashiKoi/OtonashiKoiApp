const assert = require("node:assert/strict");
const { claimMonsterKill } = require("../src/adapters/mongo/claimMonsterKill");

function valueAt(row, path) {
  return path.split(".").reduce((value, key) => value?.[key], row);
}

function matchesCondition(actual, condition) {
  if (!condition || typeof condition !== "object" || condition instanceof Date) {
    return actual === condition;
  }
  if (Object.hasOwn(condition, "$exists")) return (actual !== undefined) === condition.$exists;
  if (Object.hasOwn(condition, "$ne")) return actual !== condition.$ne;
  if (Object.hasOwn(condition, "$lt")) return actual < condition.$lt;
  return false;
}

function matches(row, query) {
  return Object.entries(query).every(([key, condition]) => {
    if (key === "$and") return condition.every((entry) => matches(row, entry));
    if (key === "$or") return condition.some((entry) => matches(row, entry));
    return matchesCondition(valueAt(row, key), condition);
  });
}

function setAt(row, path, value) {
  const keys = path.split(".");
  const finalKey = keys.pop();
  const target = keys.reduce((cursor, key) => {
    cursor[key] ||= {};
    return cursor[key];
  }, row);
  target[finalKey] = value;
}

class FakeCollection {
  constructor(rows = []) {
    this.rows = new Map(rows.map((row) => [row._id, structuredClone(row)]));
  }

  async findOne(query) {
    return [...this.rows.values()].find((row) => matches(row, query)) || null;
  }

  async findOneAndUpdate(query, update) {
    const row = await this.findOne(query);
    if (!row) return null;
    for (const [path, value] of Object.entries(update.$set || {})) setAt(row, path, value);
    return structuredClone(row);
  }

  async updateOne(query, update, options = {}) {
    let row = await this.findOne(query);
    if (!row && options.upsert) {
      row = { _id: query._id };
      this.rows.set(row._id, row);
    }
    if (!row) return { matchedCount: 0 };
    for (const [path, value] of Object.entries(update.$set || {})) setAt(row, path, value);
    return { matchedCount: 1 };
  }
}

function createCollections({ canonical, legacy }) {
  const collections = {
    monsters: new FakeCollection(canonical ? [canonical] : []),
    monsterState: new FakeCollection(legacy ? [legacy] : [])
  };
  return {
    collections,
    collection: async (name) => collections[name]
  };
}

async function runClaimAuthorityChecks() {
  const split = createCollections({
    canonical: {
      _id: "monsterState:normal",
      value: { activeMonsterSeq: 6, currentHp: 0, activeTransition: null, activeEvent: null }
    },
    legacy: {
      _id: "normal",
      value: {
        activeMonsterSeq: 4,
        currentHp: 0,
        activeTransition: { id: "stale-transition" },
        activeEvent: null
      }
    }
  });
  assert.equal(await claimMonsterKill({ collection: split.collection, zoneKey: "normal", monsterSeq: 6 }), true);
  assert.equal(split.collections.monsters.rows.get("monsterState:normal").value.killClaimedSeq, 6);
  assert.equal(split.collections.monsterState.rows.get("normal").value.activeMonsterSeq, 4);
  assert.equal(
    await claimMonsterKill({ collection: split.collection, zoneKey: "normal", monsterSeq: 6 }),
    false,
    "同一隻怪在 timeout 前只能被收付一次"
  );

  const mismatch = createCollections({
    canonical: {
      _id: "monsterState:beginner",
      value: { activeMonsterSeq: 4, activeTransition: null, activeEvent: null }
    },
    legacy: {
      _id: "beginner",
      value: { activeMonsterSeq: 2, activeTransition: null, activeEvent: null }
    }
  });
  assert.equal(
    await claimMonsterKill({ collection: mismatch.collection, zoneKey: "beginner", monsterSeq: 2 }),
    false,
    "canonical 已存在時不得用 legacy 舊怪取得擊殺權"
  );

  const fallback = createCollections({
    legacy: {
      _id: "low",
      value: { activeMonsterSeq: 3, currentHp: 0, activeTransition: null, activeEvent: null }
    }
  });
  assert.equal(await claimMonsterKill({ collection: fallback.collection, zoneKey: "low", monsterSeq: 3 }), true);
  assert.equal(fallback.collections.monsters.rows.get("monsterState:low").value.killClaimedSeq, 3);

  const transitioning = createCollections({
    canonical: {
      _id: "monsterState:high",
      value: { activeMonsterSeq: 8, activeTransition: { id: "in-flight" }, activeEvent: null }
    },
    legacy: {
      _id: "high",
      value: { activeMonsterSeq: 8, activeTransition: null, activeEvent: null }
    }
  });
  assert.equal(
    await claimMonsterKill({ collection: transitioning.collection, zoneKey: "high", monsterSeq: 8 }),
    false,
    "canonical 正在換怪時不得由 legacy 重複收付"
  );

  const legacyMissingSeq = createCollections({
    canonical: {
      _id: "monsterState:event_boss",
      value: { activeMonsterSeq: null, currentHp: 0, activeTransition: null, activeEvent: null }
    },
    legacy: {
      _id: "event_boss",
      value: { activeMonsterSeq: null, currentHp: 0, activeTransition: null, activeEvent: null }
    }
  });
  assert.equal(
    await claimMonsterKill({ collection: legacyMissingSeq.collection, zoneKey: "event_boss", monsterSeq: undefined }),
    true,
    "缺少 seq 的舊活動王仍須取得擊殺結算權"
  );
  assert.equal(
    legacyMissingSeq.collections.monsters.rows.get("monsterState:event_boss").value.killClaimedSeq,
    null
  );
  assert.equal(
    await claimMonsterKill({ collection: legacyMissingSeq.collection, zoneKey: "event_boss", monsterSeq: undefined }),
    false,
    "缺少 seq 的同一隻活動王仍只能被結算一次"
  );

  console.log("monster kill claim authority: canonical/legacy/null-seq checks passed");
}

if (require.main === module) {
  runClaimAuthorityChecks().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runClaimAuthorityChecks };
