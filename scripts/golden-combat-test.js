"use strict";
/**
 * 戰鬥核心黃金測試（重構安全網）。
 *
 * 固定 fixture + 固定亂數種子跑 60 場戰鬥。這支測試刻意不連 MongoDB，
 * 避免真實玩家進度、道具資料或世界王設定變動把快照誤判成程式回歸。
 *
 * 用法：
 *   node scripts/golden-combat-test.js --update   # 確認平衡改動後更新快照
 *   node scripts/golden-combat-test.js            # 驗證（預設）
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { runCombatLoop } = require("../src/shared/combatLoop");
const jbo = require("./lib/jobBattleOptions");
const { withSeed } = require("./lib/seededRandom");

const FIXTURE_PATH = path.join(__dirname, "golden", "combat-fixture.json");
const SNAPSHOT_PATH = path.join(__dirname, "golden", "combat-golden.json");
const BATTLES = 60;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadFixture() {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  if (!Number.isInteger(fixture.version) || fixture.version < 1) {
    throw new Error("combat fixture version 必須是正整數");
  }
  if (!Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error("combat fixture 至少需要一個 case");
  }
  if (BATTLES % fixture.cases.length !== 0) {
    throw new Error(`戰鬥數 ${BATTLES} 必須能被 case 數 ${fixture.cases.length} 整除`);
  }
  return fixture;
}

function fixtureDigest(fixture) {
  return crypto.createHash("sha256").update(JSON.stringify(fixture)).digest("hex").slice(0, 16);
}

function validateRows(rows, fixture) {
  if (rows.length !== BATTLES) {
    throw new Error(`黃金測試應產生 ${BATTLES} 場，實際為 ${rows.length} 場`);
  }
  const seenSeeds = new Set();
  for (const row of rows) {
    if (!row.seed || seenSeeds.has(row.seed)) throw new Error(`黃金測試 seed 重複或空白：${row.seed || "(empty)"}`);
    seenSeeds.add(row.seed);
    if (!["win", "lose", "timeout"].includes(row.outcome)) throw new Error(`${row.seed} outcome 無效：${row.outcome}`);
    for (const key of ["rounds", "totalDamage", "damageTaken", "maxHitTaken"]) {
      if (!Number.isFinite(row[key]) || row[key] < 0) throw new Error(`${row.seed} ${key} 無效：${row[key]}`);
    }
    if (row.rounds < 1 || row.rounds > 15) throw new Error(`${row.seed} rounds 超出範圍：${row.rounds}`);
  }
  for (const c of fixture.cases) {
    const caseRows = rows.filter((row) => row.seed.startsWith(`golden:${c.key}:`));
    if (caseRows.length === 0) throw new Error(`fixture case 沒有產生戰鬥：${c.key}`);
    if (caseRows.every((row) => row.totalDamage <= 0)) throw new Error(`fixture case 全部沒有輸出傷害：${c.key}`);
    if (caseRows.every((row) => row.damageTaken <= 0)) throw new Error(`fixture case 全部沒有承受傷害：${c.key}`);
  }
}

function buildEquipment(c) {
  const equipment = {
    job_eq: {
      id: c.badgeId,
      itemId: c.badgeId,
      itemName: c.key,
    },
    weapon: {
      id: `golden_${c.key}_weapon`,
      itemId: `golden_${c.key}_weapon`,
      itemName: `${c.key} fixture weapon`,
      weaponType: c.pStats.weaponType,
      enhanceLevel: 0,
    },
  };
  if (c.shield) {
    equipment.shield = {
      id: `golden_${c.key}_shield`,
      itemId: `golden_${c.key}_shield`,
      itemName: `${c.key} fixture shield`,
      equipSlot: "shield",
    };
  } else if (c.dual) {
    equipment.shield = {
      id: `golden_${c.key}_offhand`,
      itemId: `golden_${c.key}_offhand`,
      itemName: `${c.key} fixture offhand`,
      weaponType: "offhand_dagger",
      equipSlot: "offhand",
    };
  }
  return equipment;
}

function run() {
  const fixture = loadFixture();
  const rows = [];
  const runsPerCase = BATTLES / fixture.cases.length;

  for (const c of fixture.cases) {
    const equipment = buildEquipment(c);
    const pStats = clone(c.pStats);
    const jobOptions = jbo.buildBattleOptions({
      equipped: equipment,
      pStats,
      inventory: [],
      stance: c.stance || null,
    });

    for (let i = 0; i < runsPerCase; i++) {
      const seed = `golden:${c.key}:${i}`;
      const result = withSeed(seed, () => runCombatLoop(
        clone(pStats),
        clone(fixture.monster.stats),
        fixture.monster.name,
        fixture.monster.partHp,
        undefined,
        {
          playerLevel: pStats.level,
          equipped: clone(equipment),
          inventory: [],
          monsterEquipped: clone(fixture.monster.equipment),
          monsterIsBoss: true,
          isWorldBoss: true,
          worldBossPhase: clone(fixture.monster.phase),
          zone: "dragon_king_lair",
          monsterElement: fixture.monster.element,
          monsterElementLevel: fixture.monster.elementLevel,
          playerActiveEffects: [],
          ...clone(jobOptions),
        },
      ));
      rows.push({
        seed,
        outcome: result.outcome,
        rounds: (result.nextRound || 2) - 1,
        totalDamage: result.totalDamage || 0,
        damageTaken: result.damageTaken || 0,
        maxHitTaken: result.maxHitTaken || 0,
      });
    }
  }

  validateRows(rows, fixture);
  return { fixture, rows };
}

(async () => {
  const update = process.argv.includes("--update");
  const { fixture, rows } = run();
  const digest = fixtureDigest(fixture);

  if (update) {
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify({
      note: "戰鬥核心黃金快照；固定 fixture，僅在確認平衡改動後更新",
      fixtureVersion: fixture.version,
      fixtureDigest: digest,
      rows,
    }, null, 2)}\n`);
    console.log(`✅ 黃金快照已更新：fixture v${fixture.version}/${digest}，${rows.length} 場`);
    process.exit(0);
  }

  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error("❌ 快照不存在，確認 fixture 後執行 node scripts/golden-combat-test.js --update");
    process.exit(1);
  }
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  if (snapshot.fixtureVersion !== fixture.version || snapshot.fixtureDigest !== digest) {
    console.error(
      `❌ fixture 已變更：快照=${snapshot.fixtureVersion}/${snapshot.fixtureDigest}，`
      + `目前=${fixture.version}/${digest}。確認改動後再 --update。`,
    );
    process.exit(1);
  }

  const golden = snapshot.rows || [];
  let diff = 0;
  for (let i = 0; i < Math.max(golden.length, rows.length); i++) {
    const expected = golden[i];
    const actual = rows[i];
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      diff++;
      if (diff <= 5) {
        console.log(
          `✗ ${expected?.seed || actual?.seed}\n`
          + `  快照: ${JSON.stringify(expected)}\n`
          + `  現在: ${JSON.stringify(actual)}`,
        );
      }
    }
  }
  if (diff === 0) {
    console.log(`✅ 黃金測試通過：fixture v${fixture.version}/${digest}，${rows.length} 場全部一致`);
    process.exit(0);
  }
  console.error(`❌ ${diff}/${golden.length} 場不一致——請確認是預期平衡調整或非預期回歸`);
  process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
