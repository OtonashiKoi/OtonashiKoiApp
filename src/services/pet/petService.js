"use strict";

const crypto = require("crypto");
const { AppError, ERROR_CODES } = require("../../shared/errors");

// 強化寶石 itemId（依階級），採集產出用
const GEM_ID_BY_TIER = {
  D: "72fde92d-e33f-42fb-8d86-2e811d03f84d",
  C: "556db9e1-b084-4b22-bab5-a66c2b586184",
  B: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072",
  A: "a6ae293d-52fc-4af5-8770-891ddf842e35",
};

// 餵食基礎值（餵「對應寵物等級階級」的裝備時的滿額）
const BASE_FEED_EXP = 40;       // 成長 exp / 孵化進度
const BASE_FEED_SATIETY = 30;   // 飽食度
// 階級符合度折扣：符合 100% / 低 1 階 60% / 低 2 階 30% / 低 3 階 15%
const FEED_TIER_PENALTY = [1.0, 0.6, 0.3, 0.15];
const TIER_RANK = { D: 0, C: 1, B: 2, A: 3 };

// 寵物對應階級（依等級，與採集階級一致）：Lv1-10→D, 11-20→C, 21-40→B, 41-50→A
function petMatchingTier(level) {
  const lv = Math.max(1, Number(level) || 1);
  if (lv <= 10) return "D";
  if (lv <= 20) return "C";
  if (lv <= 40) return "B";
  return "A";
}

// 完全不可餵（非飼料本質）：怪物卡 / 職業徽章 / 稱號
function isHardBlocked(item) {
  if (!item) return true;
  if (item.monsterCardOf) return true;
  const slot = String(item.equipSlot || "");
  return slot === "job_eq" || slot === "title_eq" || /^special/.test(slot);
}
// 可「單件手動餵」：真裝備（含強化過/特效），但排除卡片/徽章/稱號
function isSingleFeedable(item) {
  return !!item && item.itemType === "equipment" && !isHardBlocked(item);
}
// 可「一鍵批量餵」：素裝（+0）— 只有「有 +值」才需單件餵；特效與否不影響
function isBatchFeedable(item) {
  if (!isSingleFeedable(item)) return false;
  if (Number(item.enhanceLevel) > 0) return false;               // 有 +值 → 只能單件餵
  return true;                                                   // 素裝（含素的特效戒）→ 一鍵可餵
}

// 計算餵食倍率：null = 不能餵（裝備階級高於寵物對應階級）
function feedMultiplier(gearTier, matchTier) {
  const g = TIER_RANK[String(gearTier || "").toUpperCase()];
  const m = TIER_RANK[matchTier];
  if (g == null || m == null) return null;
  if (g > m) return null;             // 高階裝備不能餵低等寵物
  const diff = m - g;                 // 0=符合, 1=低1階...
  return FEED_TIER_PENALTY[diff] ?? 0;
}

const MAX_LEVEL = 50;
const HATCH_THRESHOLD = 800;            // 約 20 件 D 裝
const SATIETY_MAX = 100;
const HUNGER_GRACE_HOURS = 12;          // 餵飽後 12 小時不掉等
const GATHER_INTERVAL_MIN = 20;         // 基礎間隔（每 20 分 1 個），各龍以 intervalMult 調整
const GATHER_CAP = 18;                  // 最多累積 18 個（6 小時量）
const GEM_DROP_RATE = 0.7;              // 預設強化石比例（無 modifier 時 fallback）
const LEVELUP_EXP_PER_LEVEL = 120;      // 每級所需成長 exp

// 採集階級順序（高一階用）
const TIER_ORDER = ["D", "C", "B", "A"];
function tierUp(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : tier;
}
// 預設 modifier（孵化前/無種類資料時）
const DEFAULT_GATHER_MOD = { intervalMult: 1.0, gemBias: GEM_DROP_RATE, qualityUpChance: 0 };

function nowMs() { return Date.now(); }
function isoNow() { return new Date().toISOString(); }

// 寵物等級 → 採集產出階級
function tierForPetLevel(level) {
  if (level <= 10) return "D";
  if (level <= 20) return "C";
  if (level <= 40) return "B";
  return "A";
}

