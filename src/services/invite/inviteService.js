"use strict";
const { randomUUID } = require("crypto");

// 邀請獎勵道具 itemId
const REWARD_ITEMS = [
  { itemId: "72fde92d-e33f-42fb-8d86-2e811d03f84d", itemName: "D階寶石", quantity: 20 },
  { itemId: "556db9e1-b084-4b22-bab5-a66c2b586184", itemName: "C階寶石", quantity: 5 },
];
const REWARD_GOLD = 50000;

// 新玩家判斷：帳號建立時間距使用邀請碼不超過 24 小時
const NEW_PLAYER_WINDOW_MS = 24 * 60 * 60 * 1000;

function generateCode() {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

class InviteService {
  constructor({ inviteCodeRepository, playerRepository, progressRepository, walletRepository, itemRepository, transactionRepository }) {
    this.inviteCodeRepository = inviteCodeRepository;
    this.playerRepository = playerRepository;
    this.progressRepository = progressRepository;
    this.walletRepository = walletRepository;
    this.itemRepository = itemRepository;
    this.transactionRepository = transactionRepository;
  }

  async getOrCreateCode(inviterId) {
    let doc = await this.inviteCodeRepository.findByInviterId(inviterId);
    if (!doc) {
      let code;
      // 碰撞機率極低，但確保唯一
      for (let i = 0; i < 5; i++) {
        code = generateCode();
        const existing = await this.inviteCodeRepository.findByCode(code);
        if (!existing) break;
      }
      doc = {
        inviterId,
        code,
        createdAt: new Date().toISOString(),
        uses: []
      };
      await this.inviteCodeRepository.save(doc);
    }
    return doc;
  }

  async useCode(code, newPlayerId) {
    const now = new Date();
    const doc = await this.inviteCodeRepository.findByCode(code);
    if (!doc) return { ok: false, reason: "找不到邀請碼，請確認是否輸入正確。" };

    // 不能用自己的碼
    if (doc.inviterId === newPlayerId) return { ok: false, reason: "不能使用自己的邀請碼。" };

    // 已經用過
    const alreadyUsed = (doc.uses || []).some(u => u.usedBy === newPlayerId);
    if (alreadyUsed) return { ok: false, reason: "你已經使用過邀請碼了。" };

    // 判斷是否為新玩家
    const player = await this.playerRepository.findByDiscordId(newPlayerId);
    if (!player) return { ok: false, reason: "找不到你的玩家資料。" };

    const createdAt = new Date(player.createdAt);
    const diffMs = now - createdAt;
    if (diffMs > NEW_PLAYER_WINDOW_MS) {
      return { ok: false, reason: "邀請碼只能由 24 小時內新加入的玩家使用。" };
    }

    // 記錄使用
    doc.uses = doc.uses || [];
    doc.uses.push({ usedBy: newPlayerId, usedAt: now.toISOString() });
    await this.inviteCodeRepository.save(doc);

    // 發獎勵給新玩家和邀請人
    await this._grantRewards(newPlayerId, "invite_new_player");
    await this._grantRewards(doc.inviterId, "invite_referral");

    const inviter = await this.playerRepository.findByDiscordId(doc.inviterId);
    return {
      ok: true,
      inviterName: inviter?.displayName || inviter?.name || doc.inviterId
    };
  }

  async _grantRewards(playerId, source) {
    const now = new Date().toISOString();

    // 金幣
    const wallet = await this.walletRepository.findByPlayerId(playerId);
    if (wallet) {
      wallet.gold = (wallet.gold || 0) + REWARD_GOLD;
      wallet.updatedAt = now;
      await this.walletRepository.save(wallet);
    }

    // 道具
    const progress = await this.progressRepository.findByPlayerId(playerId);
    if (!progress) return;
    if (!Array.isArray(progress.inventory)) progress.inventory = [];

    for (const reward of REWARD_ITEMS) {
      const libItem = await this.itemRepository.findById(reward.itemId).catch(() => null);
      if (!libItem) continue;

      // 可堆疊消耗品：找已有的疊加，或新增
      const existing = progress.inventory.find(i => i.itemId === reward.itemId);
      if (existing) {
        existing.quantity = (existing.quantity || 1) + reward.quantity;
      } else {
        progress.inventory.push({
          uuid: randomUUID(),
          itemId: libItem.id,
          itemName: libItem.name,
          itemType: libItem.itemType,
          quantity: reward.quantity,
          useEffects: libItem.useEffects || [],
          passiveEffects: libItem.passiveEffects || [],
          procEffects: libItem.procEffects || [],
          combatEffects: libItem.combatEffects || [],
          imageUrl: libItem.imageUrl || null,
          imageThumbnailUrl: libItem.imageThumbnailUrl || null,
          tier: libItem.tier || null,
          grantedAt: now,
          grantedBy: source
        });
      }
    }

    progress.updatedAt = now;
    await this.progressRepository.save(progress);
  }
}

module.exports = { InviteService, REWARD_ITEMS, REWARD_GOLD };
