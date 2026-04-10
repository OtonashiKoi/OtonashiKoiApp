const { AppError, ERROR_CODES } = require("../../shared/errors");

const VALID_EFFECT_TYPES = ["none", "grant_gold", "grant_diamond", "grant_exp", "grant_status_points", "checkin_multiplier", "reroll_attributes"];
const VALID_TIERS = ["D", "C", "B", "A"];

// 武器種類與對應的攻擊屬性
const VALID_WEAPON_TYPES = ["sword_1h", "sword_2h", "dagger", "mace_1h", "mace_2h", "axe_1h", "axe_2h", "staff_1h", "staff_2h", "bow"];
const TWO_HANDED_WEAPON_TYPES = new Set(["sword_2h", "mace_2h", "axe_2h", "staff_2h", "bow"]);
const WEAPON_ATK_STAT = {
  sword_1h: "str", sword_2h: "str",
  dagger:   "str", mace_1h: "str", mace_2h: "str", axe_1h: "str", axe_2h: "str",
  staff_1h: "int", staff_2h: "int",
  bow:      "dex"
};

class ItemService {
  constructor(itemRepository) {
    this.itemRepository = itemRepository;
  }

  _normalizeEffect(effect) {
    if (!effect || !VALID_EFFECT_TYPES.includes(effect.type)) return { type: "none", value: 0 };
    return { type: effect.type, value: Math.max(0, Number(effect.value) || 0) };
  }

  async listItems() {
    return this.itemRepository.findAll();
  }

  async getItemById(id) {
    const item = await this.itemRepository.findById(id);
    if (!item) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `道具不存在: ${id}`, 404);
    return item;
  }

  _normalizeItemType(t) {
    return ["consumable", "collectible", "equipment"].includes(t) ? t : "consumable";
  }

  _normalizeEquipStats(stats) {
    if (!stats || typeof stats !== "object") return null;
    const s = {};
    for (const k of ["str","agi","vit","int","dex","luk"]) {
      const v = Number(stats[k]) || 0;
      if (v !== 0) s[k] = v;
    }
    return Object.keys(s).length ? s : null;
  }

  _normalizeEquipSlot(slot) {
    const VALID = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r","title_eq","job_eq","special_1","special_2","special_3"];
    return VALID.includes(slot) ? slot : null;
  }

  _normalizeWeaponType(t) {
    return VALID_WEAPON_TYPES.includes(t) ? t : null;
  }

  _normalizeTier(t) {
    return VALID_TIERS.includes(t) ? t : null;
  }

  async createItem({ name, description, itemType, effect, imageUrl, imageThumbnailUrl, equipSlot, equipStats, weaponType, tier }) {
    const normalizedType = this._normalizeItemType(itemType);
    const normalizedSlot = normalizedType === "equipment" ? (this._normalizeEquipSlot(equipSlot) || "head_top") : null;
    const resolvedWeaponType = normalizedSlot === "weapon" ? (this._normalizeWeaponType(weaponType) || null) : null;
    const item = {
      id: crypto.randomUUID(),
      name: String(name || "").trim(),
      description: String(description || "").trim(),
      itemType: normalizedType,
      imageUrl: imageUrl || null,
      imageThumbnailUrl: imageThumbnailUrl || null,
      effect: this._normalizeEffect(effect),
      equipSlot: normalizedSlot,
      equipStats: normalizedType === "equipment" ? (this._normalizeEquipStats(equipStats) || null) : null,
      weaponType: resolvedWeaponType,
      isTwoHanded: resolvedWeaponType ? TWO_HANDED_WEAPON_TYPES.has(resolvedWeaponType) : false,
      atkStat: resolvedWeaponType ? (WEAPON_ATK_STAT[resolvedWeaponType] || "str") : null,
      tier: this._normalizeTier(tier),
      enhanceLevel: 0,
      createdAt: new Date().toISOString()
    };
    if (!item.name) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "道具名稱不可空白", 400);
    return this.itemRepository.save(item);
  }

  async updateItem(id, fields) {
    const item = await this.getItemById(id);
    const updated = { ...item };
    if (fields.name !== undefined) updated.name = String(fields.name).trim();
    if (fields.description !== undefined) updated.description = String(fields.description).trim();
    if (fields.itemType !== undefined) updated.itemType = this._normalizeItemType(fields.itemType);
    if (fields.effect !== undefined) updated.effect = this._normalizeEffect(fields.effect);
    if (fields.imageUrl !== undefined) updated.imageUrl = fields.imageUrl;
    if (fields.imageThumbnailUrl !== undefined) updated.imageThumbnailUrl = fields.imageThumbnailUrl;
    if (fields.equipSlot !== undefined) updated.equipSlot = updated.itemType === "equipment" ? (this._normalizeEquipSlot(fields.equipSlot) || "head_top") : null;
    if (fields.equipStats !== undefined) updated.equipStats = updated.itemType === "equipment" ? (this._normalizeEquipStats(fields.equipStats) || null) : null;
    if (fields.weaponType !== undefined || fields.equipSlot !== undefined) {
      const wt = updated.equipSlot === "weapon" ? (this._normalizeWeaponType(fields.weaponType ?? updated.weaponType) || null) : null;
      updated.weaponType = wt;
      updated.isTwoHanded = wt ? TWO_HANDED_WEAPON_TYPES.has(wt) : false;
      updated.atkStat = wt ? (WEAPON_ATK_STAT[wt] || "str") : null;
    }
    if (fields.tier !== undefined) updated.tier = this._normalizeTier(fields.tier);
    // 若更改類型為非裝備，清空裝備欄位
    if (updated.itemType !== "equipment") { updated.equipSlot = null; updated.equipStats = null; updated.weaponType = null; updated.isTwoHanded = false; updated.atkStat = null; updated.tier = null; }
    if (!updated.name) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "道具名稱不可空白", 400);
    return this.itemRepository.save(updated);
  }

  async deleteItem(id) {
    await this.getItemById(id);
    await this.itemRepository.delete(id);
  }
}

module.exports = { ItemService };
