require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

// 古城（外圍 = 非人型 + 城堡魔像）
const ANCIENT_CITY = new Set([
  "石像鬼",
  "廢墟蠍兵",
  "毒霧蜘蛛",
  "城堡魔像(B)",
]);

// 古城深處（內圈 = 人型 + 古城將軍）
const ANCIENT_CITY_DEEP = new Set([
  "城牆衛兵",
  "古城弓手",
  "古城法師",
  "冰封騎士",
  "詛咒祭司",
  "鐵甲衛將",
  "古城刺客",
  "古城狂戰士",
  "黑焰巫師",
  "古城將軍(B)",
]);

// 廢都王座（世界王）
const WASTELAND_THRONE = new Set([
  "廢都魔王(B)",
]);

async function main() {
  const db = await getMongoDb();
  const hardMonsters = await db.collection("monsters")
    .find({ zone: "hard" })
    .toArray();

  console.log(`找到 ${hardMonsters.length} 隻 hard 區怪物`);
  let counts = { ancient_city: 0, ancient_city_deep: 0, wasteland_throne: 0, skipped: 0 };

  for (const m of hardMonsters) {
    let newZone = null;
    if (ANCIENT_CITY.has(m.name)) newZone = "ancient_city";
    else if (ANCIENT_CITY_DEEP.has(m.name)) newZone = "ancient_city_deep";
    else if (WASTELAND_THRONE.has(m.name)) newZone = "wasteland_throne";

    if (!newZone) {
      console.log(`  ⚠️ 未分類：${m.name}（保持 hard）`);
      counts.skipped++;
      continue;
    }

    await db.collection("monsters").updateOne(
      { _id: m._id },
      { $set: { zone: newZone, updatedAt: new Date().toISOString() } }
    );
    console.log(`  ${m.name.padEnd(16)} Lv.${m.level}  hard → ${newZone}`);
    counts[newZone]++;
  }

  console.log("\n各區結果：");
  console.log(`  古城 (ancient_city)        : ${counts.ancient_city} 隻`);
  console.log(`  古城深處 (ancient_city_deep): ${counts.ancient_city_deep} 隻`);
  console.log(`  廢都王座 (wasteland_throne) : ${counts.wasteland_throne} 隻`);
  if (counts.skipped) console.log(`  未分類保留：${counts.skipped}`);

  // 更新 worldBossConfig
  const wbCfg = await db.collection("worldBossConfig").findOne({ _id: "default" });
  if (wbCfg) {
    const next = { ...(wbCfg.value || wbCfg) };
    next.targetZone = "wasteland_throne";
    await db.collection("worldBossConfig").updateOne(
      { _id: "default" },
      { $set: { value: next, targetZone: "wasteland_throne", updatedAt: new Date().toISOString() } }
    );
    console.log(`\n✅ worldBossConfig.targetZone 改為 wasteland_throne`);
  } else {
    console.log("\n⚠️ 找不到 worldBossConfig default doc");
  }

  // channelLayout featureKey 遷移提示
  const layout = await db.collection("channelLayout").findOne({ _id: "default" });
  const bindings = layout?.value?.discord?.bindings || [];
  const oldHardBinding = bindings.find((b) => b.featureKey === "monster_zone_hard");
  if (oldHardBinding) {
    console.log(`\n⚠️ channelLayout 仍有 monster_zone_hard 綁定（頻道 ${oldHardBinding.channelId}）`);
    console.log("   需要管理員在 Discord 後台重新綁定：");
    console.log("     monster_zone_ancient_city");
    console.log("     monster_zone_ancient_city_deep");
    console.log("     monster_zone_wasteland_throne");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
