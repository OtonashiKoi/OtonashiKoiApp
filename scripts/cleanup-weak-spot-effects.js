require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const DEAD_KEYS = new Set(["proc_weak_spot", "weakness_hit_rate"]);
const EFFECT_FIELDS = ["procEffects", "combatEffects", "passiveEffects", "useEffects", "battleStartEffects"];

function filterDead(arr) {
  if (!Array.isArray(arr)) return { changed: false, value: arr, removed: 0 };
  const next = arr.filter((e) => !DEAD_KEYS.has(e?.key));
  return { changed: next.length !== arr.length, value: next, removed: arr.length - next.length };
}

async function main() {
  const db = await getMongoDb();

  // 1. items
  let touchedItems = 0, removedEntries = 0;
  const items = await db.collection("items").find({}).toArray();
  for (const it of items) {
    const updates = {};
    let touched = false;
    for (const field of EFFECT_FIELDS) {
      const res = filterDead(it[field]);
      if (res.changed) {
        updates[field] = res.value;
        removedEntries += res.removed;
        touched = true;
      }
    }
    // jobSkills 內部的 procEffects
    if (Array.isArray(it.jobSkills)) {
      const newSkills = it.jobSkills.map((sk) => {
        const res = filterDead(sk?.procEffects);
        if (res.changed) {
          removedEntries += res.removed;
          touched = true;
          return { ...sk, procEffects: res.value };
        }
        return sk;
      });
      if (touched) updates.jobSkills = newSkills;
    }
    if (touched) {
      await db.collection("items").updateOne(
        { _id: it._id },
        { $set: { ...updates, updatedAt: new Date().toISOString() } }
      );
      touchedItems++;
      console.log(`  ✏️  ${it.name || it.id}`);
    }
  }
  console.log(`\n✅ items：清理 ${touchedItems} 件道具，移除 ${removedEntries} 個 effect 條目`);

  // 2. monsters
  let touchedMonsters = 0;
  let monsterEntriesRemoved = 0;
  const monsters = await db.collection("monsters").find({}).toArray();
  for (const m of monsters) {
    const updates = {};
    let touched = false;
    for (const field of EFFECT_FIELDS) {
      const res = filterDead(m[field]);
      if (res.changed) {
        updates[field] = res.value;
        monsterEntriesRemoved += res.removed;
        touched = true;
      }
    }
    // monsterCardSkill 內部
    if (m.monsterCardSkill?.procEffects) {
      const res = filterDead(m.monsterCardSkill.procEffects);
      if (res.changed) {
        updates.monsterCardSkill = { ...m.monsterCardSkill, procEffects: res.value };
        monsterEntriesRemoved += res.removed;
        touched = true;
      }
    }
    if (touched) {
      await db.collection("monsters").updateOne(
        { _id: m._id },
        { $set: { ...updates, updatedAt: new Date().toISOString() } }
      );
      touchedMonsters++;
      console.log(`  ✏️  ${m.name}`);
    }
  }
  console.log(`\n✅ monsters：清理 ${touchedMonsters} 隻怪，移除 ${monsterEntriesRemoved} 個 effect 條目`);

  // 3. effectDefinitions：移除這兩個 key
  const def = await db.collection("effectDefinitions").findOne({});
  if (def) {
    const v = def.value || def;
    const before = (v.definitions || []).length;
    v.definitions = (v.definitions || []).filter((d) => !DEAD_KEYS.has(d.key));
    const removed = before - v.definitions.length;
    if (removed > 0) {
      await db.collection("effectDefinitions").updateOne(
        { _id: def._id },
        { $set: { value: v, updatedAt: new Date().toISOString() } }
      );
      console.log(`\n✅ effectDefinitions：移除 ${removed} 個定義（proc_weak_spot / weakness_hit_rate）`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
