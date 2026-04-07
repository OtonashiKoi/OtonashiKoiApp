const { AppError, ERROR_CODES } = require("../../shared/errors");

function calcStats({ str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1 }) {
  return {
    maxHp: vit * 15 + 50,
    atk: str * 3,
    def: 0,
    dodge: Math.min(50, Math.round(agi * 0.5 * 10) / 10),
    hit: Math.min(100, 80 + dex)
  };
}

class MonsterService {
  constructor(monsterRepository, itemRepository) {
    this.monsterRepository = monsterRepository;
    this.itemRepository = itemRepository;
  }

  async listMonsters({ includeDisabled = false } = {}) {
    const monsters = await this.monsterRepository.findAll();
    const list = includeDisabled ? monsters : monsters.filter((m) => m.enabled);
    return list.map((m) => ({ ...m, calc: calcStats(m) }));
  }

  async getMonsterById(id) {
    const m = await this.monsterRepository.findById(id);
    if (!m) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `\u600e\u7269\u4e0d\u5b58\u5728: ${id}`, 404);
    return { ...m, calc: calcStats(m) };
  }

  async createMonster(fields) {
    const drops = await this._resolveDrops(fields.drops || []);
    const monster = {
      id: crypto.randomUUID(),
      seq: Math.max(1, Number(fields.seq) || 1),
      name: String(fields.name || "").trim() || "\u672a\u547d\u540d\u600e\u7269",
      imageUrl: fields.imageUrl || null,
      imageThumbnailUrl: fields.imageThumbnailUrl || null,
      str: Math.max(0, Number(fields.str) || 0),
      agi: Math.max(0, Number(fields.agi) || 0),
      vit: Math.max(0, Number(fields.vit) || 0),
      int: Math.max(0, Number(fields.int) || 0),
      dex: Math.max(0, Number(fields.dex) || 0),
      luk: Math.max(0, Number(fields.luk) || 0),
      level: Math.max(1, Number(fields.level) || 1),
      entryFee: Math.max(0, Number(fields.entryFee) || 0),
      expReward: Math.max(0, Number(fields.expReward) || 0),
      goldReward: Math.max(0, Number(fields.goldReward) || 0),
      drops,
      enabled: Boolean(fields.enabled),
      createdAt: new Date().toISOString()
    };
    return { ...await this.monsterRepository.save(monster), calc: calcStats(monster) };
  }

  async updateMonster(id, fields) {
    const monster = await this.monsterRepository.findById(id);
    if (!monster) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `\u600e\u7269\u4e0d\u5b58\u5728: ${id}`, 404);
    const updated = { ...monster };
    if (fields.seq !== undefined) updated.seq = Math.max(1, Number(fields.seq) || 1);
    if (fields.name !== undefined) updated.name = String(fields.name).trim() || monster.name;
    if (fields.imageUrl !== undefined) updated.imageUrl = fields.imageUrl;
    if (fields.imageThumbnailUrl !== undefined) updated.imageThumbnailUrl = fields.imageThumbnailUrl;
    for (const stat of ["str", "agi", "vit", "int", "dex", "luk"]) {
      if (fields[stat] !== undefined) updated[stat] = Math.max(0, Number(fields[stat]) || 0);
    }
    if (fields.level !== undefined) updated.level = Math.max(1, Number(fields.level) || 1);
    if (fields.entryFee !== undefined) updated.entryFee = Math.max(0, Number(fields.entryFee) || 0);
    if (fields.expReward !== undefined) updated.expReward = Math.max(0, Number(fields.expReward) || 0);
    if (fields.goldReward !== undefined) updated.goldReward = Math.max(0, Number(fields.goldReward) || 0);
    if (fields.drops !== undefined) updated.drops = await this._resolveDrops(fields.drops);
    if (fields.enabled !== undefined) updated.enabled = Boolean(fields.enabled);
    const saved = await this.monsterRepository.save(updated);
    return { ...saved, calc: calcStats(saved) };
  }

  async deleteMonster(id) {
    const monster = await this.monsterRepository.findById(id);
    if (!monster) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `\u600e\u7269\u4e0d\u5b58\u5728: ${id}`, 404);
    await this.monsterRepository.delete(id);
  }

  async getState() {
    return this.monsterRepository.getState();
  }

  async saveState(state) {
    return this.monsterRepository.saveState(state);
  }

  async _resolveDrops(drops) {
    if (!Array.isArray(drops)) return [];
    const allItems = this.itemRepository ? await this.itemRepository.findAll() : [];
    return drops.map((d) => {
      let { itemId = null, itemName = null } = d;
      if (!itemId && itemName) {
        const found = allItems.find((i) => i.name === itemName);
        if (found) { itemId = found.id; itemName = found.name; }
      } else if (itemId && !itemName) {
        const found = allItems.find((i) => i.id === itemId);
        if (found) itemName = found.name;
      }
      return { itemId, itemName, chance: Math.min(100, Math.max(0, Number(d.chance) || 0)) };
    }).filter((d) => d.itemId);
  }
}

module.exports = { MonsterService, calcStats };
