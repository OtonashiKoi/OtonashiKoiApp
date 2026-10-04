"use strict";
const rules = require("../../shared/autumnTitleRules");
const { withPlayerProgressLock } = require("../progress/progressLocks");
const { pushRewardItemsToInventory } = require("../../shared/jobBadgeBonus");
const { CURRENCY_SOURCES } = require("../../shared/sources");

// MongoDB owns _id; structuredClone would turn its ObjectId into a plain object.
function cloneMutableProgress(progress) {
  const { _id, ...mutable } = progress;
  return structuredClone(mutable);
}

class AutumnTitleService {
  constructor({ progressRepository, itemRepository, rewardService, isOpen = rules.isPublicSeasonOpen }) {
    this.progressRepository = progressRepository;
    this.itemRepository = itemRepository;
    this.rewardService = rewardService;
    this.isOpen = isOpen;
  }
  view(q, p) { return rules.view(q, p); }
  async record(discordId, event) {
    if (event?.eligible === false || !this.isOpen() && event?.eligible !== true) return;
    return withPlayerProgressLock(discordId, async () => {
      for (let retry = 0; retry < 8; retry++) {
        const p = await this.progressRepository.findByPlayerId(discordId);
        if (!p) return;
        const next = cloneMutableProgress(p);
        if (!rules.recordEvent(next, event, event?.eligible === true || this.isOpen())) return;
        next.updatedAt = new Date(Math.max(Date.now(), (Date.parse(p.updatedAt) || 0) + 1)).toISOString();
        if (await this.progressRepository.saveIfUnchanged(next, p.updatedAt)) return;
      }
      throw new Error("稱號進度儲存忙碌，請重試");
    });
  }
  async recordBatch(discordId, metrics, options = {}) {
    const values = metrics instanceof Map ? Object.fromEntries(metrics)
      : Array.isArray(metrics) ? metrics.reduce((out, e) => { const [key, n] = Array.isArray(e) ? e : [e.type, e.amount]; out[key] = Number(out[key] || 0) + Number(n || 0); return out; }, {}) : metrics || {};
    if (!values.battle_win && !values.party_floor_clear) return;
    await this.record(discordId, { type: "battle", wins: values.battle_win || 0, floors: values.party_floor_clear || 0,
      id: options.operationId, ...options.autumnEvent });
  }
  async claim(discordId, q) {
    const title = rules.titleForQuest(q);
    if (!title || !q.enabled) throw new Error("任務不存在或未啟用");
    if (!this.isOpen()) throw new Error("賽季尚未開放，稱號任務尚不能領取");
    return withPlayerProgressLock(discordId, async () => {
      let p = await this.progressRepository.findByPlayerId(discordId);
      if (!p || p.seasonKey !== rules.SEASON_KEY) throw new Error("賽季已變更");
      const slot = rules.slotOf(p), state = rules.characterState(p);
      const receipt = `autumn-title:${rules.SEASON_KEY}:${discordId}:${slot}:${title.key}`;
      if (state.claimed?.[title.key]) throw new Error("獎勵已領取");
      if (Number(p.level || 1) < Number(q.unlockLevel || 0) || rules.currentFor(title, state) < title.target) throw new Error("任務尚未完成");
      const rewardItems = [...(q.rewardItems || [])];
      if (!rewardItems.some(r => r.itemId === title.itemId && r.qty === 1)) throw new Error("稱號獎勵設定不正確");
      for (const r of rewardItems) if (!await this.itemRepository.findById(r.itemId)) throw new Error("任務獎勵道具不存在");
      // Validate the complete inventory grant before crediting currency; no cost or marker on failure.
      await pushRewardItemsToInventory({ progress: cloneMutableProgress(p), itemRepository: this.itemRepository, rewardItems, source: "quest" });
      if (Number(q.rewardGold || 0) > 0) await this.rewardService.grantCurrency({ discordId, displayName: discordId,
        currencyType: "gold", amount: q.rewardGold, source: CURRENCY_SOURCES.QUEST_REWARD, sourceRef: receipt + ":gold", operator: "quest" });
      for (let retry = 0; retry < 8; retry++) {
        p = await this.progressRepository.findByPlayerId(discordId);
        if (!p || p.seasonKey !== rules.SEASON_KEY || rules.slotOf(p) !== slot) throw new Error("人物或賽季已變更，請切回原人物重試");
        if (rules.characterState(p).claimed?.[title.key]) throw new Error("獎勵已領取");
        const next = cloneMutableProgress(p);
        const granted = await pushRewardItemsToInventory({ progress: next, itemRepository: this.itemRepository, rewardItems, source: "quest" });
        next.autumnTitleProgress ||= { seasonKey: rules.SEASON_KEY, slots: {} };
        const s = next.autumnTitleProgress.slots[slot] ||= {};
        s.claimed ||= {}; s.claimed[title.key] = { receipt, at: new Date().toISOString() };
        next.questRewardReceipts = [...(p.questRewardReceipts || []), receipt];
        next.updatedAt = new Date(Math.max(Date.now(), (Date.parse(p.updatedAt) || 0) + 1)).toISOString();
        if (await this.progressRepository.saveIfUnchanged(next, p.updatedAt)) {
          require("../realtime/playerEventBus").playerEventBus.invalidateInventory(discordId);
          return { questTitle: q.title, gold: Number(q.rewardGold || 0), exp: 0, diamond: 0,
            rewardItemId: null, rewardItems, rewardItemsGranted: granted, cadence: "season", periodKey: rules.SEASON_KEY, receipt };
        }
      }
      throw new Error("任務背包儲存忙碌，請重試；已入帳金幣不會重發");
    });
  }
}
module.exports = { AutumnTitleService };
