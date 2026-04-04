const { TIER_RANKS } = require("../../adapters/json/playerTierRepository");

class PlayerTierService {
  constructor(playerTierRepository) {
    this.playerTierRepository = playerTierRepository;
  }

  /** 取得所有等級設定（E~SS） */
  async getTiers() {
    return this.playerTierRepository.getAll();
  }

  /** 更新某一等級的設定（label + roleIds） */
  async updateTier(rank, { label, roleIds } = {}) {
    const tiers = await this.playerTierRepository.getAll();
    if (!TIER_RANKS.includes(rank)) throw new Error(`無效等級名稱: ${rank}`);
    if (label !== undefined) tiers[rank].label = label;
    if (roleIds !== undefined) tiers[rank].roleIds = Array.isArray(roleIds) ? roleIds.map(String).filter(Boolean) : [];
    return this.playerTierRepository.save(tiers);
  }

  /** 儲存全部等級設定 */
  async saveTiers(tiersPayload) {
    return this.playerTierRepository.save(tiersPayload);
  }

  /**
   * 將 allowedTiers 陣列（如 ["S","SS"]）解析成對應的 roleId 陣列。
   * @param {string[]} allowedTiers
   * @returns {Promise<string[]>} 所有對應的 Discord roleId（展平、去重）
   */
  async resolveRoleIds(allowedTiers) {
    if (!Array.isArray(allowedTiers) || allowedTiers.length === 0) return [];
    const tiers = await this.playerTierRepository.getAll();
    const ids = new Set();
    for (const rank of allowedTiers) {
      const tier = tiers[rank];
      if (tier && Array.isArray(tier.roleIds)) {
        for (const id of tier.roleIds) ids.add(id);
      }
    }
    return [...ids];
  }
  /**
   * 從玩家擁有的 roleId 清單，解析出最高等級（SS > S > A > B > C > D > E）。
   * @param {string[]} memberRoleIds
   * @returns {Promise<string|null>} 最高等級 rank（如 "SS"），若無對應等級則回傳 null
   */
  async resolveHighestTier(memberRoleIds) {
    if (!Array.isArray(memberRoleIds) || memberRoleIds.length === 0) return null;
    const tiers = await this.playerTierRepository.getAll();
    // 從高到低依序比對
    for (const rank of [...TIER_RANKS].reverse()) {
      const tier = tiers[rank];
      if (tier && Array.isArray(tier.roleIds) && tier.roleIds.some((id) => memberRoleIds.includes(id))) {
        return rank;
      }
    }
    return null;
  }
}

module.exports = { PlayerTierService, TIER_RANKS };
