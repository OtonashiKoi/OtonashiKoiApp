"use strict";
// 賽季通行證（Battle Pass）
//   - 30 級，打怪累積點數升級（依地圖階級給點：越後面越多）
//   - 免費軌：所有人可領。付費軌：5 鑽開通後可領（V0.5 起）。
//   - 換季重置（seasonKey 變更 → 點數/開通/已領清空）
//   - V0.5 定案：付費軌整條回 3 鑽＋金幣/強化石/少量屬性石/藥水（蛋與武器箱移除）
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { pushRewardItemsToInventory } = require("../../shared/jobBadgeBonus");
const { CURRENCY_SOURCES } = require("../../shared/sources");

const { withPlayerProgressLock } = require("../progress/progressLocks");
const passLocks = new Map();
async function withPassLock(id, fn) {
  const prior = passLocks.get(id) || Promise.resolve();
  let release; const next = new Promise(r => { release = r; });
  const chain = prior.then(() => next); passLocks.set(id, chain);
  await prior;
  try { return await fn(); } finally { release(); if (passLocks.get(id) === chain) passLocks.delete(id); }
}
const COLLECTION = "passState";
const MAX_LEVEL = 30;
// 楓紅漸漸：每級1,000點，滿級30,000點；一般區按階級給點，副本逐層另計。
const POINTS_PER_LEVEL = 1000;
const UNLOCK_COST_DIAMOND = 5;
// 打怪給點：依地圖階級（越後段越多，鼓勵打高階）
const POINTS_BY_TIER = { D: 1, C: 2, B: 3, A: 5, S: 6 };

