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

// 飼料 exp（依裝備階級）：D 最多、A 最少
const FEED_EXP_BY_TIER = { D: 40, C: 25, B: 15, A: 8 };
// 飽食度補充（依裝備階級）
const FEED_SATIETY_BY_TIER = { D: 25, C: 18, B: 12, A: 8 };

const MAX_LEVEL = 50;
const HATCH_THRESHOLD = 800;            // 約 20 件 D 裝
const SATIETY_MAX = 100;
const HUNGER_GRACE_HOURS = 12;          // 餵飽後 12 小時不掉等
const GATHER_INTERVAL_MIN = 20;         // 每 20 分鐘 1 個（= 3 個/小時）
const GATHER_CAP = 18;                  // 最多累積 18 個（6 小時量）
const GEM_DROP_RATE = 0.7;              // 採集 70% 強化石 / 30% 裝備
const LEVELUP_EXP_PER_LEVEL = 120;      // 每級所需成長 exp

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

  // ── 懶結算：採集累積 ──
  _settleGathering(pet) {
    if (pet.stage !== "grown") return pet; // 未孵化不採集
    const now = nowMs();
    const last = Number(pet.lastSettleAt || now);
    if (!Array.isArray(pet.accruedItems)) pet.accruedItems = [];

    // 飽食 0 不採集：以 min(now, 飽食歸零時刻) 為結算上界（簡化：飽食>0 才計）
    if ((Number(pet.satiety) || 0) <= 0) {
      pet.lastSettleAt = now;
      return pet;
    }
    const elapsedMin = Math.max(0, (now - last) / 60_000);
    const newItems = Math.floor(elapsedMin / GATHER_INTERVAL_MIN);
    if (newItems <= 0) return pet;

    const room = Math.max(0, GATHER_CAP - pet.accruedItems.length);
    const toAdd = Math.min(newItems, room);
    const tier = tierForPetLevel(pet.level || 1);
    for (let i = 0; i < toAdd; i++) {
      const kind = Math.random() < GEM_DROP_RATE ? "gem" : "equipment";
      pet.accruedItems.push({ tier, kind });
    }
    // 推進 lastSettleAt（只消耗已結算的時間，避免進位丟失）
    pet.lastSettleAt = last + newItems * GATHER_INTERVAL_MIN * 60_000;
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
    return {
      uuid: pet.uuid,
      petId: pet.petId,
      nickname: pet.nickname || null,
      stage: pet.stage,
      level: pet.level || 1,
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
    };
  }

  // ── 餵食（單件或批量；先補飽食，滿後轉成長 exp / 孵化進度） ──
  // opts: { inventoryUuid } 餵單件 | { tier } 餵 inventory 內所有該階裝備
  async feedPet(discordId, petUuid, opts = {}) {
    const progress = await this._loadProgress(discordId);
    const pet = this._findPet(progress, petUuid);
    if (!pet) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物", 404);

    this._applyHungerDecay(pet);

    // 選出要餵的裝備（只接受 itemType==="equipment"）
    let feedTargets = [];
    if (opts.inventoryUuid) {
      const it = progress.inventory.find((x) => x && x.uuid === opts.inventoryUuid);
      if (!it) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該道具", 404);
      if (it.itemType !== "equipment") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只能餵食裝備", 400);
      feedTargets = [it];
    } else if (opts.tier) {
      const tier = String(opts.tier).toUpperCase();
      feedTargets = progress.inventory.filter((x) => x && x.itemType === "equipment" && String(x.tier).toUpperCase() === tier);
      if (feedTargets.length === 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `背包沒有 ${tier} 階裝備可餵`, 400);
    } else {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "未指定餵食對象", 400);
    }

    let totalSatiety = 0, totalGrowth = 0, totalHatch = 0, fed = 0;
    const consumedUuids = new Set();
    for (const it of feedTargets) {
      const tier = String(it.tier || "D").toUpperCase();
      const satietyGain = FEED_SATIETY_BY_TIER[tier] ?? FEED_SATIETY_BY_TIER.D;
      const expGain = FEED_EXP_BY_TIER[tier] ?? FEED_EXP_BY_TIER.D;

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

    // 孵化判定
    let hatched = false;
    if (pet.stage === "egg" && (pet.hatchProgress || 0) >= HATCH_THRESHOLD) {
      pet.stage = "grown";
      pet.level = 1;
      pet.growthExp = 0;
      pet.satiety = SATIETY_MAX;       // 孵化後給滿飽食
      pet.lastSatietyAt = nowMs();
      pet.lastSettleAt = nowMs();
      pet.accruedItems = [];
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
      fed, totalSatiety, totalGrowth, totalHatch, hatched, leveledTo,
      pet: this._toView(pet),
    };
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

    // 蛋對應的寵物種類：egg.petId（建蛋時寫入），否則用 itemId 當 fallback
    const petId = egg.petId || egg.itemId;
    const now = nowMs();
    const petInstance = {
      uuid: crypto.randomUUID(),
      petId,
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

    if (!progress.activePetUuid) progress.activePetUuid = petInstance.uuid; // 第一隻自動出戰
    await this.progressRepository.save(progress);
    return { pet: this._toView(petInstance) };
  }
}

module.exports = { PetService, HATCH_THRESHOLD, MAX_LEVEL, FEED_EXP_BY_TIER, tierForPetLevel };
