const { AppError, ERROR_CODES } = require("../../shared/errors");
const { normalizeEffectList, normalizeMonsterSkillList } = require("../../shared/effectPayloads");
const { normalizeZone, getZoneDefaultEntryFee } = require("../../shared/zones");

// 純公式計算，輸入屬性 → 輸出戰鬥數值
// maxHp / def / mdef 已直接存於資料庫，不在此覆蓋
function calcStats({ str = 1, agi = 1, vit = 1, int: INT = 1, dex = 1 } = {}) {
  return {
    agi:   Math.max(1, Math.round(agi)),
    atk:   str * 3,
    def:   Math.round(vit),
    mdef:  Math.round(INT * 2),
    dodge: Math.min(50, Math.round(agi * 0.5 * 10) / 10),
    hit:   Math.min(100, 85 + dex) // 80→85 補償命中公式常數 75→62，使怪打玩家命中維持原水準
  };
}

// 合併資料庫存儲的 maxHp/def 與公式計算的其他數值
//
// 新 DEF 模型（與玩家對稱）：
//   def       = % 減傷（0~75）。doc.def 有填就用，否則 0。
//   flatDef   = 純減固定值。doc.flatDef 有填就用，否則 level × 1。
//   level     = 怪物等級（戰鬥時做等級壓制用）
// 戰鬥公式：傷害 = max(1, (ATK × levelMult − flatDef) × (1 − def/100))
function effectiveCalc(m) {
  const base = calcStats(m);
  const level = (typeof m.level === 'number' && !isNaN(m.level)) ? Math.max(1, m.level) : 1;
  const vitStat = (typeof m.vit === 'number' && !isNaN(m.vit)) ? Math.max(0, m.vit) : 0;
  const def = (typeof m.def === 'number' && !isNaN(m.def)) ? Math.min(75, Math.max(0, m.def)) : 0;
  // flatDef = level × 1 + VIT × 1（doc 有填 flatDef 就直接用，覆寫派生公式）
  const flatDef = (typeof m.flatDef === 'number' && !isNaN(m.flatDef))
    ? Math.max(0, m.flatDef)
    : (level * 1) + (vitStat * 1);
  // maxHp 派生：level × 800 + VIT × 200（doc.maxHp 有填就用）
  const derivedMaxHp = level * 800 + vitStat * 200;
  const defIgnorePct = (typeof m.defIgnorePct === 'number' && !isNaN(m.defIgnorePct))
    ? Math.min(100, Math.max(0, m.defIgnorePct)) : 0;
  const luk = typeof m.luk === 'number' ? m.luk : 0;
  const agi = (typeof m.agi === 'number' && !isNaN(m.agi)) ? Math.max(1, Math.round(m.agi)) : base.agi;
  const intStat = (typeof m.int === 'number' && !isNaN(m.int)) ? Math.max(0, m.int) : 0;
  // 敏影怪：dodgeBonus 可突破 AGI 迴避 cap 50（總迴避上限 75；命中公式 floor 20% 為最終保底）
  const dodgeBonus = (typeof m.dodgeBonus === 'number' && !isNaN(m.dodgeBonus)) ? Math.max(0, m.dodgeBonus) : 0;
  return {
    maxHp: (typeof m.maxHp === 'number' && !isNaN(m.maxHp)) ? m.maxHp : derivedMaxHp,
    agi,
    int:   intStat,
    atk:   base.atk,
    def,           // % 減傷
    flatDef,       // 固定值減傷
    level,         // 等級壓制用
    defIgnorePct,
    isBoss: Boolean(m.isBoss), // 供戰鬥端 BOSS 規則(暈眩抗性/格擋改制/對BOSS傷害)判定
    dodge: Math.min(75, base.dodge + dodgeBonus),
    hit:   base.hit,
    critRate:    Math.min(100, Math.round(luk * 0.3)),           // LUK → 爆擊%（同玩家公式）
    comboChance: Math.min(80,  Math.round(3 + agi * 0.5)),       // AGI → 連擊%（同玩家公式）
    // 傷害浮動：與玩家對齊，0.7 ~ 1.0；INT 每點 +0.01 抬高下限
    dmgMin: Math.min(1.0, 0.7 + intStat * 0.01),
    dmgMax: 1.0,
  };
}

function normalizeEntryFee(entryFee, zoneKey) {
  if (entryFee !== undefined && entryFee !== null && entryFee !== "") {
    return Math.max(0, Number(entryFee) || 0);
  }
  return getZoneDefaultEntryFee(zoneKey);
}

class MonsterService {
  constructor(monsterRepository, itemRepository) {
    this.monsterRepository = monsterRepository;
    this.itemRepository = itemRepository;
  }

  async listMonsters({ includeDisabled = false, zone = null } = {}) {
    const monsters = await this.monsterRepository.findAll();
    let list = includeDisabled ? monsters : monsters.filter((m) => m.enabled);
    if (zone) list = list.filter((m) => (m.zone || "normal") === zone);
    return list.map((m) => ({ ...m, calc: effectiveCalc(m) }));
  }

