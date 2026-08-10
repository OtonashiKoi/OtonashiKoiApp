const { AppError, ERROR_CODES } = require("../../shared/errors");
const { normalizeEffectList } = require("../../shared/effectPayloads");

const VALID_EFFECT_TYPES = ["none", "grant_gold", "grant_diamond", "grant_exp", "grant_status_points", "checkin_multiplier", "reroll_attributes"];
const VALID_TIERS = ["D", "C", "B", "A", "S"];

// 武器種類與對應的攻擊屬性
const VALID_WEAPON_TYPES = ["sword_1h", "sword_2h", "dagger", "mace_1h", "mace_2h", "axe_1h", "axe_2h", "staff_1h", "staff_2h", "bow", "dice"];
const VALID_OFFHAND_TYPES = ["offhand_sword", "offhand_dagger", "offhand_mace"];
const TWO_HANDED_WEAPON_TYPES = new Set(["sword_2h", "mace_2h", "axe_2h", "staff_2h", "bow", "dice"]);
// 需與 src/shared/combatStats.js 的 WEAPON_CONFIG.baseStat 保持一致
const WEAPON_ATK_STAT = {
  sword_1h: "str", sword_2h: "str",
  dagger:   "agi", mace_1h: "str", mace_2h: "str", axe_1h: "str", axe_2h: "str",
  staff_1h: "int", staff_2h: "int",
  bow:      "dex",
  dice:     "luk",
  offhand_sword: "str", offhand_dagger: "str", offhand_mace: "str"
};

class ItemService {
  constructor(itemRepository, progressRepository = null) {
    this.itemRepository = itemRepository;
    this.progressRepository = progressRepository;
  }

  _normalizeEffect(effect) {
    if (!effect || !VALID_EFFECT_TYPES.includes(effect.type)) return { type: "none", value: 0 };
    return { type: effect.type, value: Math.max(0, Number(effect.value) || 0) };
  }

  _normalizeEffectBundles(fields = {}, itemType = "consumable") {
    return {
      passiveEffects: normalizeEffectList(fields.passiveEffects, { fallbackTrigger: "passive", fallbackTarget: "self", sourcePhase: "passive" }),
      procEffects: normalizeEffectList(fields.procEffects, { fallbackTrigger: "on_hit", fallbackTarget: "enemy", sourcePhase: "proc" }),
      useEffects: normalizeEffectList(fields.useEffects, { fallbackTrigger: "on_npc_event", fallbackTarget: "self", sourcePhase: "consume" }),
      combatEffects: normalizeEffectList(fields.combatEffects, { fallbackTrigger: "on_battle_start", fallbackTarget: "self", sourcePhase: itemType === "equipment" ? "passive" : "consume" })
    };
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
    return ["consumable", "collectible", "equipment", "job_badge", "pet_egg", "pet"].includes(t) ? t : "consumable";
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
    const VALID = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r","title_eq","job_eq","special","special_1","special_2","special_3","anchor"];
    return VALID.includes(slot) ? slot : null;
  }

  _normalizeWeaponType(t, slot) {
    if (slot === "shield") return VALID_OFFHAND_TYPES.includes(t) ? t : null;
    return VALID_WEAPON_TYPES.includes(t) ? t : null;
  }

  _normalizeTier(t) {
    return VALID_TIERS.includes(t) ? t : null;
  }

