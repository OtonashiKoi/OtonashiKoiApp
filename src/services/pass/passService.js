"use strict";
// 賽季通行證（Battle Pass）
//   - 30 級，打怪累積點數升級（依地圖階級給點：越後面越多）
//   - 免費軌：所有人可領。付費軌：3 鑽開通後可領。
//   - 換季重置（seasonKey 變更 → 點數/開通/已領清空）
//   - 佛心度中等：付費軌整條回 2 鑽 + 1 顆蛋 + 頂級 A 裝 + 一堆強化石/藥水
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { pushRewardItemsToInventory } = require("../../shared/jobBadgeBonus");
const { CURRENCY_SOURCES } = require("../../shared/sources");

const COLLECTION = "passState";
const MAX_LEVEL = 30;
const POINTS_PER_LEVEL = 100;      // 每級所需點數（滿級 3000 點）
const UNLOCK_COST_DIAMOND = 3;
// 打怪給點：依地圖階級（越後段越多，鼓勵打高階）
const POINTS_BY_TIER = { D: 1, C: 2, B: 3, A: 5, S: 6 };

// 獎勵道具 ID
const GEM = { D: "72fde92d-e33f-42fb-8d86-2e811d03f84d", C: "556db9e1-b084-4b22-bab5-a66c2b586184", B: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072", A: "a6ae293d-52fc-4af5-8770-891ddf842e35" };
const EGG_SLIME = "1fb1f325-7d73-43c7-a55f-3f51752870b0";
const EGG_DRAGON = "14205225-0e0f-4d83-8908-5d24f781bd69";
const EGG_WOLF = "27c8b251-42c7-42cf-98a3-ee40408503db";
const REROLL = "enchant_reroll_potion";
const RESPEC = "87b281be-b175-40a0-8044-0accc88a0ee0";
const GOLDBAG_L = "1854a2b1-a569-4604-802d-9171f480a9ae";
const A_GEAR = "99d23a47-89a6-4291-9b03-8f15e7356eec"; // 秘銀單手劍（頂獎 A 裝）

// 產生 30 級雙軌獎勵表
function buildLevels() {
  const levels = [];
  for (let L = 1; L <= MAX_LEVEL; L++) {
    const free = { gold: 3000 + L * 400, items: [] };
    const paid = { gold: 4000 + L * 600, items: [] };

    // ── 免費軌（豐富化）：早期 D 石、每 2 級 C 石、每 5 級 B 石、每 10 級大金袋、20/30 送重骰藥水 ──
    if (L <= 6 && L % 2 === 1) free.items.push({ itemId: GEM.D, qty: 3 });
    if (L % 2 === 0) free.items.push({ itemId: GEM.C, qty: 2 });
    if (L % 5 === 0) free.items.push({ itemId: GEM.B, qty: 3 });
    if (L % 10 === 0) free.items.push({ itemId: GOLDBAG_L, qty: 1 });
    if (L === 20 || L === 30) free.items.push({ itemId: REROLL, qty: 1 });

    // ── 付費軌：每 3 級多給強化石(前段 B 石、L15 起才給 A 石)、每 10 級一顆蛋、回 2 鑽、藥水、頂獎 A 裝 ──
    if (L % 3 === 0) paid.items.push(L >= 15 ? { itemId: GEM.A, qty: 2 } : { itemId: GEM.B, qty: 3 });
    if (L === 10) paid.items.push({ itemId: EGG_SLIME, qty: 1 });    // 10 史萊姆蛋
    if (L === 20) paid.items.push({ itemId: EGG_DRAGON, qty: 1 });   // 20 龍蛋
    if (L === 30) paid.items.push({ itemId: EGG_WOLF, qty: 1 });     // 30 狼牙蛋
    if (L === 5) paid.items.push({ itemId: GOLDBAG_L, qty: 1 });
    if (L === 10) paid.diamond = 1;                                  // 回鑽 1/2
    if (L === 18) paid.items.push({ itemId: REROLL, qty: 1 });       // 附魔重骰
    if (L === 22) paid.items.push({ itemId: RESPEC, qty: 1 });       // 洗點
    if (L === 25) paid.diamond = 1;                                  // 回鑽 2/2
    if (L === 30) paid.items.push({ itemId: A_GEAR, qty: 1 });       // 頂獎 A 裝

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
      doc = { _id: discordId, seasonKey: season, points: 0, unlocked: false, claimedFree: [], claimedPaid: [], updatedAt: new Date().toISOString() };
      await db.collection(COLLECTION).updateOne({ _id: discordId }, { $set: doc }, { upsert: true });
    }
    return doc;
  }

  /** 打怪加點（best-effort，不影響戰鬥）。tier=地圖階級。 */
  async addPointsForKill(discordId, tier, count = 1) {
    try {
      if (!discordId) return;
      const pts = pointsForKillTier(tier) * Math.max(1, Number(count) || 1);
      const db = await getMongoDb();
      const season = await this._seasonKey();
      await db.collection(COLLECTION).updateOne(
        { _id: discordId },
        { $inc: { points: pts }, $set: { seasonKey: season, updatedAt: new Date().toISOString() }, $setOnInsert: { unlocked: false, claimedFree: [], claimedPaid: [] } },
        { upsert: true }
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

  /** 3 鑽開通付費軌 */
  async unlock(discordId, displayName) {
    const raw = await this._getRaw(discordId);
    if (raw.unlocked) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "本賽季通行證已開通", 400);
    const wallet = await this.walletService.getWalletByDiscordId(discordId, displayName).catch(() => null);
    const diamonds = Math.max(0, Number(wallet?.wallet?.diamond ?? wallet?.diamond) || 0);
    if (diamonds < UNLOCK_COST_DIAMOND) throw new AppError(ERROR_CODES.INSUFFICIENT_FUNDS, `開通需 ${UNLOCK_COST_DIAMOND} 鑽石，你目前只有 ${diamonds}`, 400);
    await this.rewardService.grantCurrency({
      discordId, displayName, currencyType: "diamond", amount: -UNLOCK_COST_DIAMOND,
      source: CURRENCY_SOURCES.PASS_UNLOCK || "pass_unlock", operator: "pass:unlock",
    });
    const db = await getMongoDb();
    await db.collection(COLLECTION).updateOne({ _id: discordId }, { $set: { unlocked: true, updatedAt: new Date().toISOString() } });
    return { unlocked: true };
  }

  /** 領取某級獎勵（track: "free" | "paid"） */
  async claim(discordId, displayName, level, track) {
    const lv = Math.max(1, Math.min(MAX_LEVEL, Number(level) || 0));
    const raw = await this._getRaw(discordId);
    const curLevel = levelFromPoints(raw.points);
    if (curLevel < lv) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `通行證等級不足（目前 Lv.${curLevel}，需 Lv.${lv}）`, 400);
    const isPaid = track === "paid";
    if (isPaid && !raw.unlocked) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "付費軌需先花 3 鑽開通", 400);
    const claimedField = isPaid ? "claimedPaid" : "claimedFree";
    const claimed = new Set(raw[claimedField] || []);
    if (claimed.has(lv)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此獎勵已領取", 400);

    const def = LEVELS.find((x) => x.level === lv);
    const reward = isPaid ? def?.paid : def?.free;
    if (!reward) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "找不到該獎勵", 404);

    // 原子搶佔：先把 level 加進已領，成功才發（避免重複領）
    const db = await getMongoDb();
    const claim = await db.collection(COLLECTION).updateOne(
      { _id: discordId, [claimedField]: { $ne: lv } },
      { $addToSet: { [claimedField]: lv }, $set: { updatedAt: new Date().toISOString() } }
    );
    if (!claim.modifiedCount) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此獎勵已領取", 400);

    const granted = [];
    try {
      if (reward.gold > 0) { await this.rewardService.grantCurrency({ discordId, displayName, currencyType: "gold", amount: reward.gold, source: CURRENCY_SOURCES.PASS_REWARD || "pass_reward", operator: "pass:claim" }); granted.push(`金幣 ${reward.gold}`); }
      if (reward.diamond > 0) { await this.rewardService.grantCurrency({ discordId, displayName, currencyType: "diamond", amount: reward.diamond, source: CURRENCY_SOURCES.PASS_REWARD || "pass_reward", operator: "pass:claim" }); granted.push(`鑽石 ${reward.diamond}`); }
      if (Array.isArray(reward.items) && reward.items.length) {
        const prog = await this.progressRepository.findByPlayerId(discordId);
        if (prog) {
          const g = await pushRewardItemsToInventory({ progress: prog, itemRepository: this.itemRepository, rewardItems: reward.items, source: "pass_reward" });
          prog.updatedAt = new Date().toISOString();
          await this.progressRepository.save(prog);
          g.forEach((x) => granted.push(`${x.name}×${x.qty}`));
        }
      }
    } catch (err) {
      // 發獎失敗 → 撤回已領標記，讓玩家可重領
      await db.collection(COLLECTION).updateOne({ _id: discordId }, { $pull: { [claimedField]: lv } }).catch(() => {});
      throw err;
    }
    return { level: lv, track, granted };
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

  /** 換季：把 seasonKey 換掉（玩家下次讀取時自動重置） */
  async resetSeason(newSeasonKey) {
    const db = await getMongoDb();
    await db.collection("serverEventConfig").updateOne(
      { _id: "default" }, { $set: { passSeasonKey: String(newSeasonKey || `s${Date.now()}`) } }, { upsert: true }
    );
    return { seasonKey: newSeasonKey };
  }
}

module.exports = { PassService, MAX_LEVEL, POINTS_PER_LEVEL, pointsForKillTier };