  async getMonsterById(id) {
    const m = await this.monsterRepository.findById(id);
    if (!m) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `怪物不存在: ${id}`, 404);
    return { ...m, calc: effectiveCalc(m) };
  }

  async createMonster(fields) {
    const drops = await this._resolveDrops(fields.drops || []);
    const passiveEffects = normalizeEffectList(fields.passiveEffects, { fallbackTrigger: "passive", fallbackTarget: "self", sourcePhase: "passive" });
    const procEffects = normalizeEffectList(fields.procEffects, { fallbackTrigger: "on_hit", fallbackTarget: "enemy", sourcePhase: "proc" });
    const battleStartEffects = normalizeEffectList(fields.battleStartEffects, { fallbackTrigger: "on_battle_start", fallbackTarget: "self", sourcePhase: "monster_skill" });
    const now = new Date().toISOString();
    const skills = normalizeMonsterSkillList(fields.skills);
    const monster = {
      id: crypto.randomUUID(),
      seq: Math.max(1, Number(fields.seq) || 1),
      name: String(fields.name || "").trim() || "未命名怪物",
      imageUrl: fields.imageUrl || null,
      imageThumbnailUrl: fields.imageThumbnailUrl || null,
      str: Math.max(0, Number(fields.str) || 0),
      agi: Math.max(0, Number(fields.agi) || 0),
      vit: Math.max(0, Number(fields.vit) || 0),
      int: Math.max(0, Number(fields.int) || 0),
      dex: Math.max(0, Number(fields.dex) || 0),
      luk: Math.max(0, Number(fields.luk) || 0),
      level: Math.max(0, Number(fields.level) ?? 0),
      zone: normalizeZone(fields.zone),
      maxHp: Math.max(1, Number(fields.maxHp) || 1),
      def:   Math.min(75, Math.max(0, Number(fields.def) || 0)),
      entryFee: normalizeEntryFee(fields.entryFee, normalizeZone(fields.zone)),
      expReward: Math.max(0, Number(fields.expReward) || 0),
      goldReward:Math.max(0, Number(fields.goldReward)|| 0),
      drops,
      passiveEffects,
      procEffects,
      battleStartEffects,
      skills,
      spawnRate: Math.min(100, Math.max(1, Number(fields.spawnRate) || 10)),
      isBoss:  Boolean(fields.isBoss),
      enabled: Boolean(fields.enabled),
      createdAt: now,
      updatedAt: now
    };
    return { ...await this.monsterRepository.save(monster), calc: effectiveCalc(monster) };
  }

  async updateMonster(id, fields) {
    const monster = await this.monsterRepository.findById(id);
    if (!monster) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `怪物不存在: ${id}`, 404);
    const updated = { ...monster };
    let imageChanged = false;
    if (fields.seq       !== undefined) updated.seq       = Math.max(1, Number(fields.seq) || 1);
    if (fields.name      !== undefined) updated.name      = String(fields.name).trim() || monster.name;
    if (fields.imageUrl  !== undefined) {
      updated.imageUrl  = fields.imageUrl;
      imageChanged = true;
    }
    if (fields.imageThumbnailUrl !== undefined) {
      updated.imageThumbnailUrl = fields.imageThumbnailUrl;
      imageChanged = true;
    }
    for (const stat of ["str", "agi", "vit", "int", "dex", "luk"]) {
      if (fields[stat] !== undefined) updated[stat] = Math.max(0, Number(fields[stat]) || 0);
    }
    if (fields.level     !== undefined) updated.level     = Math.max(0, Number(fields.level) ?? 0);
    if (fields.zone      !== undefined) updated.zone      = normalizeZone(fields.zone);
    if (fields.maxHp !== undefined) updated.maxHp = Math.max(1, Number(fields.maxHp) || 1);
    if (fields.def   !== undefined) updated.def   = Math.min(75, Math.max(0, Number(fields.def) || 0));
    if (fields.entryFee  !== undefined) {
      updated.entryFee = normalizeEntryFee(fields.entryFee, updated.zone);
    } else if (fields.zone !== undefined) {
      updated.entryFee = getZoneDefaultEntryFee(updated.zone);
    }
    if (fields.expReward !== undefined) updated.expReward = Math.max(0, Number(fields.expReward) || 0);
    if (fields.goldReward!== undefined) updated.goldReward= Math.max(0, Number(fields.goldReward)|| 0);
    if (fields.drops     !== undefined) updated.drops     = await this._resolveDrops(fields.drops);
    if (fields.passiveEffects !== undefined) updated.passiveEffects = normalizeEffectList(fields.passiveEffects, { fallbackTrigger: "passive", fallbackTarget: "self", sourcePhase: "passive" });
    if (fields.procEffects !== undefined) updated.procEffects = normalizeEffectList(fields.procEffects, { fallbackTrigger: "on_hit", fallbackTarget: "enemy", sourcePhase: "proc" });
    if (fields.battleStartEffects !== undefined) updated.battleStartEffects = normalizeEffectList(fields.battleStartEffects, { fallbackTrigger: "on_battle_start", fallbackTarget: "self", sourcePhase: "monster_skill" });
    if (fields.skills !== undefined) updated.skills = normalizeMonsterSkillList(fields.skills);
    if (fields.spawnRate !== undefined) updated.spawnRate = Math.min(100, Math.max(1, Number(fields.spawnRate) || 10));
    if (fields.isBoss    !== undefined) updated.isBoss    = Boolean(fields.isBoss);
    if (fields.enabled   !== undefined) updated.enabled   = Boolean(fields.enabled);
    updated.updatedAt = new Date().toISOString();
    if (imageChanged) updated.imageUpdatedAt = updated.updatedAt;
    const saved = await this.monsterRepository.save(updated);
    return { ...saved, calc: effectiveCalc(saved) };
  }

  async deleteMonster(id) {
    const monster = await this.monsterRepository.findById(id);
    if (!monster) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `怪物不存在: ${id}`, 404);
    await this.monsterRepository.delete(id);
  }

  async getState(zoneKey = "normal") {
    return this.monsterRepository.getState(zoneKey);
  }

  async saveState(state, zoneKey = "normal") {
    return this.monsterRepository.saveState(state, zoneKey);
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