  async createItem({ name, description, itemType, effect, imageUrl, imageThumbnailUrl, equipSlot, equipStats, weaponType, tier, passiveEffects, procEffects, useEffects, combatEffects }) {
    const normalizedType = this._normalizeItemType(itemType);
    const normalizedSlot = (normalizedType === "equipment" || normalizedType === "job_badge") ? (this._normalizeEquipSlot(equipSlot) || "head_top") : null;
    const resolvedWeaponType = (normalizedSlot === "weapon" || normalizedSlot === "shield") ? (this._normalizeWeaponType(weaponType, normalizedSlot) || null) : null;
    const effectBundles = this._normalizeEffectBundles({ passiveEffects, procEffects, useEffects, combatEffects }, normalizedType);
    const item = {
      id: crypto.randomUUID(),
      name: String(name || "").trim(),
      description: String(description || "").trim(),
      itemType: normalizedType,
      imageUrl: imageUrl || null,
      imageThumbnailUrl: imageThumbnailUrl || null,
      effect: this._normalizeEffect(effect),
      useEffects: effectBundles.useEffects,
      passiveEffects: effectBundles.passiveEffects,
      procEffects: effectBundles.procEffects,
      combatEffects: effectBundles.combatEffects,
      equipSlot: normalizedSlot,
      equipStats: (normalizedType === "equipment" || normalizedType === "job_badge") ? (this._normalizeEquipStats(equipStats) || null) : null,
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

  async updateItem(id, fields, options = {}) {
    const { skipPlayerSync = false } = options || {};
    const item = await this.getItemById(id);
    const updated = { ...item };
    if (fields.name !== undefined) updated.name = String(fields.name).trim();
    if (fields.description !== undefined) updated.description = String(fields.description).trim();
    if (fields.itemType !== undefined) updated.itemType = this._normalizeItemType(fields.itemType);
    if (fields.effect !== undefined) updated.effect = this._normalizeEffect(fields.effect);
    if (fields.passiveEffects !== undefined || fields.procEffects !== undefined || fields.useEffects !== undefined || fields.combatEffects !== undefined) {
      const bundles = this._normalizeEffectBundles({
        passiveEffects: fields.passiveEffects !== undefined ? fields.passiveEffects : updated.passiveEffects,
        procEffects: fields.procEffects !== undefined ? fields.procEffects : updated.procEffects,
        useEffects: fields.useEffects !== undefined ? fields.useEffects : updated.useEffects,
        combatEffects: fields.combatEffects !== undefined ? fields.combatEffects : updated.combatEffects
      }, updated.itemType);
      updated.passiveEffects = bundles.passiveEffects;
      updated.procEffects = bundles.procEffects;
      updated.useEffects = bundles.useEffects;
      updated.combatEffects = bundles.combatEffects;
    }
    if (fields.imageUrl !== undefined) updated.imageUrl = fields.imageUrl;
    if (fields.imageThumbnailUrl !== undefined) updated.imageThumbnailUrl = fields.imageThumbnailUrl;
    if (fields.equipSlot !== undefined) updated.equipSlot = (updated.itemType === "equipment" || updated.itemType === "job_badge") ? (this._normalizeEquipSlot(fields.equipSlot) || "head_top") : null;
    if (fields.equipStats !== undefined) updated.equipStats = (updated.itemType === "equipment" || updated.itemType === "job_badge") ? (this._normalizeEquipStats(fields.equipStats) || null) : null;
    if (fields.weaponType !== undefined || fields.equipSlot !== undefined) {
      const wt = (updated.equipSlot === "weapon" || updated.equipSlot === "shield") ? (this._normalizeWeaponType(fields.weaponType ?? updated.weaponType, updated.equipSlot) || null) : null;
      updated.weaponType = wt;
      updated.isTwoHanded = wt ? TWO_HANDED_WEAPON_TYPES.has(wt) : false;
      updated.atkStat = wt ? (WEAPON_ATK_STAT[wt] || "str") : null;
    }
    if (fields.tier !== undefined) updated.tier = this._normalizeTier(fields.tier);
    // 若更改類型為非裝備或非職業徽章，清空裝備欄位
    if (updated.itemType !== "equipment" && updated.itemType !== "job_badge") { updated.equipSlot = null; updated.equipStats = null; updated.weaponType = null; updated.isTwoHanded = false; updated.atkStat = null; updated.tier = null; }
    if (!updated.name) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "道具名稱不可空白", 400);
    const saved = await this.itemRepository.save(updated);
    // 背景同步玩家背包與裝備槽中相同 itemId 的道具
    if (this.progressRepository && !skipPlayerSync) {
      this._syncItemToPlayers(saved).catch(e => console.error("[ItemService] syncItemToPlayers error:", e));
    }
    return saved;
  }

  // 同步道具庫變更到所有持有該道具的玩家
  async _syncItemToPlayers(libItem) {
    const allProgress = await this.progressRepository.listAll();
    const SYNC_FIELDS = ["imageUrl", "imageThumbnailUrl", "equipSlot", "equipStats",
                         "weaponType", "isTwoHanded", "atkStat", "tier", "itemEffect", "itemType",
                         "useEffects", "passiveEffects", "procEffects", "combatEffects"];

    for (const progress of allProgress) {
      let dirty = false;

      const syncEntry = (entry) => {
        if (entry.itemId !== libItem.id) return entry;
        const enhanceLevel = entry.enhanceLevel || 0;
        const baseName = libItem.name;

        // 重建 equipStats：道具庫基底 + 強化加成疊回主屬性
        let newStats = libItem.equipStats ? { ...libItem.equipStats } : null;
        if (newStats && enhanceLevel > 0) {
          // 找主屬性（數值最大的 key）
          const mainStat = Object.entries(newStats).sort((a, b) => b[1] - a[1])[0]?.[0];
          if (mainStat) newStats[mainStat] = (newStats[mainStat] || 0) + enhanceLevel;
        }

        const updated = {
          ...entry,
          itemName: enhanceLevel > 0 ? `${baseName} +${enhanceLevel}` : baseName,
          imageUrl: libItem.imageUrl ?? entry.imageUrl,
          imageThumbnailUrl: libItem.imageThumbnailUrl ?? entry.imageThumbnailUrl,
          equipSlot: libItem.equipSlot ?? entry.equipSlot,
          equipStats: newStats ?? entry.equipStats,
          weaponType: libItem.weaponType ?? entry.weaponType,
          isTwoHanded: libItem.isTwoHanded ?? entry.isTwoHanded,
          atkStat: libItem.atkStat ?? entry.atkStat,
          tier: libItem.tier ?? entry.tier,
          itemEffect: libItem.effect ?? entry.itemEffect,
          useEffects: libItem.useEffects ?? entry.useEffects,
          passiveEffects: libItem.passiveEffects ?? entry.passiveEffects,
          procEffects: libItem.procEffects ?? entry.procEffects,
          combatEffects: libItem.combatEffects ?? entry.combatEffects,
          itemType: libItem.itemType ?? entry.itemType,
        };

        // 檢查是否有任何欄位實際變動
        const changed = SYNC_FIELDS.some(f => JSON.stringify(updated[f]) !== JSON.stringify(entry[f]))
          || updated.itemName !== entry.itemName;
        if (changed) dirty = true;
        return updated;
      };

      // 同步背包
      if (Array.isArray(progress.inventory)) {
        progress.inventory = progress.inventory.map(syncEntry);
      }

      // 同步裝備槽
      if (progress.equipment && typeof progress.equipment === "object") {
        for (const slot of Object.keys(progress.equipment)) {
          const entry = progress.equipment[slot];
          if (entry?.itemId === libItem.id) {
            progress.equipment[slot] = syncEntry(entry);
          }
        }
      }

      if (dirty) {
        progress.updatedAt = new Date().toISOString();
        await this.progressRepository.save(progress);
      }
    }
  }

  async deleteItem(id) {
    await this.getItemById(id);
    await this.itemRepository.delete(id);
  }
}

module.exports = { ItemService };