// 獎勵道具 ID
const GEM = { D: "72fde92d-e33f-42fb-8d86-2e811d03f84d", C: "556db9e1-b084-4b22-bab5-a66c2b586184", B: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072", A: "a6ae293d-52fc-4af5-8770-891ddf842e35", S: "gem-s-tier" };
const REROLL = "enchant_reroll_potion";
const RESPEC = "87b281be-b175-40a0-8044-0accc88a0ee0";
const GOLDBAG_M = "71aaa3a2-abb9-4b01-b024-16e553b08840";
// 屬性石刻意稀缺（分解唯一主來源），通行證只給「一點點」：付費軌水/火（雙王主題）、免費軌其餘五屬輪替
const STONE_WATER = "element-stone-water";
const STONE_FIRE = "element-stone-fire";
const STONE_WOOD = "element-stone-wood";
const STONE_EARTH = "element-stone-earth";
const STONE_METAL = "element-stone-metal";
const STONE_SUN = "element-stone-sun";
const STONE_MOON = "element-stone-moon";
const A_WEAPON_CHEST = "chest-a-weapon-select"; // A階武器抽選箱（開箱隨機一把 A 階武器）

// 產生 30 級雙軌獎勵表（V0.5：金幣＋強化石＋少量屬性石＋藥水；回 3 鑽）
function buildLevels() {
  const levels = [];
  for (let L = 1; L <= MAX_LEVEL; L++) {
    const free = { gold: 1500 + L * 150, items: [] };
    const paid = { gold: 3000 + L * 300, items: [] };

    // ── 免費軌：早期 D 石、每 2 級 C 石、每 5 級 B 石、每 6 級屬性石輪替、每 10 級中金袋、20/30 送重骰 ──
    if (L <= 6 && L % 2 === 1) free.items.push({ itemId: GEM.D, qty: 3 });
    if (L % 2 === 0) free.items.push({ itemId: GEM.C, qty: 1 });
    if (L % 5 === 0) free.items.push({ itemId: GEM.B, qty: 2 });
    if (L === 25 || L === 30) free.items.push({ itemId: GEM.S, qty: 1 });
    if (L === 6) free.items.push({ itemId: STONE_WOOD, qty: 1 });
    if (L === 12) free.items.push({ itemId: STONE_EARTH, qty: 1 });
    if (L === 18) free.items.push({ itemId: STONE_METAL, qty: 1 });
    if (L === 24) free.items.push({ itemId: STONE_SUN, qty: 1 });
    if (L === 30) free.items.push({ itemId: STONE_MOON, qty: 1 });
    if (L % 10 === 0) free.items.push({ itemId: GOLDBAG_M, qty: 1 });
    if (L === 20 || L === 30) free.items.push({ itemId: REROLL, qty: 1 });

    // ── 付費軌：每 3 級強化石(前段 B、L15 起 A)、回 3 鑽(10/20/30)、屬性石一點點(12/24/30)、藥水 ──
    if (L % 3 === 0) paid.items.push(L >= 15 ? { itemId: GEM.A, qty: 2 } : { itemId: GEM.B, qty: 3 });
    if (L === 5) paid.items.push({ itemId: GOLDBAG_M, qty: 1 });
    if (L === 10) paid.diamond = 1;                                   // 回鑽 1/3
    if (L === 12) paid.items.push({ itemId: STONE_WATER, qty: 1 });   // 屬性石（本季主題水）
    if (L === 15) paid.items.push({ itemId: GEM.B, qty: 3 }); // 中段養成補給，不提前提供 A 武器
    if (L === 18) paid.items.push({ itemId: REROLL, qty: 1 });        // 附魔重骰
    if (L === 20 || L === 25 || L === 30) paid.items.push({ itemId: GEM.S, qty: 1 });
    if (L === 20) paid.diamond = 1;                                   // 回鑽 2/3
    if (L === 22) paid.items.push({ itemId: RESPEC, qty: 1 });        // 屬性重製
    if (L === 24) paid.items.push({ itemId: STONE_FIRE, qty: 1 });    // 屬性石（狼牙王線火）
    if (L === 30) {                                                   // 頂獎：回鑽 3/3＋雙屬性石＋重骰×2
      paid.diamond = 1;
      paid.items.push({ itemId: STONE_WATER, qty: 1 }, { itemId: STONE_FIRE, qty: 1 }, { itemId: REROLL, qty: 2 });
    }

    levels.push({ level: L, free, paid });
  }
  return levels;
}
const LEVELS = buildLevels();

function levelFromPoints(points) {
  return Math.max(0, Math.min(MAX_LEVEL, Math.floor((Number(points) || 0) / POINTS_PER_LEVEL)));
}
function pointsForKillTier(tier) {
  return POINTS_BY_TIER[String(tier || "").toUpperCase()] || 1;
}

class PassService {
  constructor({ progressRepository, walletService, rewardService, itemRepository, streamEventConfig }) {
    this.progressRepository = progressRepository;
    this.walletService = walletService;
    this.rewardService = rewardService;
    this.itemRepository = itemRepository;
    this.streamEventConfig = streamEventConfig; // 用來拿 seasonKey（換季判定）
  }

  async _seasonKey() {
    // 用 serverEventConfig 的 seasonKey；沒有就用固定值（不換季）
    try {
      const db = await getMongoDb();
      const doc = await db.collection("serverEventConfig").findOne({ _id: "default" });
      return String(doc?.passSeasonKey || "s1");
    } catch (_) { return "s1"; }
  }

  async _getRaw(discordId) {
    const db = await getMongoDb();
    const season = await this._seasonKey();
    let doc = await db.collection(COLLECTION).findOne({ _id: discordId });
    // 換季：seasonKey 不同 → 重置該玩家通行證
    if (!doc || doc.seasonKey !== season) {
      const fresh = { seasonKey: season, points: 0, unlocked: false, claimedFree: [], claimedPaid: [], pointReceipts: [], unlockOperation: null, updatedAt: new Date().toISOString() };
      if (!doc) {
        await db.collection(COLLECTION).updateOne({ _id: discordId }, { $setOnInsert: fresh }, { upsert: true });
      } else {
        await db.collection(COLLECTION).updateOne({ _id: discordId, seasonKey: doc.seasonKey }, { $set: fresh });
      }
      doc = await db.collection(COLLECTION).findOne({ _id: discordId });
    }
    return doc;
  }

  /** 打怪加點（best-effort，不影響戰鬥）。tier=地圖階級。 */
  async addPointsForKill(discordId, tier, count = 1) {
    try {
      if (!discordId) return;
      const pts = pointsForKillTier(tier) * Math.max(1, Number(count) || 1);
      const db = await getMongoDb();
      // ⚠️ 必須先走 _getRaw：seasonKey 不同時它會整份重置。
      //   舊版在這裡直接 $set seasonKey ＝ 把上季幾十萬點原封帶進新季 → 開服瞬間滿級全領
      //   （2026-08-09 開服事故：3 人帶 12~29 萬舊點直接領完 30 級）。
      await this._getRaw(discordId);
      await db.collection(COLLECTION).updateOne(
        { _id: discordId },
        { $inc: { points: pts }, $set: { updatedAt: new Date().toISOString() } }
      );
    } catch (_) { /* noop */ }
  }

  // 一次解析所有獎勵道具的圖＋完整名稱（cache）
  async _itemMeta() {
    if (this._metaCache) return this._metaCache;
    const ids = new Set();
    for (const L of LEVELS) for (const trk of [L.free, L.paid]) for (const it of (trk.items || [])) ids.add(it.itemId);
    const map = {};
    for (const id of ids) {
      const it = await this.itemRepository.findById(id).catch(() => null);
      if (it) map[id] = { imageUrl: it.imageThumbnailUrl || it.imageUrl || null, name: it.name || null };
    }
    this._metaCache = map;
    return map;
  }

  /** 玩家通行證狀態（含等級表 + 已領 + 道具圖 + 完整名稱） */
  async getState(discordId) {
    const raw = await this._getRaw(discordId);
    const level = levelFromPoints(raw.points);
    const meta = await this._itemMeta();
    const withImg = (trk) => ({ ...trk, items: (trk.items || []).map((it) => ({ ...it, imageUrl: meta[it.itemId]?.imageUrl || null, name: meta[it.itemId]?.name || null })) });
    const levels = LEVELS.map((L) => ({ level: L.level, free: withImg(L.free), paid: withImg(L.paid) }));
    return {
      enabled: true,
      seasonKey: raw.seasonKey,
      points: raw.points || 0,
      level,
      maxLevel: MAX_LEVEL,
      pointsPerLevel: POINTS_PER_LEVEL,
      pointsIntoLevel: (raw.points || 0) % POINTS_PER_LEVEL,
      unlocked: Boolean(raw.unlocked),
      unlockCostDiamond: UNLOCK_COST_DIAMOND,
      claimedFree: raw.claimedFree || [],
      claimedPaid: raw.claimedPaid || [],
      levels,
    };
  }

  /** 開通與領獎採固定收據；中斷後可安全重試。 */
  async unlock(discordId, displayName) {
    return withPassLock(discordId, async () => {
      const raw = await this._getRaw(discordId);
      if (raw.unlocked) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "本賽季通行證已開通", 400);
      const db = await getMongoDb();
      const operation = raw.unlockOperation || `pass:${raw.seasonKey}:${discordId}:unlock:${require("crypto").randomUUID()}`;
      await db.collection(COLLECTION).updateOne({ _id: discordId, seasonKey: raw.seasonKey }, { $set: { unlockOperation: operation } });
      try {
        await this.rewardService.grantCurrency({ discordId, displayName, currencyType: "diamond", amount: -UNLOCK_COST_DIAMOND,
          source: CURRENCY_SOURCES.PASS_UNLOCK || "pass_unlock", sourceRef: operation, operator: "pass:unlock" });
      } catch (error) {
        if (error.code === "INSUFFICIENT_BALANCE") await db.collection(COLLECTION).updateOne({ _id: discordId, unlockOperation: operation }, { $set: { unlockOperation: null } });
        throw error;
      }
      await db.collection(COLLECTION).updateOne({ _id: discordId, seasonKey: raw.seasonKey }, { $set: { unlocked: true, updatedAt: new Date().toISOString() } });
      return { unlocked: true };
    });
  }

  async claim(discordId, displayName, level, track) {
    if (!["free", "paid"].includes(track) || !Number.isInteger(Number(level)) || Number(level) < 1 || Number(level) > MAX_LEVEL) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "獎勵級數或軌道無效", 400);
    }
    return withPassLock(discordId, async () => {
      const lv = Number(level), raw = await this._getRaw(discordId), paid = track === "paid";
      if (levelFromPoints(raw.points) < lv) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "通行證等級不足", 400);
      if (paid && !raw.unlocked) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `付費軌需先花 ${UNLOCK_COST_DIAMOND} 鑽開通`, 400);
      const field = paid ? "claimedPaid" : "claimedFree";
      if ((raw[field] || []).includes(lv)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此獎勵已領取", 400);
      const reward = LEVELS[lv - 1][track], ref = `pass:${raw.seasonKey}:${discordId}:${track}:${lv}`, granted = [];
      for (const currencyType of ["gold", "diamond"]) if (reward[currencyType] > 0) {
        await this.rewardService.grantCurrency({ discordId, displayName, currencyType, amount: reward[currencyType],
          source: CURRENCY_SOURCES.PASS_REWARD || "pass_reward", sourceRef: `${ref}:${currencyType}`, operator: "pass:claim" });
        granted.push(`${currencyType === "gold" ? "金幣" : "鑽石"} ${reward[currencyType]}`);
      }
      if (reward.items?.length) await withPlayerProgressLock(discordId, async () => {
        for (let retry = 0; retry < 8; retry++) {
          const prog = await this.progressRepository.findByPlayerId(discordId);
          if (!prog) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "找不到人物資料", 404);
          if ((prog.passRewardReceipts || []).includes(ref)) return;
          const next = structuredClone(prog);
          for (const entry of reward.items) if (!await this.itemRepository.findById(entry.itemId)) throw new Error(`通行證獎勵道具不存在：${entry.itemId}`);
          const items = await pushRewardItemsToInventory({ progress: next, itemRepository: this.itemRepository, rewardItems: reward.items, source: "pass_reward" });
          next.passRewardReceipts = [...(prog.passRewardReceipts || []), ref];
          next.updatedAt = new Date(Math.max(Date.now(), (Date.parse(prog.updatedAt) || 0) + 1)).toISOString();
          if (await this.progressRepository.saveIfUnchanged(next, prog.updatedAt)) {
            items.forEach(x => granted.push(`${x.name}×${x.qty}`)); return;
          }
        }
        throw new Error("通行證背包儲存忙碌，請重試");
      });
      const db = await getMongoDb();
      await db.collection(COLLECTION).updateOne({ _id: discordId, seasonKey: raw.seasonKey }, { $addToSet: { [field]: lv }, $set: { updatedAt: new Date().toISOString() } });
      return { level: lv, track, granted };
    });
  }

  async addPointsOnce(discordId, points, operationId) {
    if (!discordId || !Number.isSafeInteger(points) || points <= 0 || !operationId) throw new Error("通行證點數或收據無效");
    const raw = await this._getRaw(discordId), db = await getMongoDb();
    const result = await db.collection(COLLECTION).updateOne({ _id: discordId, seasonKey: raw.seasonKey, pointReceipts: { $ne: operationId } },
      { $inc: { points }, $addToSet: { pointReceipts: operationId }, $set: { updatedAt: new Date().toISOString() } });
    return result.modifiedCount > 0;
  }

  /** 後台：直接加/設點數（測試用） */
  async adminAddPoints(discordId, points, { set = false } = {}) {
    const db = await getMongoDb();
    const season = await this._seasonKey();
    const p = Math.floor(Number(points) || 0);
    await this._getRaw(discordId); // 確保有 doc / 換季初始化
    const update = set
      ? { $set: { points: Math.max(0, p), seasonKey: season, updatedAt: new Date().toISOString() } }
      : { $inc: { points: p }, $set: { seasonKey: season, updatedAt: new Date().toISOString() } };
    await db.collection(COLLECTION).updateOne({ _id: discordId }, update, { upsert: true });
    return this.getState(discordId);
  }

  /** 換季：切換 seasonKey，並立即歸零現有玩家；lazy reset 只作漏網資料的第二層保險。 */
  async resetSeason(newSeasonKey) {
    const db = await getMongoDb();
    const seasonKey = String(newSeasonKey || `s${Date.now()}`);
    const nowIso = new Date().toISOString();
    await db.collection("serverEventConfig").updateOne(
      { _id: "default" }, { $set: { passSeasonKey: seasonKey } }, { upsert: true }
    );
    const result = await db.collection(COLLECTION).updateMany({}, {
      $set: {
        seasonKey,
        points: 0,
        pointReceipts: [],
        unlockOperation: null,
        unlocked: false,
        claimedFree: [],
        claimedPaid: [],
        updatedAt: nowIso,
      },
    });
    return { seasonKey, resetPlayers: result.modifiedCount || 0 };
  }
}

module.exports = { PassService, MAX_LEVEL, POINTS_PER_LEVEL, pointsForKillTier };