class PetService {
  constructor({ progressRepository, itemRepository, petRepository }) {
    this.progressRepository = progressRepository;
    this.itemRepository = itemRepository;
    this.petRepository = petRepository;
  }

  // ── 內部：取得玩家 progress（含 pets 陣列保底） ──
  async _loadProgress(discordId) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到玩家進度", 404);
    if (!Array.isArray(progress.pets)) progress.pets = [];
    if (!Array.isArray(progress.inventory)) progress.inventory = [];
    return progress;
  }

  _findPet(progress, petUuid) {
    return progress.pets.find((p) => p && p.uuid === petUuid) || null;
  }

  _getActivePet(progress) {
    if (!progress.activePetUuid) return null;
    return this._findPet(progress, progress.activePetUuid);
  }

  // ── 懶結算：飽食度衰減 + 飢餓掉等 ──
  // 規則：餵飽（飽食滿）後可放置 12 小時不掉等；超過後飽食歸零、開始掉 level/exp
  _applyHungerDecay(pet) {
    const now = nowMs();
    const last = Number(pet.lastSatietyAt || pet.lastSettleAt || now);
    const elapsedHr = Math.max(0, (now - last) / 3_600_000);
    if (elapsedHr <= 0) return pet;

    // 飽食度每小時下降固定量；滿值時前 12 小時為緩衝（不扣等）
    const SATIETY_DECAY_PER_HOUR = SATIETY_MAX / HUNGER_GRACE_HOURS; // 12 小時掉光
    const newSatiety = Math.max(0, (Number(pet.satiety) || 0) - elapsedHr * SATIETY_DECAY_PER_HOUR);

    // 飽食歸零後的「飢餓時數」→ 掉等
    if (newSatiety <= 0 && (Number(pet.satiety) || 0) <= 0) {
      // 已經餓著的期間，每小時掉 1 級（最低 Lv.1）
      const starveHr = elapsedHr;
      const levelsLost = Math.floor(starveHr);
      if (levelsLost > 0 && pet.stage === "grown") {
        pet.level = Math.max(1, (Number(pet.level) || 1) - levelsLost);
        pet.growthExp = 0;
      }
    }
    pet.satiety = newSatiety;
    pet.lastSatietyAt = now;
    return pet;
  }

  // ── 懶結算：採集累積（依該龍 gatherMod：速度 / 產出偏好 / 高一階）──
  _settleGathering(pet) {
    if (pet.stage !== "grown") return pet; // 未孵化不採集
    const now = nowMs();
    const last = Number(pet.lastSettleAt || now);
    if (!Array.isArray(pet.accruedItems)) pet.accruedItems = [];

    // 飽食 0 不採集
    if ((Number(pet.satiety) || 0) <= 0) {
      pet.lastSettleAt = now;
      return pet;
    }
    const mod = pet.gatherMod || DEFAULT_GATHER_MOD;
    const intervalMin = GATHER_INTERVAL_MIN * (Number(mod.intervalMult) || 1);
    const elapsedMin = Math.max(0, (now - last) / 60_000);
    const newItems = Math.floor(elapsedMin / intervalMin);
    if (newItems <= 0) return pet;

    const room = Math.max(0, GATHER_CAP - pet.accruedItems.length);
    const toAdd = Math.min(newItems, room);
    const baseTier = tierForPetLevel(pet.level || 1);
    const gemBias = Number.isFinite(Number(mod.gemBias)) ? Number(mod.gemBias) : GEM_DROP_RATE;
    const qualityUp = Number(mod.qualityUpChance) || 0;
    for (let i = 0; i < toAdd; i++) {
      const kind = Math.random() < gemBias ? "gem" : "equipment";
      const tier = (qualityUp > 0 && Math.random() < qualityUp) ? tierUp(baseTier) : baseTier;
      pet.accruedItems.push({ tier, kind });
    }
    pet.lastSettleAt = last + newItems * intervalMin * 60_000;
    if (pet.accruedItems.length >= GATHER_CAP) pet.lastSettleAt = now; // 滿了就對齊
    return pet;
  }

  // ── 對外：查詢寵物狀態（含懶結算） ──
  async getPetState(discordId) {
    const progress = await this._loadProgress(discordId);
    let changed = false;
    for (const pet of progress.pets) {
      this._applyHungerDecay(pet);
      this._settleGathering(pet);
      changed = true;
    }
    if (changed) await this.progressRepository.save(progress);

    const active = this._getActivePet(progress);
    return {
      pets: progress.pets.map((p) => this._toView(p)),
      activePetUuid: progress.activePetUuid || null,
      active: active ? this._toView(active) : null,
    };
  }

  _toView(pet) {
    const hatchPct = pet.stage === "egg"
      ? Math.min(100, Math.round(((pet.hatchProgress || 0) / HATCH_THRESHOLD) * 100))
      : 100;
    const mod = pet.gatherMod || DEFAULT_GATHER_MOD;
    return {
      uuid: pet.uuid,
      petId: pet.petId || null,
      species: pet.species || null,
      speciesName: pet.stage === "egg" ? null : (pet.speciesName || null), // 蛋階段不揭曉種類
      // 蛋階段不揭曉圖片
      imageUrl: pet.stage === "egg" ? null : (pet.imageUrl || null),
      imageThumbnailUrl: pet.stage === "egg" ? null : (pet.imageThumbnailUrl || null),
      rarity: pet.rarity || null,
      nickname: pet.nickname || null,
      stage: pet.stage,
      level: pet.level || 1,
      feedTier: petMatchingTier(pet.stage === "egg" ? 1 : pet.level), // 餵食對應階級
      growthExp: pet.growthExp || 0,
      expToNext: LEVELUP_EXP_PER_LEVEL,
      satiety: Math.round(pet.satiety || 0),
      satietyMax: SATIETY_MAX,
      hatchPct,
      hatchProgress: pet.hatchProgress || 0,
      hatchThreshold: HATCH_THRESHOLD,
      gatherCount: Array.isArray(pet.accruedItems) ? pet.accruedItems.length : 0,
      gatherCap: GATHER_CAP,
      producesTier: tierForPetLevel(pet.level || 1),
      // 採集特性（已孵化才有意義）
      gatherIntervalMin: pet.stage === "grown" ? Math.round(GATHER_INTERVAL_MIN * (Number(mod.intervalMult) || 1)) : null,
      gemBias: pet.stage === "grown" ? (Number.isFinite(Number(mod.gemBias)) ? Number(mod.gemBias) : GEM_DROP_RATE) : null,
      qualityUpChance: pet.stage === "grown" ? (Number(mod.qualityUpChance) || 0) : null,
    };
  }

  // ── 餵食（單件或批量；先補飽食，滿後轉成長 exp / 孵化進度） ──
  // opts: { inventoryUuid } 餵單件 | { tier } 餵 inventory 內所有該階裝備
  async feedPet(discordId, petUuid, opts = {}) {
    const progress = await this._loadProgress(discordId);
    const pet = this._findPet(progress, petUuid);
    if (!pet) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物", 404);

    this._applyHungerDecay(pet);

    // 寵物對應階級（蛋階段 level=1 → D）
    const matchTier = petMatchingTier(pet.stage === "egg" ? 1 : pet.level);

    // 選出要餵的裝備（只接受 itemType==="equipment"）
    let feedTargets = [];
    let protectedCount = 0; // 被保護（強化/特效/卡片等）而未餵的數量
    if (opts.inventoryUuid) {
      const it = progress.inventory.find((x) => x && x.uuid === opts.inventoryUuid);
      if (!it) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該道具", 404);
      if (it.itemType !== "equipment") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只能餵食裝備", 400);
      if (!isSingleFeedable(it)) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "卡片 / 職業徽章 / 稱號不能當飼料", 400);
      }
      if (feedMultiplier(it.tier, matchTier) === null) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${String(it.tier).toUpperCase()} 階裝備太高級，餵不進對應 ${matchTier} 階的寵物（高階裝備不能餵低等寵物）`, 400);
      }
      feedTargets = [it];
    } else if (opts.tier) {
      const tier = String(opts.tier).toUpperCase();
      if (feedMultiplier(tier, matchTier) === null) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${tier} 階裝備太高級，餵不進對應 ${matchTier} 階的寵物`, 400);
      }
      const tierGear = progress.inventory.filter((x) => x && x.itemType === "equipment" && String(x.tier).toUpperCase() === tier);
      feedTargets = tierGear.filter(isBatchFeedable);                // 一鍵只餵素裝（+0、非卡片徽章稱號）
      protectedCount = tierGear.length - feedTargets.length;         // 有 +值 / 卡片徽章 → 保護
      if (feedTargets.length === 0) {
        const hint = protectedCount > 0 ? `（有 ${protectedCount} 件有 +值或為卡片徽章受保護，強化裝請單件餵）` : "";
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `背包沒有可一鍵餵的 ${tier} 階素裝${hint}`, 400);
      }
    } else {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "未指定餵食對象", 400);
    }

    let totalSatiety = 0, totalGrowth = 0, totalHatch = 0, fed = 0;
    const consumedUuids = new Set();
    for (const it of feedTargets) {
      const tier = String(it.tier || "D").toUpperCase();
      const mult = feedMultiplier(tier, matchTier);
      if (mult === null) continue; // 高階裝備跳過（批量時保險）
      const satietyGain = Math.round(BASE_FEED_SATIETY * mult);
      const expGain = Math.round(BASE_FEED_EXP * mult);

      if (pet.stage === "egg") {
        // 蛋階段：餵食累積孵化進度（同時補飽食以免孵化期間餓死）
        pet.hatchProgress = (pet.hatchProgress || 0) + expGain;
        totalHatch += expGain;
      } else {
        // 已孵化：先補飽食度，滿了才轉成長 exp
        const before = Number(pet.satiety) || 0;
        const after = Math.min(SATIETY_MAX, before + satietyGain);
        const usedForSatiety = after - before;
        pet.satiety = after;
        totalSatiety += usedForSatiety;
        if (after >= SATIETY_MAX) {
          // 飽食已滿 → 這件的成長 exp 生效
          pet.growthExp = (pet.growthExp || 0) + expGain;
          totalGrowth += expGain;
        }
      }
      consumedUuids.add(it.uuid);
      fed++;
    }

    // 孵化判定（達門檻 → 隨機開獎決定種類）
    let hatched = false;
    let hatchedSpecies = null;
    if (pet.stage === "egg" && (pet.hatchProgress || 0) >= HATCH_THRESHOLD) {
      const rolled = await this._rollSpecies();
      pet.stage = "grown";
      pet.level = 1;
      pet.growthExp = 0;
      pet.satiety = SATIETY_MAX;       // 孵化後給滿飽食
      pet.lastSatietyAt = nowMs();
      pet.lastSettleAt = nowMs();
      pet.accruedItems = [];
      if (rolled) {
        pet.petId = rolled.id;
        pet.species = rolled.species;
        pet.speciesName = rolled.name;
        pet.imageUrl = rolled.imageUrl || null;
        pet.imageThumbnailUrl = rolled.imageThumbnailUrl || null;
        pet.rarity = rolled.rarity || null;
        pet.gatherMod = rolled.gather || { ...DEFAULT_GATHER_MOD };
        if (!pet.nickname) pet.nickname = rolled.name; // 預設用種類名
        hatchedSpecies = rolled.name;
      }
      hatched = true;
    }

    // 升級判定（成長 exp 滿一級就升，可連升）
    let leveledTo = null;
    while (pet.stage === "grown" && pet.level < MAX_LEVEL && (pet.growthExp || 0) >= LEVELUP_EXP_PER_LEVEL) {
      pet.growthExp -= LEVELUP_EXP_PER_LEVEL;
      pet.level += 1;
      leveledTo = pet.level;
    }
    if (pet.level >= MAX_LEVEL) pet.growthExp = 0; // 封頂

    // 消耗 inventory 裝備
    progress.inventory = progress.inventory.filter((x) => !(x && consumedUuids.has(x.uuid)));
    pet.lastSatietyAt = nowMs();
    await this.progressRepository.save(progress);

    return {
      fed, protectedCount, totalSatiety, totalGrowth, totalHatch, hatched, hatchedSpecies, leveledTo,
      pet: this._toView(pet),
    };
  }

  // ── 列出「可單件餵給出戰寵物」的背包裝備（給選單面板用） ──
  //   回傳 { active, matchTier, items: [{ uuid, itemName, tier, enhanceLevel, hasSpecial, multiplier, pct }] }
  //   items 已過濾掉「階級太高餵不進去」與「卡片/徽章/稱號」，並依 階級↓ → +值↓ 排序。
  async listFeedableItems(discordId) {
    const progress = await this._loadProgress(discordId);
    const active = this._getActivePet(progress);
    if (!active) return { active: null, matchTier: null, items: [] };

    this._applyHungerDecay(active);
    const matchTier = petMatchingTier(active.stage === "egg" ? 1 : active.level);

    const items = (progress.inventory || [])
      .filter((it) => isSingleFeedable(it) && feedMultiplier(it.tier, matchTier) !== null)
      .map((it) => {
        const mult = feedMultiplier(it.tier, matchTier) || 0;
        const hasSpecial =
          (Array.isArray(it.passiveEffects) && it.passiveEffects.length > 0) ||
          (Array.isArray(it.procEffects) && it.procEffects.length > 0) ||
          (Array.isArray(it.combatEffects) && it.combatEffects.length > 0);
        return {
          uuid: it.uuid,
          itemName: it.itemName || it.name || "未命名裝備",
          tier: String(it.tier || "D").toUpperCase(),
          enhanceLevel: Number(it.enhanceLevel) || 0,
          hasSpecial,
          multiplier: mult,
          pct: Math.round(mult * 100),
        };
      })
      .sort((a, b) => {
        const tr = (TIER_RANK[b.tier] || 0) - (TIER_RANK[a.tier] || 0);
        if (tr !== 0) return tr;
        return b.enhanceLevel - a.enhanceLevel;
      });

    return { active: this._toView(active), matchTier, items };
  }

  // ── 孵化開獎：依 hatchWeight 從 pets 種類隨機抽一種 ──
  async _rollSpecies() {
    const all = await this.petRepository.findAll();
    const pool = (all || []).filter((p) => p && p.id);
    if (pool.length === 0) return null;
    const totalWeight = pool.reduce((s, p) => s + Math.max(0, Number(p.hatchWeight) || 1), 0);
    let roll = Math.random() * totalWeight;
    for (const p of pool) {
      roll -= Math.max(0, Number(p.hatchWeight) || 1);
      if (roll <= 0) return p;
    }
    return pool[pool.length - 1];
  }

  // ── 領取採集（含懶結算）→ 把累積道具寫進 inventory ──
  async claimGathering(discordId) {
    const progress = await this._loadProgress(discordId);
    const active = this._getActivePet(progress);
    if (!active) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "目前沒有出戰寵物", 400);
    this._applyHungerDecay(active);
    this._settleGathering(active);

    const items = Array.isArray(active.accruedItems) ? active.accruedItems : [];
    if (items.length === 0) {
      await this.progressRepository.save(progress);
      return { granted: [], pet: this._toView(active) };
    }

    const allItems = await this.itemRepository.findAll();
    const granted = [];
    for (const acc of items) {
      let entry = null;
      if (acc.kind === "gem") {
        const gemId = GEM_ID_BY_TIER[acc.tier] || GEM_ID_BY_TIER.D;
        const gem = allItems.find((it) => it.id === gemId);
        if (gem) entry = this._buildInventoryEntry(gem);
      } else {
        // 隨機該階裝備
        const pool = allItems.filter((it) => it.itemType === "equipment" && String(it.tier).toUpperCase() === acc.tier);
        if (pool.length) entry = this._buildInventoryEntry(pool[crypto.randomInt(0, pool.length)]);
      }
      if (entry) {
        progress.inventory.push(entry);
        granted.push({ itemName: entry.itemName, tier: acc.tier, kind: acc.kind });
      }
    }
    active.accruedItems = [];
    active.lastSettleAt = nowMs();
    await this.progressRepository.save(progress);
    return { granted, pet: this._toView(active) };
  }

  _buildInventoryEntry(item) {
    return {
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
      atkStat: item.atkStat || null,
      tier: item.tier || null,
      enhanceLevel: 0,
      source: "pet_gathering",
      grantedAt: isoNow(),
    };
  }

  // ── 設定出戰寵物（限 1） ──
  async setActivePet(discordId, petUuid) {
    const progress = await this._loadProgress(discordId);
    const pet = this._findPet(progress, petUuid);
    if (!pet) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物", 404);
    progress.activePetUuid = petUuid;
    // 出戰時重置採集計時起點
    pet.lastSettleAt = nowMs();
    pet.lastSatietyAt = nowMs();
    await this.progressRepository.save(progress);
    return { activePetUuid: petUuid, pet: this._toView(pet) };
  }

  // ── 放生（移除寵物，無任何回饋） ──
  async releasePet(discordId, petUuid) {
    const progress = await this._loadProgress(discordId);
    const pet = this._findPet(progress, petUuid);
    if (!pet) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物", 404);
    const released = this._toView(pet);
    progress.pets = progress.pets.filter((p) => p && p.uuid !== petUuid);
    if (progress.activePetUuid === petUuid) {
      // 出戰中被放生 → 自動換成剩下第一隻（沒有就清空）
      progress.activePetUuid = progress.pets[0]?.uuid || null;
    }
    await this.progressRepository.save(progress);
    return { released };
  }

  // ── 改名 ──
  async renamePet(discordId, petUuid, nickname) {
    const progress = await this._loadProgress(discordId);
    const pet = this._findPet(progress, petUuid);
    if (!pet) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物", 404);
    const name = String(nickname || "").trim().slice(0, 20);
    if (!name) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "暱稱不可為空", 400);
    pet.nickname = name;
    await this.progressRepository.save(progress);
    return { pet: this._toView(pet) };
  }

  // ── 把 inventory 內的蛋變成 progress.pets[] 的蛋實例（從蛋孵起） ──
  async hatchEggFromInventory(discordId, inventoryUuid) {
    const progress = await this._loadProgress(discordId);
    const idx = progress.inventory.findIndex((x) => x && x.uuid === inventoryUuid && x.itemType === "pet_egg");
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物蛋", 404);
    const egg = progress.inventory[idx];

    // 通用「神秘龍蛋」：孵化前不決定種類，petId 留 null，孵化達門檻時才 roll
    const now = nowMs();
    const petInstance = {
      uuid: crypto.randomUUID(),
      petId: null,
      species: null,
      speciesName: null,
      gatherMod: null,
      nickname: null,
      stage: "egg",
      level: 1,
      growthExp: 0,
      satiety: SATIETY_MAX,
      hatchProgress: 0,
      hatchThreshold: HATCH_THRESHOLD,
      lastSatietyAt: now,
      lastSettleAt: now,
      accruedItems: [],
      bornAt: isoNow(),
    };
    progress.pets.push(petInstance);
    // 從 inventory 扣一顆蛋（蛋可堆疊）
    if ((egg.stackCount || 1) > 1) egg.stackCount = egg.stackCount - 1;
    else progress.inventory.splice(idx, 1);

    // 孵蛋一律自動切換出戰到新蛋（舊寵物保留但停止採集，可由「出戰/更換」切回）
    const previousActiveUuid = progress.activePetUuid || null;
    const hadOtherActive = previousActiveUuid && previousActiveUuid !== petInstance.uuid;
    progress.activePetUuid = petInstance.uuid;
    petInstance.lastSettleAt = now;
    petInstance.lastSatietyAt = now;

    let benchedPet = null;
    if (hadOtherActive) {
      const prev = progress.pets.find((p) => p && p.uuid === previousActiveUuid);
      if (prev) benchedPet = this._toView(prev);
    }

    await this.progressRepository.save(progress);
    return {
      pet: this._toView(petInstance),
      becameActive: true,
      benchedPet,              // 被換下來的舊寵物（null = 本來就沒有）
      totalPets: progress.pets.length,
    };
  }
}

module.exports = { PetService, HATCH_THRESHOLD, MAX_LEVEL, BASE_FEED_EXP, petMatchingTier, feedMultiplier, tierForPetLevel };
