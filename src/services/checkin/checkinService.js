const { withPlayerProgressLock } = require("../progress/progressLocks");
const { activeEquipment } = require("../../shared/anchorFeature");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { CURRENCY_SOURCES } = require("../../shared/sources");

class CheckinService {
  constructor(playerService, checkinRepository, rewardService, progressRepository) {
    this.playerService = playerService;
    this.checkinRepository = checkinRepository;
    this.rewardService = rewardService;
    this.progressRepository = progressRepository;
  }

  async isSameDay(a, b) {
    if (!a || !b) return false;
    // 以台灣時間（UTC+8）判定「同一天」
    const toTWDate = (iso) => {
      const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10); // YYYY-MM-DD in UTC+8
    };
    return toTWDate(a) === toTWDate(b);
  }

  async handleMessage(input) {
    const account = `${String(input.platform || "").toLowerCase()}:${String(input.platformUserId || "").trim()}`;
    return withPlayerProgressLock(`checkin-account:${account || input.discordId}`, () => withPlayerProgressLock(input.discordId, () => this._handleMessage(input)));
  }

  async _handleMessage({ discordId, displayName, channelId, messageId, content, occurredAt, platform = "", platformUserId = "" }) {
    if (!discordId) {
      throw new Error("discordId required");
    }

    const now = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString();
    const normalizedPlatform = String(platform || "").toLowerCase();
    const normalizedPlatformUserId = String(platformUserId || "").trim();

    // 同一個平台帳號只能領一次當日打卡獎勵，避免換 Discord 重複領取
    if (normalizedPlatform && normalizedPlatformUserId && this.checkinRepository?.findLastByPlatformUserId) {
      const lastByAccount = await this.checkinRepository.findLastByPlatformUserId(normalizedPlatform, normalizedPlatformUserId);
      if (lastByAccount && (await this.isSameDay(lastByAccount.occurredAt, now))) {
        return { ok: false, reason: "already_checked_in_platform", last: lastByAccount };
      }
    }

    const last = await this.checkinRepository.findLastByDiscordId(discordId);
    if (last && (await this.isSameDay(last.occurredAt, now))) {
      return { ok: false, reason: "already_checked_in", last };
    }

    // grant 100 gold by default, check for checkin multiplier item
    let grantAmount = 100;
    let appliedMultiplier = 1;
    const day = new Date(Date.parse(now) + 8 * 3600_000).toISOString().slice(0, 10);
    let pending;
    // 平台帳號先綁定當日領獎者；金幣已入帳但簽到紀錄尚未寫成時也不能換帳號領。
    if (normalizedPlatform && normalizedPlatformUserId) {
      const db = await getMongoDb(), key = `checkin:${day}:${normalizedPlatform}:${normalizedPlatformUserId}`;
      await db.collection("checkinReservations").updateOne({ _id: key }, { $setOnInsert: { discordId, createdAt: now } }, { upsert: true });
      const owner = await db.collection("checkinReservations").findOne({ _id: key });
      if (owner.discordId !== discordId) return { ok: false, reason: "already_checked_in_platform" };
    }
    if (this.progressRepository) {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      pending = progress?.flags?.checkinPending;
      const multiplier = progress?.flags?.checkinMultiplier;
      if (multiplier && multiplier > 1) {
        grantAmount = Math.round(grantAmount * multiplier);
        appliedMultiplier = multiplier;

      }
      // checkin_bonus_up：裝備/Buff 提供的打卡加成
      try {
        const equippedAll = activeEquipment(progress?.equipment);
        const allEffectRefs = [];
        for (const entry of Object.values(equippedAll)) {
          if (!entry || typeof entry !== "object") continue;
          if (Array.isArray(entry.passiveEffects)) allEffectRefs.push(...entry.passiveEffects);
          if (Array.isArray(entry.combatEffects)) allEffectRefs.push(...entry.combatEffects);
        }
        if (Array.isArray(progress?.activeEffects)) allEffectRefs.push(...progress.activeEffects);
        let bonusPct = 0;
        for (const eff of allEffectRefs) {
          if (eff?.key === 'checkin_bonus_up') {
            const v = Number(eff.params?.value ?? eff.value ?? 0);
            if (Number.isFinite(v)) bonusPct += Math.abs(v);
          }
        }
        if (bonusPct > 0) {
          grantAmount = Math.round(grantAmount * (1 + bonusPct / 100));
        }
      } catch (e) {}
    }
    // 領獎內容先留下收據，扣掉倍率後中斷也可用相同金額重試。
    const sourceRef = `checkin:${day}:${normalizedPlatform && normalizedPlatformUserId ? normalizedPlatform + ":" + normalizedPlatformUserId : discordId}`;
    if (pending?.sourceRef === sourceRef) { grantAmount = pending.amount; appliedMultiplier = pending.multiplier; }
    else if (this.progressRepository) {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (progress) {
        progress.flags ||= {};
        progress.flags.checkinPending = { sourceRef, amount: grantAmount, multiplier: appliedMultiplier };
        if (appliedMultiplier > 1) progress.flags.checkinMultiplier = null;
        await this.progressRepository.updateFields(discordId, { flags: progress.flags });
      }
    }
    const rewardResult = await this.rewardService.grantCurrency({
      discordId,
      displayName,
      currencyType: "gold",
      amount: grantAmount,
      source: CURRENCY_SOURCES.DISCORD_TEST_REWARD,
      sourceRef,
      operator: "system:checkin"
    });

    const checkin = {
      id: sourceRef,
      playerId: discordId,
      discordId,
      channelId: channelId || "stream",
      messageId: messageId || "",
      content: content || "",
      platform: normalizedPlatform || "",
      platformUserId: normalizedPlatformUserId || "",
      occurredAt: now,
      rewardGranted: true,
      rewardDetail: {
        currencyType: "gold",
        amount: grantAmount,
        multiplier: appliedMultiplier,
        txId: rewardResult.transaction && rewardResult.transaction.id ? rewardResult.transaction.id : ""
      },
      createdAt: new Date().toISOString()
    };

    if (this.progressRepository) {
      const p = await this.progressRepository.findByPlayerId(discordId);
      if (p && require("../../shared/autumnTitleRules").recordEvent(p, { type: "checkin", at: now }))
        await this.progressRepository.updateFields(discordId, { autumnTitleProgress: p.autumnTitleProgress });
    }
    await this.checkinRepository.save(checkin);
    if (this.progressRepository) {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (progress?.flags?.checkinPending?.sourceRef === sourceRef) {
        progress.flags.checkinPending = null;
        await this.progressRepository.updateFields(discordId, { flags: progress.flags });
      }
    }

    return { ok: true, checkin, transaction: rewardResult.transaction };
  }

  async listRecentByDiscordId(discordId, limit = 20) {
    const items = await this.checkinRepository.listByDiscordId(discordId);
    items.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    return items.slice(0, limit);
  }
}

module.exports = {
  CheckinService
};
