"use strict";
/**
 * 把 54 顆 BUILD 變化對戒綁定為稀有掉落
 *
 * 分配規則：
 *  - C 階 → 中級區 (mid zone)
 *  - B 階 → 古城 (ancient_city) + 古城深處普通怪 (ancient_city_deep regular)
 *  - A 階 → 古城深處 Boss + 龍族之領 (dragon_realm)
 *
 * 古城深處實際上是 B 階區，所以普通怪掉 B、Boss 才掉 A。
 *
 * 每顆戒指掉在 2 隻怪身上：
 *  - 普通怪：chance 1.2%（稀有）
 *  - Boss / 稀有怪：chance 3.5%（較稀有但較常見於 boss）
 *
 * 同名舊掉落會先清掉，可重複跑。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const REGULAR_CHANCE = 1.2;
const BOSS_CHANCE = 3.5;

async function main() {
  const db = await getMongoDb();
  const items = db.collection("items");
  const monsters = db.collection("monsters");

  // 1. 撈出所有對戒
  const rings = await items.find({
    name: { $regex: /(左|右)之戒$/ },
    itemType: "equipment",
  }).toArray();
  console.log(`找到 ${rings.length} 顆對戒。`);

  const ringsByTier = { C: [], B: [], A: [] };
  for (const r of rings) ringsByTier[r.tier]?.push(r);
  console.log(`分階：C=${ringsByTier.C.length}, B=${ringsByTier.B.length}, A=${ringsByTier.A.length}`);

  // 2. 撈各區怪物
  const midMobs = await monsters.find({ zone: "mid" }).toArray();
  const acMobs = await monsters.find({ zone: "ancient_city" }).toArray();
  const acdMobs = await monsters.find({ zone: "ancient_city_deep" }).toArray();
  const drMobs = await monsters.find({ zone: "dragon_realm" }).toArray();

  // 區內分 regular / boss
  function split(arr) {
    const boss = arr.filter(m => m.isBoss || m.name?.includes("(B)") || m.name?.includes("(稀)"));
    const regular = arr.filter(m => !boss.includes(m));
    return { boss, regular };
  }

  const acSplit = split(acMobs);
  const acdSplit = split(acdMobs);
  const drSplit = split(drMobs);
  const tierZones = {
    C: { regular: split(midMobs).regular, boss: split(midMobs).boss },
    B: {
      // 古城所有怪 + 古城深處普通怪
      regular: [...acSplit.regular, ...acdSplit.regular],
      boss: acSplit.boss,
    },
    A: {
      // 龍族之領普通怪 + 古城深處 Boss + 龍族之領 Boss
      regular: drSplit.regular,
      boss: [...acdSplit.boss, ...drSplit.boss],
    },
  };

  console.log("各階怪物池：");
  for (const t of ["C", "B", "A"]) {
    console.log(`  ${t} regular=${tierZones[t].regular.length}, boss=${tierZones[t].boss.length}`);
  }

  // 3. 先清掉所有怪物 drops 中名稱含「左之戒/右之戒」的舊紀錄
  const ringIds = new Set(rings.map(r => r.id));
  const ringIdsArr = [...ringIds];
  const clearRes = await monsters.updateMany(
    { "drops.itemId": { $in: ringIdsArr } },
    { $pull: { drops: { itemId: { $in: ringIdsArr } } } }
  );
  console.log(`清除舊掉落紀錄：${clearRes.modifiedCount} 隻怪。`);

  // 4. 為每顆戒指分配 2 個掉落來源（1 regular + 1 boss）
  let totalBindings = 0;
  for (const tier of ["C", "B", "A"]) {
    const pool = tierZones[tier];
    const ringList = ringsByTier[tier];
    if (!pool.regular.length || !pool.boss.length) {
      console.warn(`⚠ ${tier} 階怪物池不足，跳過`);
      continue;
    }

    for (let i = 0; i < ringList.length; i++) {
      const ring = ringList[i];
      const regularMob = pool.regular[i % pool.regular.length];
      const bossMob = pool.boss[i % pool.boss.length];

      const regularDrop = {
        itemId: ring.id,
        itemName: ring.name,
        chance: REGULAR_CHANCE,
      };
      const bossDrop = {
        itemId: ring.id,
        itemName: ring.name,
        chance: BOSS_CHANCE,
      };

      await monsters.updateOne(
        { _id: regularMob._id },
        { $push: { drops: regularDrop } }
      );
      await monsters.updateOne(
        { _id: bossMob._id },
        { $push: { drops: bossDrop } }
      );

      console.log(`[${tier}] ${ring.name} → ${regularMob.name}(${REGULAR_CHANCE}%) + ${bossMob.name}(${BOSS_CHANCE}%)`);
      totalBindings += 2;
    }
  }

  console.log(`\n總共建立 ${totalBindings} 條掉落綁定。`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
