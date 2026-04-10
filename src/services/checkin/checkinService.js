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

  async handleMessage({ discordId, displayName, channelId, messageId, content, occurredAt }) {
    if (!discordId) {
      throw new Error("discordId required");
    }

    const now = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString();

    const last = await this.checkinRepository.findLastByDiscordId(discordId);
    if (last && (await this.isSameDay(last.occurredAt, now))) {
      return { ok: false, reason: "already_checked_in", last };
    }

    // grant 100 gold by default, check for checkin multiplier item
    let grantAmount = 100;
    let appliedMultiplier = 1;
    if (this.progressRepository) {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      const multiplier = progress?.flags?.checkinMultiplier;
      if (multiplier && multiplier > 1) {
        grantAmount = Math.round(grantAmount * multiplier);
        appliedMultiplier = multiplier;
        progress.flags.checkinMultiplier = null;
        progress.updatedAt = new Date().toISOString();
        await this.progressRepository.save(progress);
      }
    }
    const rewardResult = await this.rewardService.grantCurrency({
      discordId,
      displayName,
      currencyType: "gold",
      amount: grantAmount,
      source: CURRENCY_SOURCES.DISCORD_TEST_REWARD,
      operator: "system:checkin"
    });

    const checkin = {
      id: `${discordId}:${Date.now()}`,
      playerId: discordId,
      discordId,
      channelId: channelId || "stream",
      messageId: messageId || "",
      content: content || "",
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

    await this.checkinRepository.save(checkin);

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
