"use strict";
/**
 * 玩家賽季重置（保留身分/付費/收藏/稱號，清掉玩法進度）
 *
 * 預設 dry-run（只印不寫）。確認無誤後加 APPLY=1 才會真的寫入。
 *
 * 用法：
 *   node scripts/reset-players-season.js                 # dry-run 全部玩家
 *   PLAYER_ID=<discordId> node scripts/reset-players-season.js   # dry-run 單一玩家
 *   APPLY=1 PLAYER_ID=<id> node scripts/reset-players-season.js  # 真的重置單一玩家
 *   APPLY=1 node scripts/reset-players-season.js                 # 真的重置全部玩家（危險）
 *
 * 保留（不清）：
 *   - 身分：progress.playerId / createdAt、players collection、streamAccountBindings
 *   - 會員階級：progress.playerTier（由直播會員同步，勿動）
 *   - 鑽石：wallets.diamond
 *   - 收藏品：inventory 內 itemType==="collectible"
 *   - 稱號：inventory 內 equipSlot==="title_eq"，以及裝備中的 equipment.title_eq
 *   - 稽核：progress.idleRewardReversal
 *
 * 重製：等級/經驗/職業/屬性/裝備(非稱號)/背包(非收藏非稱號)/金幣/buff/
 *      寵物/爬塔/PK/equipPresets/flags，並刪除 weeklyQuestProgress、checkins
 */
require("dotenv").config();
const { randomUUID } = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const APPLY = process.env.APPLY === "1";
const PLAYER_ID = process.env.PLAYER_ID || null;
const NOW = new Date().toISOString();

const INITIAL_ATTRIBUTES = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };

// 新手起手木劍（與 createGameProgress 一致）
function makeStarterWeapon() {
  return {
    uuid: randomUUID(),
    itemId: "a56bd609-cf0b-4924-b724-891f221fc0b9",
    itemName: "木劍",
    itemEffect: { type: "none", value: 0 },
    useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
    itemType: "equipment",
    imageUrl: null, imageThumbnailUrl: null,
    equipSlot: "weapon",
    equipStats: { str: 3 },
    weaponType: "sword_1h",
    isTwoHanded: false,
    grantedAt: NOW, grantedBy: "reset-players-season",
    atkStat: "str", tier: "D", enhanceLevel: 0,
  };
}

function emptyEquipment(keepTitle) {
  return {
    head_top: null, head_mid: null, head_low: null,
    armor: null, weapon: makeStarterWeapon(), shield: null,
    garment: null, shoes: null, accessory_l: null, accessory_r: null,
    title_eq: keepTitle || null,   // 保留裝備中的稱號
    job_eq: null, special_1: null, special_2: null, special_3: null,
  };
}

// 背包：只保留收藏品 + 稱號；龍蛋(pet_egg)一律清除（明確排除，防未來誤分類）
function filterKeptInventory(inventory) {
  const arr = Array.isArray(inventory) ? inventory : [];
  return arr.filter((it) => {
    if (!it) return false;
    if (it.itemType === "pet_egg") return false;          // 龍蛋一定清
    return it.itemType === "collectible" || it.equipSlot === "title_eq";
  });
}

async function main() {
  const db = await getMongoDb();
  const progressCol = db.collection("progress");
  const walletsCol = db.collection("wallets");
  const wqpCol = db.collection("weeklyQuestProgress");
  const checkinsCol = db.collection("checkins");

  const query = PLAYER_ID ? { playerId: PLAYER_ID } : {};
  const players = await progressCol.find(query).toArray();
  console.log(`模式：${APPLY ? "🔴 APPLY（會寫入）" : "🟢 DRY-RUN（只印不寫）"}`);
  console.log(`目標：${PLAYER_ID ? `單一玩家 ${PLAYER_ID}` : `全部玩家`}，共 ${players.length} 筆 progress\n`);

  let resetCount = 0, keptTitles = 0, keptCollectibles = 0;
  for (const p of players) {
    const pid = p.playerId;
    const keepInv = filterKeptInventory(p.inventory);
    const titleCount = keepInv.filter((x) => x.equipSlot === "title_eq").length;
    const collCount = keepInv.filter((x) => x.itemType === "collectible").length;
    const eggCount = (p.inventory || []).filter((x) => x && x.itemType === "pet_egg").length;
    const equippedTitle = p.equipment?.title_eq || null;
    keptTitles += titleCount + (equippedTitle ? 1 : 0);
    keptCollectibles += collCount;

    const setFields = {
      level: 1, exp: 0, job: "Novice", jobLevel: 1,
      statusPoints: 0, allocatedPoints: 0,
      attributes: { ...INITIAL_ATTRIBUTES },
      equipment: emptyEquipment(equippedTitle),
      inventory: keepInv,
      equipPresets: {}, activePreset: "A",
      activeEffects: [],
      pets: [], activePetUuid: null,
      pkWins: 0, pkLosses: 0,
      flags: {},
      updatedAt: NOW,
    };
    // 用 unset 讓 ?? 預設值生效（PK 1500、無爬塔紀錄）
    const unsetFields = { pkRating: "", towerRecord: "" };

    // 金幣歸 0，鑽石保留
    const wallet = await walletsCol.findOne({ playerId: pid });
    const goldBefore = wallet?.gold ?? 0;
    const diamondKeep = wallet?.diamond ?? 0;

    if (APPLY) {
      await progressCol.updateOne({ _id: p._id }, { $set: setFields, $unset: unsetFields });
      if (wallet) await walletsCol.updateOne({ playerId: pid }, { $set: { gold: 0, updatedAt: NOW } });
      await wqpCol.deleteMany({ discordId: pid });
      await checkinsCol.deleteMany({ playerId: pid });
    }

    const invBefore = (p.inventory || []).length;
    console.log(`[${APPLY ? "DONE" : "DRY"}] ${pid}｜Lv ${p.level}→1｜金幣 ${goldBefore}→0（鑽石保留 ${diamondKeep}）｜背包 ${invBefore}→${keepInv.length}（留稱號 ${titleCount}+裝備中${equippedTitle ? 1 : 0}、收藏 ${collCount}）｜寵物 ${(p.pets || []).length}→0`);
    resetCount++;
  }

  console.log(`\n小結：處理 ${resetCount} 名玩家，保留稱號共 ${keptTitles} 件、收藏共 ${keptCollectibles} 件。`);
  if (!APPLY) console.log("⚠️ 這是 DRY-RUN，沒有任何寫入。確認無誤後加 APPLY=1 重跑。");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
