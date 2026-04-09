"use strict";

const { readStore, updateStore } = require("../../adapters/json/jsonStore");

// 任務類型定義
const QUEST_TYPES = {
  battle_count:  { label: "出戰次數",     unit: "次" },
  battle_win:    { label: "戰鬥勝利次數",  unit: "次" },
  damage_total:  { label: "累計造成傷害",  unit: "點" },
  checkin_count: { label: "打卡次數",      unit: "次" },
};

/** 取得當週標籤，格式 2026-W15 */
function currentWeekLabel() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

class WeeklyQuestService {
  // ── 任務定義 CRUD ──────────────────────────────────

  async listQuests() {
    const store = await readStore();
    return store.weeklyQuests || [];
  }

  async createQuest(fields) {
    const quest = {
      id: crypto.randomUUID(),
      title:         String(fields.title || "").trim() || "新任務",
      description:   String(fields.description || "").trim(),
      type:          QUEST_TYPES[fields.type] ? fields.type : "battle_count",
      target:        Math.max(1, Number(fields.target) || 1),
      rewardGold:    Math.max(0, Number(fields.rewardGold) || 0),
      rewardDiamond: Math.max(0, Number(fields.rewardDiamond) || 0),
      rewardItemId:  fields.rewardItemId || null,
      enabled:       fields.enabled !== false,
      createdAt:     new Date().toISOString(),
    };
    await updateStore((store) => {
      store.weeklyQuests = [...(store.weeklyQuests || []), quest];
      return store;
    });
    return quest;
  }

  async updateQuest(id, fields) {
    let found = null;
    await updateStore((store) => {
      const idx = (store.weeklyQuests || []).findIndex((q) => q.id === id);
      if (idx < 0) throw new Error("任務不存在");
      const q = { ...store.weeklyQuests[idx] };
      if (fields.title       !== undefined) q.title         = String(fields.title).trim() || q.title;
      if (fields.description !== undefined) q.description   = String(fields.description).trim();
      if (fields.type        !== undefined && QUEST_TYPES[fields.type]) q.type = fields.type;
      if (fields.target      !== undefined) q.target        = Math.max(1, Number(fields.target) || 1);
      if (fields.rewardGold  !== undefined) q.rewardGold    = Math.max(0, Number(fields.rewardGold) || 0);
      if (fields.rewardDiamond !== undefined) q.rewardDiamond = Math.max(0, Number(fields.rewardDiamond) || 0);
      if (fields.rewardItemId !== undefined) q.rewardItemId = fields.rewardItemId || null;
      if (fields.enabled     !== undefined) q.enabled       = Boolean(fields.enabled);
      store.weeklyQuests[idx] = q;
      found = q;
      return store;
    });
    return found;
  }

  async deleteQuest(id) {
    await updateStore((store) => {
      store.weeklyQuests = (store.weeklyQuests || []).filter((q) => q.id !== id);
      return store;
    });
  }

  // ── 玩家進度 ──────────────────────────────────────

  /** 取得玩家本週進度（含任務定義），回傳 [{ quest, current, claimed, done }] */
  async getPlayerProgress(discordId, weekLabel = null) {
    const wl = weekLabel || currentWeekLabel();
    const store = await readStore();
    const quests = (store.weeklyQuests || []).filter((q) => q.enabled);
    const playerWk = (store.weeklyQuestProgress[discordId] || {})[wl] || {};
    return quests.map((q) => {
      const p = playerWk[q.id] || { current: 0, claimed: false };
      return {
        quest:   q,
        current: p.current,
        claimed: p.claimed,
        done:    p.current >= q.target,
      };
    });
  }

  /**
   * 記錄進度增量（戰鬥/打卡觸發）
   * type: 'battle_count' | 'battle_win' | 'damage_total' | 'checkin_count'
   * amount: 增加的量（預設 1）
   */
  async recordProgress(discordId, type, amount = 1) {
    const wl = currentWeekLabel();
    await updateStore((store) => {
      if (!store.weeklyQuestProgress[discordId]) store.weeklyQuestProgress[discordId] = {};
      if (!store.weeklyQuestProgress[discordId][wl]) store.weeklyQuestProgress[discordId][wl] = {};
      const playerWk = store.weeklyQuestProgress[discordId][wl];

      const quests = (store.weeklyQuests || []).filter((q) => q.enabled && q.type === type);
      for (const q of quests) {
        if (!playerWk[q.id]) playerWk[q.id] = { current: 0, claimed: false };
        if (!playerWk[q.id].claimed) {
          playerWk[q.id].current = Math.min(q.target, playerWk[q.id].current + amount);
        }
      }
      return store;
    });
  }

  /**
   * 領取完成的任務獎勵
   * 回傳 { gold, diamond, itemId, questTitle }
   */
  async claimReward(discordId, questId) {
    const wl = currentWeekLabel();
    let reward = null;

    await updateStore((store) => {
      const quest = (store.weeklyQuests || []).find((q) => q.id === questId && q.enabled);
      if (!quest) throw new Error("任務不存在或未啟用");

      if (!store.weeklyQuestProgress[discordId]) store.weeklyQuestProgress[discordId] = {};
      if (!store.weeklyQuestProgress[discordId][wl]) store.weeklyQuestProgress[discordId][wl] = {};
      const p = store.weeklyQuestProgress[discordId][wl][questId] || { current: 0, claimed: false };

      if (p.current < quest.target) throw new Error("任務尚未完成");
      if (p.claimed) throw new Error("獎勵已領取");

      p.claimed = true;
      store.weeklyQuestProgress[discordId][wl][questId] = p;
      reward = {
        questTitle:    quest.title,
        gold:          quest.rewardGold,
        diamond:       quest.rewardDiamond,
        rewardItemId:  quest.rewardItemId,
      };
      return store;
    });

    return reward;
  }

  /** 供後台查看：所有玩家本週各任務完成/領取狀況 */
  async getWeekSummary(weekLabel = null) {
    const wl = weekLabel || currentWeekLabel();
    const store = await readStore();
    const quests = store.weeklyQuests || [];
    const allProgress = store.weeklyQuestProgress || {};
    const result = {};
    for (const [pid, weeks] of Object.entries(allProgress)) {
      const wkData = weeks[wl] || {};
      result[pid] = {};
      for (const q of quests) {
        const p = wkData[q.id] || { current: 0, claimed: false };
        result[pid][q.id] = { current: p.current, claimed: p.claimed, done: p.current >= q.target };
      }
    }
    return { weekLabel: wl, quests, progress: result };
  }
}

module.exports = { WeeklyQuestService, QUEST_TYPES, currentWeekLabel };
