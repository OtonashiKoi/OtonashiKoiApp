require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { ZONE_DEFS } = require("../src/shared/zones");

const OUT_PATH = path.resolve(__dirname, "../docs/CURRENT_GAME_STATUS.md");

function md(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function statLine(stats = null) {
  if (!stats || typeof stats !== "object") return "";
  return ["str", "agi", "vit", "int", "dex", "luk"]
    .map((key) => [key.toUpperCase(), Number(stats[key]) || 0])
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${key}+${value}`)
    .join(" ");
}

function rewardLine(quest, itemById) {
  const parts = [];
  if (quest.rewardGold) parts.push(`${quest.rewardGold} 金幣`);
  if (quest.rewardExp) parts.push(`${quest.rewardExp} EXP`);
  if (quest.rewardDiamond) parts.push(`${quest.rewardDiamond} 鑽石`);
  if (quest.rewardItemId) parts.push(itemById.get(quest.rewardItemId)?.name || quest.rewardItemId);
  return parts.join(" + ");
}

function unlockAttributeLine(quest) {
  const raw = Array.isArray(quest?.unlockAttributes) && quest.unlockAttributes.length > 0
    ? quest.unlockAttributes
    : [quest?.unlockAttribute, quest?.unlockAttribute2];
  const attrs = raw
    .map((attr) => String(attr || "").trim().toUpperCase())
    .filter(Boolean)
    .filter((attr, index, arr) => arr.indexOf(attr) === index);
  if (!attrs.length) return "";
  return `${attrs.join(" + ")} > ${quest.unlockAttributeMin ?? ""}`.trim();
}

function table(headers, rows) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(md).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

async function main() {
  const db = await getMongoDb();
  const [monsterDocs, items, quests, players, progressRows, worldBossConfigRows, worldBossStateRows] = await Promise.all([
    db.collection("monsters").find({}).sort({ zone: 1, seq: 1, level: 1, name: 1 }).toArray(),
    db.collection("items").find({}).sort({ itemType: 1, tier: 1, equipSlot: 1, name: 1 }).toArray(),
    db.collection("weeklyQuests").find({}).sort({ cadence: 1, sortOrder: 1, title: 1 }).toArray(),
    db.collection("players").find({}).toArray(),
    db.collection("progress").find({}).toArray(),
    db.collection("worldBossConfig").find({}).toArray(),
    db.collection("worldBossState").find({}).toArray().catch(() => []),
  ]);

  const monsterStateRows = monsterDocs.filter((row) => String(row._id || "").startsWith("monsterState:"));
  const monsters = monsterDocs.filter((row) => !String(row._id || "").startsWith("monsterState:"));
  const itemById = new Map();
  for (const item of items) {
    if (item.id) itemById.set(String(item.id), item);
    if (item._id) itemById.set(String(item._id), item);
  }
  const zoneByKey = new Map(ZONE_DEFS.map((zone) => [zone.key, zone]));
  const now = new Date().toISOString();

  const zoneRows = ZONE_DEFS.map((zone) => {
    const zoneMonsters = monsters.filter((monster) => monster.zone === zone.key);
    const bosses = zoneMonsters.filter((monster) => monster.isBoss);
    const enabled = zoneMonsters.filter((monster) => monster.enabled !== false);
    return [
      zone.key,
      zone.label,
      zone.minLevel,
      zone.maxLevel == null ? "無上限" : zone.maxLevel,
      zoneMonsters.length,
      enabled.length,
      bosses.length,
    ];
  });

  const extraZoneKeys = [...new Set(monsters.map((monster) => monster.zone || "未分區"))]
    .filter((zoneKey) => !zoneByKey.has(zoneKey));
  for (const zoneKey of extraZoneKeys) {
    const zoneMonsters = monsters.filter((monster) => (monster.zone || "未分區") === zoneKey);
    zoneRows.push([
      zoneKey,
      "未定義",
      "",
      "",
      zoneMonsters.length,
      zoneMonsters.filter((monster) => monster.enabled !== false).length,
      zoneMonsters.filter((monster) => monster.isBoss).length,
    ]);
  }

  const monsterRows = monsters.map((monster) => [
    monster.zone || "未分區",
    monster.seq ?? "",
    monster.name,
    monster.level ?? "",
    monster.maxHp ?? monster.calc?.maxHp ?? "",
    monster.expReward ?? "",
    monster.goldReward ?? "",
    monster.entryFee ?? 0,
    monster.isBoss ? "是" : "否",
    Array.isArray(monster.drops) ? monster.drops.length : 0,
  ]);

  const itemTypeCounts = {};
  const tierCounts = {};
  const slotCounts = {};
  for (const item of items) {
    const type = item.itemType || "unknown";
    const tier = item.tier || "無階級";
    const slot = item.equipSlot || "無槽位";
    itemTypeCounts[type] = (itemTypeCounts[type] || 0) + 1;
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    slotCounts[slot] = (slotCounts[slot] || 0) + 1;
  }

  const itemRows = items.map((item) => [
    item.id,
    item.name,
    item.itemType || "",
    item.tier || "",
    item.equipSlot || "",
    item.weaponType || "",
    statLine(item.equipStats),
    item.effect?.type || "",
  ]);

  const questRows = quests.map((quest) => [
    quest.cadence || "weekly",
    quest.sortOrder ?? "",
    quest.title,
    quest.type,
    quest.target,
    quest.enabled === false || quest.isActive === false ? "停用" : "啟用",
    rewardLine(quest, itemById),
    quest.description || "",
  ]);

  const jobBadges = items.filter((item) => item.itemType === "job_badge" || item.equipSlot === "job_eq");
  const jobQuests = quests.filter((quest) => quest.cadence === "job");
  const jobRows = jobBadges.map((badge) => {
    const quest = jobQuests.find((row) => row.rewardItemId === badge.id);
    return [
      badge.id,
      badge.name,
      badge.tier || "",
      quest?.title || "",
      quest?.enabled === false || quest?.isActive === false ? "停用" : (quest ? "啟用" : "無任務"),
      quest?.unlockLevel ?? "",
      Array.isArray(quest?.unlockWeaponTypes) ? quest.unlockWeaponTypes.join(", ") : "",
      unlockAttributeLine(quest),
      statLine(badge.equipStats),
    ];
  });

  const lines = [];
  lines.push("# Current Game Status");
  lines.push("");
  lines.push(`Generated at: ${now}`);
  lines.push("");
  lines.push("> This file is generated from MongoDB. Run `npm run status:update` to refresh it.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(table(
    ["項目", "數量"],
    [
      ["玩家", players.length],
      ["進度資料", progressRows.length],
      ["怪物", monsters.length],
      ["怪物狀態文件", monsterStateRows.length],
      ["道具", items.length],
      ["任務", quests.length],
      ["職業徽章", jobBadges.length],
      ["職業任務", jobQuests.length],
      ["世界王設定", worldBossConfigRows.length],
      ["世界王狀態", worldBossStateRows.length],
    ]
  ));
  lines.push("");
  lines.push("## Zones");
  lines.push("");
  lines.push(table(["Zone", "名稱", "最低等級", "最高等級", "怪物", "啟用", "Boss"], zoneRows));
  lines.push("");
  lines.push("## Monsters");
  lines.push("");
  lines.push(table(["Zone", "序號", "怪物", "等級", "HP", "EXP", "金幣", "入場費", "Boss", "掉落數"], monsterRows));
  lines.push("");
  lines.push("## Items Summary");
  lines.push("");
  lines.push(table(["分類", "數量"], Object.entries(itemTypeCounts).sort().map(([key, value]) => [key, value])));
  lines.push("");
  lines.push(table(["階級", "數量"], Object.entries(tierCounts).sort().map(([key, value]) => [key, value])));
  lines.push("");
  lines.push(table(["槽位", "數量"], Object.entries(slotCounts).sort().map(([key, value]) => [key, value])));
  lines.push("");
  lines.push("## Items");
  lines.push("");
  lines.push(table(["ID", "名稱", "類型", "階級", "槽位", "武器類型", "屬性", "效果"], itemRows));
  lines.push("");
  lines.push("## Quests");
  lines.push("");
  lines.push(table(["分類", "排序", "任務", "Metric", "目標", "狀態", "獎勵", "說明"], questRows));
  lines.push("");
  lines.push("## Jobs");
  lines.push("");
  lines.push(table(["徽章ID", "職業徽章", "階級", "任務", "任務狀態", "解鎖等級", "武器條件", "基礎屬性條件", "徽章屬性"], jobRows));
  lines.push("");

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${OUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
