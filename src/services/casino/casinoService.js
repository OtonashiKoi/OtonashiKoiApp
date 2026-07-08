"use strict";

const crypto = require("crypto");
const {
  ROUND_DURATION_MS, LOCK_BEFORE_END_MS, WHEEL_SLOTS, COLORS, COLOR_META,
  BET_MIN, BET_MAX, PAYOUT_CAP, DROP_POOL, getBetTier, isBroadcastWorthy,
} = require("./wheelConfig");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const { notifyPlayer } = require("../realtime/playerNotifyService");
const uniqueGrant = require("../uniqueGrant/uniqueGrantService");

// 傳說錨點「命運之輪」— 任何中獎都有極低機率抽中，唯一（一生一次）
const DICE_JACKPOT_ITEM_ID = "s-legend-dice";
const DICE_JACKPOT_CHANCE = 0.001; // 0.1% / 每次「中獎的輪」，抽中即唯一

// 對齊「整 60 秒」邊界，PM2 重啟也能對齊節奏
function alignedNextStartAt(now = Date.now()) {
  return Math.ceil(now / ROUND_DURATION_MS) * ROUND_DURATION_MS;
}

class CasinoService {
  constructor({
    casinoRepository,
    itemRepository,
    walletRepository,
    progressRepository,
    rewardService,
    playerService,
    getBotClient,
    channelLayoutRepository,
  }) {
    this.casinoRepository = casinoRepository;
    this.itemRepository = itemRepository;
    this.walletRepository = walletRepository;
    this.progressRepository = progressRepository;
    this.rewardService = rewardService;
    this.playerService = playerService;
    this.getBotClient = getBotClient;
    this.channelLayoutRepository = channelLayoutRepository;

    this._tickTimer = null;
    this._listeners = new Set();    // 面板更新訂閱者
  }

  // ─── 訂閱 ───────────────────────────────────────────────────────────────
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify(event, payload) {
    for (const fn of this._listeners) {
      try { fn(event, payload); } catch (err) { console.warn("[casino] listener error:", err?.message); }
    }
  }

  // ─── 啟動與排程 ─────────────────────────────────────────────────────────
  async start() {
    await this._ensureCurrentRound();
    if (!this._tickTimer) {
      this._tickTimer = setInterval(() => this._tick().catch((err) => {
        console.warn("[casino] tick failed:", err?.message);
      }), 1000);
    }
  }

