const { readStore, writeStore } = require("./jsonStore");

const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];

const DEFAULT_TIERS = Object.fromEntries(
  TIER_RANKS.map((rank) => [rank, { label: `${rank}級`, roleIds: [] }])
);

class JsonPlayerTierRepository {
  async getAll() {
    const data = await readStore();
    const stored = data.playerTiers || {};
    // Ensure all ranks exist
    const result = {};
    for (const rank of TIER_RANKS) {
      result[rank] = stored[rank] || { label: `${rank}級`, roleIds: [] };
      if (!Array.isArray(result[rank].roleIds)) result[rank].roleIds = [];
    }
    return result;
  }

  async save(tiers) {
    const data = await readStore();
    // Only store known ranks
    const normalized = {};
    for (const rank of TIER_RANKS) {
      const t = tiers[rank] || {};
      normalized[rank] = {
        label: typeof t.label === "string" && t.label.trim() ? t.label.trim() : `${rank}級`,
        roleIds: Array.isArray(t.roleIds) ? t.roleIds.map(String).filter(Boolean) : []
      };
    }
    data.playerTiers = normalized;
    await writeStore(data);
    return normalized;
  }
}

module.exports = { JsonPlayerTierRepository, TIER_RANKS, DEFAULT_TIERS };
