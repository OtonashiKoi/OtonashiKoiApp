require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const config = require("../src/config");
const { ZONE_DEFS } = require("../src/shared/zones");
const { BASE_JOBS, T2_BRANCHES } = require("../src/shared/jobAdvancement");
const { TOWER_ENABLED } = require("../src/bot/handlers/towerHandlers");

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
  if (!config.storage.mongoUri) {
    throw new Error("MONGODB_URI is required to generate the current game status");
  }

  // 文件產生器只能讀取現況，不應建立索引、移轉資料或觸發 runtime 初始化。
  const client = new MongoClient(config.storage.mongoUri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 5,
  });
  await client.connect();
  const db = client.db(config.storage.mongoDbName);

  try {
  const [
    monsterDocs, items, quests, players, progressRows, worldBossConfigRows, worldBossStateRows,
    storyChapters, storyNpcs, serverEventConfig, shopItems,
  ] = await Promise.all([
    db.collection("monsters").find({}).sort({ zone: 1, seq: 1, level: 1, name: 1 }).toArray(),
    db.collection("items").find({}).sort({ itemType: 1, tier: 1, equipSlot: 1, name: 1 }).toArray(),
    db.collection("weeklyQuests").find({}).sort({ cadence: 1, sortOrder: 1, title: 1 }).toArray(),
    db.collection("players").find({}).toArray(),
    db.collection("progress").find({}).toArray(),
    db.collection("worldBossConfig").find({}).toArray(),
    db.collection("worldBossState").find({}).toArray().catch(() => []),
    db.collection("storyChapters").find({}).sort({ order: 1 }).toArray(),
    db.collection("storyNpcs").find({}).toArray(),
    db.collection("serverEventConfig").findOne({ _id: "default" }),
    db.collection("shopItems").find({}).toArray(),
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

  const t2Rows = Object.entries(BASE_JOBS).map(([baseKey, base]) => {
    const branches = Array.isArray(T2_BRANCHES[baseKey]) ? T2_BRANCHES[baseKey] : [];
    const open = branches.filter((branch) => branch?.seasonLocked !== true);
    const locked = branches.filter((branch) => branch?.seasonLocked === true);
    return [
      base.name,
      base.badgeId,
      branches.map((branch) => branch.name).join("、"),
      open.map((branch) => branch.name).join("、") || "無",
      locked.map((branch) => branch.name).join("、") || "無",
    ];
  });
  const totalT2 = t2Rows.reduce((sum, row) => sum + String(row[2]).split("、").filter(Boolean).length, 0);
  const lockedT2 = Object.values(T2_BRANCHES).flat().filter((branch) => branch?.seasonLocked === true).length;

  const worldBossRows = worldBossConfigRows.map((row) => {
    const value = row?.value && typeof row.value === "object" ? row.value : row;
    return [
      row._id,
      value.enabled === false ? "停用" : "啟用",
      value.targetZone || "",
      value.eliteZoneKey || "",
      value.battleTimeLimitMinutes ?? "",
      value.respawnCooldownMinutes ?? "",
    ];
  });

  const storyRows = storyChapters.map((chapter) => [
    chapter.order ?? "",
    chapter.id,
    chapter.title,
    chapter.zoneKey || "",
    chapter.enabled === false ? "停用" : "啟用",
    Array.isArray(chapter.nodes) ? chapter.nodes.length : 0,
  ]);

  const eventRows = ["donationTiers", "scBar", "memberEvents", "viewerTiers"].map((key) => {
    const config = serverEventConfig?.[key] || {};
    const detail = key === "viewerTiers"
      ? (config.tiers || []).map((tier) => `${tier.minViewers}人:${tier.goldPct || 0}/${tier.dropPct || 0}/${tier.expPct || 0}%`).join("、")
      : key === "donationTiers"
        ? (config.tiers || []).map((tier) => `NT$${tier.minTwd}:${tier.goldPct || 0}/${tier.dropPct || 0}/${tier.expPct || 0}%`).join("、")
        : `${(config.milestones || []).length} 個里程碑`;
    return [key, config.enabled === true ? "啟用" : "停用", config.announce === false ? "不公告" : "公告", detail];
  });

  const lines = [];
  lines.push("<!-- GENERATED: CURRENT_GAME_STATUS -->");
  lines.push("# 遊戲現況快照 Current Game Status");
  lines.push("");
  lines.push(`生成時間：${now}`);
  lines.push("");
  lines.push("> 本檔由程式碼與目前 MongoDB 自動產生，請勿手動修改。執行 `npm run status:update` 更新。功能說明與檔案位置請看 `docs/README.md`、`PROJECT_FEATURES.md`、`docs/SYSTEMS.md`。");
  lines.push("");
  lines.push("## Code Feature Gates");
  lines.push("");
  lines.push(table(
    ["項目", "現況", "來源"],
    [
      ["Runtime repository", "MongoDB-only", "src/repositories/createRepositories.js"],
      ["爬塔", TOWER_ENABLED ? "開放" : "暫停", "src/bot/handlers/towerHandlers.js"],
      ["一轉", `${Object.keys(BASE_JOBS).length} 個`, "src/shared/jobAdvancement.js"],
      ["二轉", `${totalT2} 條；鎖定 ${lockedT2} 條`, "src/shared/jobAdvancement.js"],
      ["區域定義", `${ZONE_DEFS.length} 個`, "src/shared/zones.js"],
    ]
  ));
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
      ["故事章節", storyChapters.length],
      ["故事 NPC", storyNpcs.length],
      ["商店商品", shopItems.length],
    ]
  ));
  lines.push("");
  lines.push("## Zones");
  lines.push("");
  lines.push(table(["Zone", "名稱", "最低等級", "最高等級", "怪物", "啟用", "Boss"], zoneRows));
  lines.push("");
  lines.push("## World Bosses");
  lines.push("");
  lines.push(table(["Boss Key", "狀態", "前置區域", "Boss Zone", "戰鬥分鐘", "重生分鐘"], worldBossRows));
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
  lines.push("## Tier 2 Branches");
  lines.push("");
  lines.push(table(["一轉", "一轉徽章", "全部分支", "目前可用", "本季鎖定"], t2Rows));
  lines.push("");
  lines.push("## Story Chapters");
  lines.push("");
  lines.push(table(["順序", "ID", "章節", "Zone", "狀態", "節點"], storyRows));
  lines.push("");
  lines.push("## Live Event Configuration");
  lines.push("");
  lines.push("> 這裡顯示 DB 實際開關；程式內 DEFAULTS 只在 DB 沒設定時使用。");
  lines.push("");
  lines.push(table(["模組", "狀態", "公告", "門檻摘要（金幣/掉寶/經驗）"], eventRows));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${OUT_PATH}`);
  } finally {
    await client.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