  stop() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
  }

  async _ensureCurrentRound() {
    const state = await this.casinoRepository.getState();
    const now = Date.now();
    if (state?.currentRound && state.currentRound.status !== "settled") {
      // PM2 重啟恢復：若已過 endAt 則先結算
      if (now >= state.currentRound.endAt) {
        await this._settleRound(state.currentRound.roundId).catch((err) => {
          console.warn("[casino] recover-settle failed:", err?.message);
        });
        await this._openNextRound();
      }
      return;
    }
    await this._openNextRound();
  }

  async _openNextRound() {
    const state = await this.casinoRepository.getState();
    const lastId = Number(state?.lastRoundId || 0);
    const startedAt = alignedNextStartAt(Date.now());
    const endAt = startedAt + ROUND_DURATION_MS;
    const lockedAt = endAt - LOCK_BEFORE_END_MS;
    const round = {
      roundId: lastId + 1,
      startedAt,
      lockedAt,
      endAt,
      status: "open",
      totals: { yellow: 0, green: 0, red: 0, blue: 0, purple: 0 },
      betCount: 0,
      bettors: 0,
    };
    await this.casinoRepository.saveState({
      ...(state || {}),
      currentRound: round,
      lastRoundId: round.roundId,
      updatedAt: new Date().toISOString(),
    });
    this._notify("round:open", { round });
  }

  async _tick() {
    const state = await this.casinoRepository.getState();
    const cur = state?.currentRound;
    if (!cur) return;
    const now = Date.now();

    if (cur.status === "open" && now >= cur.lockedAt) {
      // CAS 鎖盤
      const locked = await this.casinoRepository.transitionStatus(cur.roundId, "open", "locked");
      if (locked) this._notify("round:lock", { roundId: cur.roundId });
      return;
    }
    if ((cur.status === "open" || cur.status === "locked") && now >= cur.endAt) {
      const settling = await this.casinoRepository.transitionStatus(cur.roundId, cur.status, "settling");
      if (!settling) return;
      try {
        await this._settleRound(cur.roundId);
      } finally {
        await this._openNextRound();
      }
    }
  }

  // ─── 玩家動作 ──────────────────────────────────────────────────────────
  async getCurrentRound() {
    const state = await this.casinoRepository.getState();
    return state?.currentRound || null;
  }

  async getRecentRounds(limit = 10) {
    return this.casinoRepository.listRecentRounds(limit);
  }

  async getPlayerBetsInRound(roundId, discordId) {
    return this.casinoRepository.listBetsByRoundAndPlayer(roundId, discordId);
  }

  async placeBet({ discordId, displayName, color, amount }) {
    if (!COLORS.includes(color)) throw new Error("無效的下注顏色");
    const intAmount = Math.floor(Number(amount));
    if (!Number.isFinite(intAmount) || intAmount < BET_MIN) throw new Error(`下注金額需 ≥ ${BET_MIN}`);
    if (intAmount > BET_MAX) throw new Error(`下注金額需 ≤ ${BET_MAX}`);

    const round = await this.getCurrentRound();
    if (!round || round.status !== "open") throw new Error("本輪已鎖盤，請等下一輪");
    if (Date.now() >= round.lockedAt) throw new Error("本輪已鎖盤，請等下一輪");

    // 下好離手：每人每輪限下一注，且不可更改或加注
    const existingBets = await this.getPlayerBetsInRound(round.roundId, discordId);
    if (Array.isArray(existingBets) && existingBets.length > 0) {
      throw new Error("本輪你已經下注囉！下好離手、不能更改或加注，請等下一輪。");
    }

    // 扣金幣（rewardService 已含 wallet 存量驗證）
    await this.rewardService.grantCurrency({
      discordId,
      displayName,
      currencyType: "gold",
      amount: -intAmount,
      source: CURRENCY_SOURCES.CASINO_BET,
      // 帶 discordId 確保每人每輪唯一，避免去重把不同玩家的扣款誤判為重複
      sourceRef: `round:${round.roundId}:${color}:${discordId}`,
    });

    // 寫下注紀錄、更新本輪統計
    const betId = await this.casinoRepository.appendBet({
      roundId: round.roundId,
      discordId,
      displayName: displayName || discordId,
      color,
      amount: intAmount,
      placedAt: Date.now(),
    });
    await this.casinoRepository.incrementRoundTotals(round.roundId, color, intAmount);

    this._notify("bet:placed", { roundId: round.roundId, discordId, color, amount: intAmount });
    return { betId, roundId: round.roundId, color, amount: intAmount };
  }

  // ─── 結算 ─────────────────────────────────────────────────────────────
  async _settleRound(roundId) {
    const slotIdx = crypto.randomInt(0, WHEEL_SLOTS.length);
    const slot = WHEEL_SLOTS[slotIdx];
    const resultColor = slot.color;
    const resultMult = slot.mult;
    const settledAt = Date.now();

    const bets = await this.casinoRepository.listBetsByRound(roundId);
    let totalBet = 0, totalPayout = 0;
    const playerSummaries = new Map(); // discordId → {bets, totalBet, totalPay, hits, drops}

    for (const bet of bets) {
      totalBet += bet.amount;
      const ps = playerSummaries.get(bet.discordId) || {
        discordId: bet.discordId,
        displayName: bet.displayName,
        bets: [],
        totalBet: 0,
        totalPay: 0,
        hits: [],
        drops: [],
      };
      ps.totalBet += bet.amount;
      ps.bets.push(bet);

      let payout = 0;
      let drop = null;
      if (bet.color === resultColor) {
        payout = Math.min(bet.amount * resultMult, PAYOUT_CAP);
        ps.totalPay += payout;
        ps.hits.push({ color: bet.color, mult: resultMult, payout });
        // 抽掉落
        drop = this._rollDrop(bet.amount);
        if (drop) ps.drops.push({ ...drop, betAmount: bet.amount });
      }
      totalPayout += payout;

      await this.casinoRepository.updateBetOutcome(bet._id || bet.id, {
        outcome: payout > 0 ? "win" : "lose",
        payout,
        dropKey: drop?.key || null,
      });

      playerSummaries.set(bet.discordId, ps);
    }

    // 結算入帳 + DM
    const playerArr = [...playerSummaries.values()];
    for (const ps of playerArr) {
      // 中獎金幣入帳
      if (ps.totalPay > 0) {
        await this.rewardService.grantCurrency({
          discordId: ps.discordId,
          displayName: ps.displayName,
          currencyType: "gold",
          amount: ps.totalPay,
          source: CURRENCY_SOURCES.CASINO_PAYOUT,
          // 帶 discordId 確保每人每輪唯一，避免去重把多名中獎者只發給第一位
          sourceRef: `round:${roundId}:${ps.discordId}`,
        }).catch((err) => {
          console.warn(`[casino] payout failed for ${ps.discordId}:`, err?.message);
        });
      }
      // 道具入帳
      const grantedItems = [];
      for (const d of ps.drops) {
        const grantedName = await this._grantDropToPlayer(ps.discordId, d).catch((err) => {
          console.warn(`[casino] grant drop failed:`, err?.message);
          return null;
        });
        if (grantedName) grantedItems.push({ ...d, itemName: grantedName });
      }
      // 命運之輪唯一大獎：有中獎就擲極低機率
      if (ps.hits.length > 0) {
        const jackpot = await this._tryGrantDiceJackpot(ps.discordId).catch(() => null);
        if (jackpot) {
          grantedItems.push(jackpot);
          this._broadcast({ roundId, resultColor, resultMult, ps, drop: { key: "s-legend-dice", label: jackpot.label, itemName: jackpot.itemName } }).catch(() => {});
        }
      }
      ps.grantedItems = grantedItems;

      // 寄 DM（不論輸贏）
      this._dmPlayer(ps, { roundId, resultColor, resultMult }).catch(() => {});

      // 網頁通知（SSE + 輪詢佇列；不論輸贏，含掉落明細）
      try {
        const colorLabel = COLOR_META[resultColor]?.label || resultColor;
        const dropText = grantedItems.length
          ? `，額外掉落：${grantedItems.map((d) => d.itemName).join("、")}`
          : "";
        notifyPlayer(ps.discordId, {
          type: "casino_round",
          title: `命運轉盤 #${roundId} 開獎`,
          message: ps.totalPay > 0
            ? `開出 ${colorLabel} ×${resultMult}！你押 ${ps.totalBet} 金幣，拿回 ${ps.totalPay} 金幣${dropText}。`
            : `開出 ${colorLabel} ×${resultMult}，你押 ${ps.totalBet} 金幣，這輪未中獎${dropText}。`,
          meta: {
            roundId,
            resultColor,
            resultMult,
            totalBet: ps.totalBet,
            payout: ps.totalPay,
            win: ps.totalPay > 0,
            drops: grantedItems.map((d) => ({ itemName: d.itemName, label: d.label || null }))
          }
        });
      } catch (_) { /* 通知失敗不影響結算 */ }

      // 大獎全頻道公告
      for (const d of grantedItems) {
        if (isBroadcastWorthy({ color: resultColor, dropKey: d.key })) {
          this._broadcast({
            roundId, resultColor, resultMult,
            ps, drop: d,
          }).catch(() => {});
        }
      }
      // 紫色本身就廣播（即使沒抽到道具）
      if (resultColor === "purple" && ps.hits.length && !grantedItems.some((d) => isBroadcastWorthy({ dropKey: d.key }))) {
        this._broadcast({ roundId, resultColor, resultMult, ps, drop: null }).catch(() => {});
      }
    }

    // 寫入輪歷史
    await this.casinoRepository.appendRound({
      roundId,
      slotIdx,
      resultColor,
      resultMult,
      settledAt,
      totalBet,
      totalPayout,
      houseProfit: totalBet - totalPayout,
      betCount: bets.length,
      bettorCount: playerArr.length,
    });
    // 更新 state.recentResults
    await this.casinoRepository.pushRecentResult({
      roundId, color: resultColor, mult: resultMult, at: settledAt,
    });
    await this.casinoRepository.transitionStatus(roundId, "settling", "settled");

    this._notify("round:settled", {
      roundId, resultColor, resultMult, totalBet, totalPayout,
      bettorCount: playerArr.length,
      winners: playerArr.filter((p) => p.totalPay > 0).map((p) => ({
        discordId: p.discordId, displayName: p.displayName, payout: p.totalPay, drops: p.grantedItems,
      })),
    });
  }

  _rollDrop(betAmount) {
    const { rate, tier } = getBetTier(betAmount);
    if (tier < 0) return null;
    if (Math.random() >= rate) return null;
    const eligible = DROP_POOL.filter((p) => p.minBetTier <= tier);
    const total = eligible.reduce((a, b) => a + b.weight, 0);
    let r = crypto.randomInt(0, total);
    for (const p of eligible) { r -= p.weight; if (r < 0) return p; }
    return eligible[eligible.length - 1];
  }

  async _grantDropToPlayer(discordId, drop) {
    // 找出符合條件的物品池
    const all = await this.itemRepository.listAll
      ? await this.itemRepository.listAll()
      : (await this.itemRepository.findAll?.()) || [];

    let candidates = [];
    if (drop.kind === "stone") {
      candidates = all.filter((it) => it.itemType === "consumable" && it.tier === drop.tier && /寶石|強化石/.test(it.name || ""));
    } else if (drop.kind === "equipment") {
      candidates = all.filter((it) => it.itemType === "equipment" && it.tier === drop.tier
        && it.equipSlot && !/^special_/.test(it.equipSlot) && it.equipSlot !== "job_eq");
    } else if (drop.kind === "card") {
      candidates = all.filter((it) => it.tier === drop.tier
        && it.equipSlot && /^special_/.test(it.equipSlot)
        && !/boss|Boss|BOSS/.test(String(it.cardCategory || ""))
        && !/王$|魔王/.test(it.name || ""));
    }
    if (!candidates.length) {
      console.warn(`[casino] no candidates for drop ${drop.key}`);
      return null;
    }
    const item = candidates[crypto.randomInt(0, candidates.length)];

    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) { console.warn(`[casino] no progress for ${discordId}`); return null; }
    if (!Array.isArray(progress.inventory)) progress.inventory = [];

    progress.inventory.push({
      uuid: crypto.randomUUID(),
      itemId: item.id,
      itemName: item.name,
      itemEffect: item.effect || { type: "none", value: 0 },
      useEffects: item.useEffects || [],
      passiveEffects: item.passiveEffects || [],
      procEffects: item.procEffects || [],
      combatEffects: item.combatEffects || [],
      itemType: item.itemType || "consumable",
      imageUrl: item.imageUrl || null,
      imageThumbnailUrl: item.imageThumbnailUrl || null,
      equipSlot: item.equipSlot || null,
      equipStats: item.equipStats || null,
      weaponType: item.weaponType || null,
      isTwoHanded: item.isTwoHanded || false,
      tier: item.tier || null,
      // 帶上怪物卡技能欄位，否則賭盤掉到的卡片會被歸到「特殊」而非「卡片」分類
      monsterCardSkill: item.monsterCardSkill || null,
      source: "casino_wheel",
      obtainedAt: new Date().toISOString(),
    });
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return item.name;
  }

  /**
   * 命運之輪唯一大獎：任何中獎都有極低機率抽中；抽中且從未擁有過 → 發放（一生一次）。
   * @returns {Promise<{itemName:string,label:string,jackpot:true}|null>}
   */
  async _tryGrantDiceJackpot(discordId) {
    if (Math.random() >= DICE_JACKPOT_CHANCE) return null;
    // 原子搶佔：已領過 → claim 回 false → 不發（機率照樣消耗，符合「獲得過不能再獲得」）
    const first = await uniqueGrant.claim(discordId, DICE_JACKPOT_ITEM_ID, "casino_jackpot").catch(() => false);
    if (!first) return null;
    try {
      const item = await this.itemRepository.findById(DICE_JACKPOT_ITEM_ID);
      if (!item) { await uniqueGrant.release(discordId, DICE_JACKPOT_ITEM_ID); return null; }
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) { await uniqueGrant.release(discordId, DICE_JACKPOT_ITEM_ID); return null; }
      if (!Array.isArray(progress.inventory)) progress.inventory = [];
      progress.inventory.push({
        uuid: crypto.randomUUID(),
        itemId: item.id, itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        useEffects: item.useEffects || [], passiveEffects: item.passiveEffects || [],
        procEffects: item.procEffects || [], combatEffects: item.combatEffects || [],
        itemType: item.itemType || "equipment",
        imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || "anchor", equipStats: item.equipStats || null,
        weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
        tier: item.tier || "S",
        source: "casino_jackpot", obtainedAt: new Date().toISOString(),
      });
      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);
      console.log(`[casino] 🎉 命運之輪唯一大獎發放給 ${discordId}`);
      const who = progress.displayName || (await this.playerService?.getDisplayName?.(discordId).catch(() => null)) || "某位勇者";
      require("../../shared/announceTownChat").announceTownChat(
        `🎰🎉 **${who}** 在命運轉盤抽中了傳說錨點【**${item.name}**】！全服唯一，命運眷顧之人！`
      ).catch(() => {});
      return { itemName: item.name, label: "傳說錨點·唯一", jackpot: true };
    } catch (e) {
      await uniqueGrant.release(discordId, DICE_JACKPOT_ITEM_ID).catch(() => {});
      console.warn("[casino] dice jackpot 發放失敗，已撤回搶佔:", e?.message || e);
      return null;
    }
  }

  // ─── 通知 ─────────────────────────────────────────────────────────────
  async _dmPlayer(ps, { roundId, resultColor, resultMult }) {
    const client = this.getBotClient?.();
    if (!client?.isReady?.()) return;
    const user = await client.users.fetch(ps.discordId).catch(() => null);
    if (!user) return;

    const meta = COLOR_META[resultColor];
    const lines = [];
    lines.push(`🎰 **命運轉盤 第 #${roundId} 輪結算**`);
    lines.push(`開出 ${meta.emoji} ${meta.label} ×${resultMult}`);
    lines.push("");
    lines.push(`你的下注：${ps.bets.map((b) => `${COLOR_META[b.color].emoji}${b.amount}`).join("、")}（共 ${ps.totalBet} 金幣）`);
    if (ps.totalPay > 0) {
      lines.push(`✅ 中獎金幣：**+${ps.totalPay}**`);
    } else {
      lines.push(`❌ 未中獎`);
    }
    if (ps.grantedItems?.length) {
      lines.push("");
      lines.push(`🎁 額外掉落：`);
      for (const d of ps.grantedItems) lines.push(`・**${d.itemName}**（${d.label}）`);
    }
    await user.send(lines.join("\n")).catch(() => {});
  }

  async _broadcast({ roundId, resultColor, resultMult, ps, drop }) {
    const client = this.getBotClient?.();
    if (!client?.isReady?.()) return;
    if (!this.channelLayoutRepository) return;
    const layout = await this.channelLayoutRepository.get?.().catch(() => null);
    const bindings = layout?.discord?.bindings || [];
    const target = bindings.find((b) => b.featureKey === "broadcast" && b.enabled && b.channelId);
    if (!target) return;
    const channel = await client.channels.fetch(target.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const meta = COLOR_META[resultColor];
    const dropLine = drop ? `\n獲得 ✨ **${drop.itemName || drop.label}**！` : "";
    const payLine = ps.totalPay > 0 ? ` → 拿回 **${ps.totalPay}** 金幣` : "";
    await channel.send(
      `🎰 **命運轉盤 第 #${roundId} 輪**\n`
      + `${meta.emoji} ${meta.label} ×${resultMult} 開出！\n`
      + `**${ps.displayName}** 押 ${ps.totalBet} 金幣${payLine}${dropLine}`,
    ).catch(() => {});
  }
}

module.exports = { CasinoService };
