"use strict";

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
  constructor(weeklyQuestRepository, playerService) {
    this.repo = weeklyQuestRepository;
    this.playerService = playerService;
  }

  // ── 任務定義 CRUD ──────────────────────────────────

  async listQuests() {
    return this.repo.listQuests();
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
      // 等級限制：達到此等級才會在玩家端看見（0 或未設定 = 不限制）
      levelLimit:    Math.max(0, Number(fields.levelLimit) || 0),
      createdAt:     new Date().toISOString(),
    };
    return this.repo.saveQuest(quest);
  }

  async updateQuest(id, fields) {
    const quest = await this.repo.findQuestById(id);
    if (!quest) throw new Error("任務不存在");
    if (fields.title       !== undefined) quest.title         = String(fields.title).trim() || quest.title;
    if (fields.description !== undefined) quest.description   = String(fields.description).trim();
    if (fields.type        !== undefined && QUEST_TYPES[fields.type]) quest.type = fields.type;
    if (fields.target      !== undefined) quest.target        = Math.max(1, Number(fields.target) || 1);
    if (fields.rewardGold  !== undefined) quest.rewardGold    = Math.max(0, Number(fields.rewardGold) || 0);
    if (fields.rewardDiamond !== undefined) quest.rewardDiamond = Math.max(0, Number(fields.rewardDiamond) || 0);
    if (fields.rewardItemId !== undefined) quest.rewardItemId = fields.rewardItemId || null;
    if (fields.enabled     !== undefined) quest.enabled       = Boolean(fields.enabled);
    if (fields.levelLimit  !== undefined) quest.levelLimit    = Math.max(0, Number(fields.levelLimit) || 0);
    return this.repo.saveQuest(quest);
  }

  async deleteQuest(id) {
    await this.repo.deleteQuest(id);
  }

  // ── 玩家進度 ──────────────────────────────────────

  /** 取得玩家本週進度（含任務定義），回傳 [{ quest, current, claimed, done }] */
  async getPlayerProgress(discordId, weekLabel = null) {
    const wl = weekLabel || currentWeekLabel();
    const allQuests = await this.repo.listQuests();
    // 依玩家等級過濾不可見的任務
    let playerLevel = 1;
    try {
      const profile = await this.playerService.getProfile(discordId, discordId);
      playerLevel = (profile?.progress?.level) || 1;
    } catch (_) { /* ignore */ }
    const quests = allQuests.filter((q) => q.enabled && (!q.levelLimit || q.levelLimit <= playerLevel));
    const playerWk = await this.repo.getPlayerProgress(discordId, wl);
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
    const allQuests = await this.repo.listQuests();
    // 只對符合類型且玩家等級可見的任務進行進度記錄
    let playerLevel = 1;
    try {
      const profile = await this.playerService.getProfile(discordId, discordId);
      playerLevel = (profile?.progress?.level) || 1;
    } catch (_) { /* ignore */ }
    const quests = allQuests.filter((q) => q.enabled && q.type === type && (!q.levelLimit || q.levelLimit <= playerLevel));
    if (!quests.length) return;

    const playerWk = await this.repo.getPlayerProgress(discordId, wl);
    for (const q of quests) {
      if (!playerWk[q.id]) playerWk[q.id] = { current: 0, claimed: false };
      if (!playerWk[q.id].claimed) {
        playerWk[q.id].current = Math.min(q.target, playerWk[q.id].current + amount);
      }
    }
    await this.repo.savePlayerProgress(discordId, wl, playerWk);
  }

  /**
   * 領取完成的任務獎勵
   * 回傳 { gold, diamond, rewardItemId, questTitle }
   */
  async claimReward(discordId, questId) {
    const wl = currentWeekLabel();
    const allQuests = await this.repo.listQuests();
    const quest = allQuests.find((q) => q.id === questId && q.enabled);
    if (!quest) throw new Error("任務不存在或未啟用");

    // 檢查玩家等級是否達標
    try {
      const profile = await this.playerService.getProfile(discordId, discordId);
      const playerLevel = (profile?.progress?.level) || 1;
      if (quest.levelLimit && quest.levelLimit > playerLevel) throw new Error("等級不足");
    } catch (e) {
      if (e.message === "等級不足") throw e;
      // 否則忽略 profile 取得錯誤
    }

    const playerWk = await this.repo.getPlayerProgress(discordId, wl);
    const p = playerWk[questId] || { current: 0, claimed: false };
    if (p.current < quest.target) throw new Error("任務尚未完成");
    if (p.claimed) throw new Error("獎勵已領取");

    p.claimed = true;
    playerWk[questId] = p;
    await this.repo.savePlayerProgress(discordId, wl, playerWk);

    return {
      questTitle:   quest.title,
      gold:         quest.rewardGold,
      diamond:      quest.rewardDiamond,
      rewardItemId: quest.rewardItemId,
    };
  }

  /** 供後台查看：所有玩家本週各任務完成/領取狀況 */
  async getWeekSummary(weekLabel = null) {
    const wl = weekLabel || currentWeekLabel();
    const quests = await this.repo.listQuests();
    const allProgress = await this.repo.getAllProgressByWeek(wl);
    const result = {};
    for (const [pid, playerWk] of Object.entries(allProgress)) {
      result[pid] = {};
      for (const q of quests) {
        const p = (playerWk[q.id]) || { current: 0, claimed: false };
        result[pid][q.id] = { current: p.current, claimed: p.claimed, done: p.current >= q.target };
      }
    }
    return { weekLabel: wl, quests, progress: result };
  }
}

module.exports = { WeeklyQuestService, QUEST_TYPES, currentWeekLabel };
