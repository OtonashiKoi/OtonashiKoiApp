"use strict";

const crypto = require("crypto");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { notifyPlayer } = require("../realtime/playerNotifyService");
const { withPlayerProgressLock } = require("../progress/progressLocks");

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

// Model A：孵化時「位階」獨立 roll（決定強度；品種只決定外觀/被動）。無 S。可調。
const PET_TIER_ROLL = [["D", 60], ["C", 27], ["B", 10], ["A", 3]];
function rollPetTier() {
  let r = Math.random() * 100;
  for (const [t, w] of PET_TIER_ROLL) { r -= w; if (r <= 0) return t; }
  return "D";
}

// V0.4 改版：寵物階級「孵化時就定死」＝物種稀有度（D/C/B/A），沒有等級/進化系統。
// 蛋階段一律視為 D（餵便宜的 D 裝孵化）。
function petTierOf(pet) {
  if (!pet || pet.stage === "egg") return "D";
  const t = String(pet.rarity || "D").toUpperCase();
  return TIER_RANK[t] != null ? t : "D";
}

// 食量分階：階級越高吃越多（滿飽食能撐的小時數，越高階掉越快）
const HUNGER_GRACE_HOURS_BY_TIER = { D: 16, C: 12, B: 9, A: 6 };

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

const MAX_LEVEL = 50;                   // legacy（V0.4 起無等級系統，僅供舊資料相容）
const HATCH_THRESHOLD = 800;            // 約 20 件 D 裝
const SATIETY_MAX = 100;
const HUNGER_GRACE_HOURS = 12;          // fallback（正式值走 HUNGER_GRACE_HOURS_BY_TIER 食量分階）
const GATHER_INTERVAL_MIN = 20;         // 基礎間隔（每 20 分 1 個），各種類以 intervalMult 調整
const GATHER_CAP = 18;                  // 最多累積 18 個（6 小時量）
const GEM_DROP_RATE = 0.7;              // 預設強化石比例（無 modifier 時 fallback）
const MAX_PETS = 20;                    // 寵物欄位上限（含孵化中）；超過要放生/上架才能再孵。蛋在背包可疊、不佔此上限。

// 採集階級順序（高一階用）
const TIER_ORDER = ["D", "C", "B", "A"];
function tierUp(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : tier;
}
// 預設 modifier（孵化前/無種類資料時）
const DEFAULT_GATHER_MOD = { intervalMult: 1.0, gemBias: GEM_DROP_RATE, qualityUpChance: 0 };

// 採集產出對應道具（lootTable 用）：金幣袋按寵物階級給 小(D)/中(C)/大(B/A)
const GOLD_POUCH_BY_TIER = {
  D: "63ca559b-ca12-4835-a48d-2150e366f60e", // 金幣袋子(小)
  C: "71aaa3a2-abb9-4b01-b024-16e553b08840", // 金幣袋子(中)
  B: "1854a2b1-a569-4604-802d-9171f480a9ae", // 金幣袋子(大)
  A: "1854a2b1-a569-4604-802d-9171f480a9ae", // 金幣袋子(大)
};
const CURSE_POTION_ID = "9b8ad195-9ec1-401b-9b7f-2c1033628cba"; // 【 我命由我不由天 】藥水（史萊姆撿到的詛咒垃圾）

function nowMs() { return Date.now(); }
function isoNow() { return new Date().toISOString(); }

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

  // 🐾寵物圖鑑（Model A：品種 × 位階 網格）＋ 收集分數/里程碑加成。以永久登錄 progress.petDex 為準。
  async getPetDex(discordId) {
    const { PET_TIERS, DEX_MILESTONES, computeDexBonuses } = require("../../shared/petDex");
    const progress = await this._loadProgress(discordId);
    const petDex = (progress.petDex && typeof progress.petDex === "object") ? progress.petDex : {};
    const allSpecies = await this.petRepository.findAll().catch(() => []);
    const species = (allSpecies || [])
      .slice()
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))
      .map((sp) => {
        const tiers = PET_TIERS.map((t) => ({ tier: t, collected: Boolean(petDex[`${sp.id}:${t}`]) }));
        const any = tiers.some((t) => t.collected);
        return {
          id: sp.id, seq: sp.seq || 0, eggType: sp.eggType || "dragon",
          // 收集過任一位階才揭曉品種名/圖；完全沒收集 → 前端顯示 ???
          name: any ? sp.name : null,
          imageUrl: any ? (sp.imageUrl || null) : null,
          imageThumbnailUrl: any ? (sp.imageThumbnailUrl || null) : null,
          tiers
        };
      });
    const dex = computeDexBonuses(petDex, (allSpecies || []).length);
    return { species, milestones: DEX_MILESTONES, ...dex };
  }

  // ── 懶結算：飽食度衰減 + 飢餓掉等 ──
  // 規則：餵飽（飽食滿）後可放置 12 小時不掉等；超過後飽食歸零、開始掉 level/exp
  _applyHungerDecay(pet) {
    const now = nowMs();
    const last = Number(pet.lastSatietyAt || pet.lastSettleAt || now);
    const elapsedHr = Math.max(0, (now - last) / 3_600_000);
    if (elapsedHr <= 0) return pet;

    // 飽食度每小時下降固定量；食量分階：滿值 D 撐 16h / C 12h / B 9h / A 6h（越高階越會吃）。
    // V0.4 改版：沒有等級系統 → 餓壞不再掉等，懲罰只有「停止採集＋戰鬥加成停用」。
    const graceHours = HUNGER_GRACE_HOURS_BY_TIER[petTierOf(pet)] || HUNGER_GRACE_HOURS;
    const SATIETY_DECAY_PER_HOUR = SATIETY_MAX / graceHours;
    const prevSatiety = Number(pet.satiety) || 0;
    pet.satiety = Math.max(0, prevSatiety - elapsedHr * SATIETY_DECAY_PER_HOUR);
    pet.starveSince = null;
    pet.starveLevelsLost = 0;
    pet.lastSatietyAt = now;
    return pet;
  }

  // 採集產出階級：抽「自身階級含以下」（自身階級 50%、其餘往下均分），
  // qualityUpChance 把抽到的結果 +1 階（黑曜/黃金龍的質感天賦），上限不超過自身階級。
  _rollGatherTierForClaim(pet) {
    const mod = pet.gatherMod || DEFAULT_GATHER_MOD;
    const capTier = petTierOf(pet);
    const capIdx = TIER_ORDER.indexOf(capTier);
    let tier;
    if (capIdx <= 0) {
      tier = "D";
    } else if (Math.random() < 0.5) {
      tier = capTier; // 一半機率直接出自身階級
    } else {
      tier = TIER_ORDER[Math.floor(Math.random() * capIdx)]; // 其餘往下均分
    }
    const qualityUp = Number(mod.qualityUpChance) || 0;
    if (qualityUp > 0 && Math.random() < qualityUp) {
      const upped = tierUp(tier);
      if (TIER_ORDER.indexOf(upped) <= capIdx) tier = upped; // 不可超過自身階級
    }
    return tier;
  }

  // ── 懶結算：採集累積（依該龍 gatherMod：速度 / 產出偏好）──
  // 階級在「領取時」依寵物當下等級決定，避免升級前累積的採集物卡在舊階級。
  // 🐾圖鑑收集里程碑 → 採集加成倍率（採集量%+採集速度% 都化成「間隔縮短」）。只看 petDex 分數，不查 DB。
  _dexGatherMult(progress) {
    try {
      const { computeDexBonuses } = require("../../shared/petDex");
      const { bonus } = computeDexBonuses(progress?.petDex || {});
      return 1 + ((Number(bonus.gatherPct) || 0) + (Number(bonus.gatherSpeedPct) || 0)) / 100;
    } catch (_) { return 1; }
  }

  _settleGathering(pet, gatherMult = 1) {
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
    // 圖鑑里程碑加成：倍率越高 → 間隔越短 → 採集越多越快
    const intervalMin = GATHER_INTERVAL_MIN * (Number(mod.intervalMult) || 1) / Math.max(0.1, Number(gatherMult) || 1);
    const elapsedMin = Math.max(0, (now - last) / 60_000);
    const newItems = Math.floor(elapsedMin / intervalMin);
    if (newItems <= 0) return pet;

    const room = Math.max(0, GATHER_CAP - pet.accruedItems.length);
    const toAdd = Math.min(newItems, room);
    // lootTable 模式（史萊姆/狼系）：[{kind, weight}] 加權抽；無 lootTable 走舊 gemBias（龍系）
    const lootTable = Array.isArray(mod.lootTable) && mod.lootTable.length ? mod.lootTable : null;
    const gemBias = Number.isFinite(Number(mod.gemBias)) ? Number(mod.gemBias) : GEM_DROP_RATE;
    for (let i = 0; i < toAdd; i++) {
      let kind;
      if (lootTable) {
        const total = lootTable.reduce((s, e) => s + Math.max(0, Number(e.weight) || 0), 0);
        let roll = Math.random() * (total || 1);
        kind = lootTable[lootTable.length - 1].kind;
        for (const e of lootTable) {
          roll -= Math.max(0, Number(e.weight) || 0);
          if (roll <= 0) { kind = e.kind; break; }
        }
      } else {
        kind = Math.random() < gemBias ? "gem" : "equipment";
      }
      pet.accruedItems.push({ kind });
    }
    pet.lastSettleAt = last + newItems * intervalMin * 60_000;
    if (pet.accruedItems.length >= GATHER_CAP) pet.lastSettleAt = now; // 滿了就對齊
    return pet;
  }

  // ── 採集滿 18 個通知：剛到頂發一次，領取後（低於上限）重置旗標 ──
  _maybeNotifyGatherCap(discordId, pet) {
    try {
      if (!pet || pet.stage !== "grown") return;
      const count = Array.isArray(pet.accruedItems) ? pet.accruedItems.length : 0;
      if (count >= GATHER_CAP) {
        if (!pet.gatherCapNotified) {
          pet.gatherCapNotified = true; // 旗標隨 progress 落地，避免重複通知
          notifyPlayer(discordId, {
            type: "pet_gather_full",
            title: "寵物採集已滿",
            message: `「${pet.nickname || pet.speciesName || "寵物"}」的採集已累積 ${count}/${GATHER_CAP} 個，記得來領取！`,
            meta: { petUuid: pet.uuid, gatherCount: count, gatherCap: GATHER_CAP }
          });
        }
      } else if (pet.gatherCapNotified) {
        pet.gatherCapNotified = false; // 已領取（低於上限）→ 下次滿了再提醒一次
      }
    } catch (_) { /* 通知失敗不影響主流程 */ }
  }

  // ── 對外：查詢寵物狀態（含懶結算） ──
  async getPetState(discordId) {
    const progress = await this._loadProgress(discordId);
    const active = this._getActivePet(progress);
    let changed = false;
    if (active) {
      this._applyHungerDecay(active);
      this._settleGathering(active, this._dexGatherMult(progress));
      this._maybeNotifyGatherCap(discordId, active);
      changed = true;
    }
    if (changed) await this.progressRepository.save(progress);

    const eggCount = progress.inventory.reduce((sum, item) => {
      if (!item || item.itemType !== "pet_egg") return sum;
      return sum + Math.max(1, Number(item.stackCount) || 1);
    }, 0);
    return {
      pets: progress.pets.map((p) => this._toView(p)),
      activePetUuid: progress.activePetUuid || null,
      active: active ? this._toView(active) : null,
      eggCount,
      totalPets: Array.isArray(progress.pets) ? progress.pets.length : 0,
      maxPets: MAX_PETS,
    };
  }

  // 狼系戰鬥加成 → 中文摘要（給面板顯示；無則 null）
  _combatSummary(pet) {
    if (!Array.isArray(pet.combatPassives) || !pet.combatPassives.length) return null;
    const LABEL = {
      atk_up: "攻擊", final_damage_up: "最終傷害", crit_rate_up: "爆擊率", combo_up: "連擊率",
      dodge_up: "迴避", physical_damage_reduction: "物理減傷", magic_damage_reduction: "魔法減傷",
    };
    const parts = [];
    for (const e of pet.combatPassives) {
      if (e.key === "echo_strike") {
        parts.push(`${e.params?.chance || 0}% 咬擊追打（${e.params?.value || 0}%）`);
      } else if (LABEL[e.key]) {
        const pct = /reduction|final_damage|atk_up/.test(e.key) ? "%" : "";
        parts.push(`${LABEL[e.key]} +${e.params?.value || 0}${pct}`);
      }
    }
    return parts.length ? parts.join("、") : null;
  }

  _toView(pet) {
    const hatchPct = pet.stage === "egg"
      ? Math.min(100, Math.round(((pet.hatchProgress || 0) / HATCH_THRESHOLD) * 100))
      : 100;
    const mod = pet.gatherMod || DEFAULT_GATHER_MOD;
    return {
      uuid: pet.uuid,
      petId: pet.petId || null,
      eggType: String(pet.eggType || "dragon").toLowerCase(), // 蛋種：dragon/slime/wolf（決定 emoji）
      combatBonus: pet.stage === "grown" ? this._combatSummary(pet) : null, // 狼系戰鬥加成摘要
      species: pet.species || null,
      speciesName: pet.stage === "egg" ? null : (pet.speciesName || null), // 蛋階段不揭曉種類
      // 蛋階段不揭曉圖片
      imageUrl: pet.stage === "egg" ? null : (pet.imageUrl || null),
      imageThumbnailUrl: pet.stage === "egg" ? null : (pet.imageThumbnailUrl || null),
      rarity: pet.rarity || null,
      nickname: pet.nickname || null,
      stage: pet.stage,
      level: pet.level || 1, // legacy 欄位（V0.4 起無等級系統，UI 顯示以 tier 為準）
      tier: petTierOf(pet),  // 階級＝物種稀有度（孵化時定死）
      feedTier: petTierOf(pet), // 餵食對應階級（蛋=D）
      growthExp: 0,
      expToNext: 0,
      satiety: Math.round(pet.satiety || 0),
      satietyMax: SATIETY_MAX,
      satietyHours: HUNGER_GRACE_HOURS_BY_TIER[petTierOf(pet)] || HUNGER_GRACE_HOURS, // 滿飽食可撐小時數（食量分階）
      hatchPct,
      hatchProgress: pet.hatchProgress || 0,
      hatchThreshold: HATCH_THRESHOLD,
      gatherCount: Array.isArray(pet.accruedItems) ? pet.accruedItems.length : 0,
      gatherCap: GATHER_CAP,
      producesTier: petTierOf(pet),
      // 採集特性（已孵化才有意義）
      gatherIntervalMin: pet.stage === "grown" ? Math.round(GATHER_INTERVAL_MIN * (Number(mod.intervalMult) || 1)) : null,
      gemBias: pet.stage === "grown" ? (Number.isFinite(Number(mod.gemBias)) ? Number(mod.gemBias) : GEM_DROP_RATE) : null,
      qualityUpChance: pet.stage === "grown" ? (Number(mod.qualityUpChance) || 0) : null,
    };
  }

  // ── 餵食（單件或批量；先補飽食，滿後轉成長 exp / 孵化進度） ──
  // opts: { inventoryUuid } 餵單件 | { tier } 餵 inventory 內所有該階裝備
  async feedPet(discordId, petUuid, opts = {}) {
    // 預覽(dry-run)不寫入,不需上鎖；實際餵食上鎖序列化,避免並發餵食複製飼料/重複套加成。
    if (opts.preview) return this._feedPetImpl(discordId, petUuid, opts);
    return withPlayerProgressLock(discordId, () => this._feedPetImpl(discordId, petUuid, opts));
  }

  async _feedPetImpl(discordId, petUuid, opts = {}) {
    const progress = await this._loadProgress(discordId);
    const pet = this._findPet(progress, petUuid);
    if (!pet) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物", 404);

    this._applyHungerDecay(pet);

    // 寵物對應階級（＝稀有度；蛋階段 → D）
    const matchTier = petTierOf(pet);

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
    } else if (Array.isArray(opts.inventoryUuids) && opts.inventoryUuids.length) {
      // 勾選餵食：只餵清單中、且可餵的裝備（排除卡片/徽章/階級太高）
      const set = new Set(opts.inventoryUuids);
      const picked = progress.inventory.filter((x) => x && set.has(x.uuid));
      feedTargets = picked.filter((it) => isSingleFeedable(it) && feedMultiplier(it.tier, matchTier) !== null);
      protectedCount = picked.length - feedTargets.length;
      if (feedTargets.length === 0) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "所選道具都不能餵（卡片/徽章/階級太高）", 400);
      }
    } else if (opts.tier) {
      const tier = String(opts.tier).toUpperCase();
      if (feedMultiplier(tier, matchTier) === null) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${tier} 階裝備太高級，餵不進對應 ${matchTier} 階的寵物`, 400);
      }
      const tierGear = progress.inventory.filter((x) => x && x.itemType === "equipment" && String(x.tier).toUpperCase() === tier);
      // includeEnhanced=true：連有 +值的強化裝也餵（仍排除卡片/徽章/稱號）；否則只餵素裝
      feedTargets = opts.includeEnhanced
        ? tierGear.filter(isSingleFeedable)
        : tierGear.filter(isBatchFeedable);
      protectedCount = tierGear.length - feedTargets.length;         // 卡片徽章（或未含強化時的 +值裝）→ 保護
      if (feedTargets.length === 0) {
        const hint = protectedCount > 0 ? `（有 ${protectedCount} 件受保護：卡片/徽章${opts.includeEnhanced ? "" : "或有 +值"}）` : "";
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `背包沒有可一鍵餵的 ${tier} 階裝備${hint}`, 400);
      }
    } else {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "未指定餵食對象", 400);
    }

    // V0.4：沒有等級系統 → 餵食只有兩個用途：蛋=累積孵化進度、已孵化=補飽食度。
    let totalSatiety = 0, totalGrowth = 0, totalHatch = 0, fed = 0;
    const consumedUuids = new Set();
    const leveledTo = null;          // legacy 欄位（無等級系統）
    const tierCapReached = false;    // legacy 欄位

    for (const it of feedTargets) {
      const tier = String(it.tier || "D").toUpperCase();
      const mult = feedMultiplier(tier, matchTier);
      if (mult === null) continue; // 高階裝備跳過（批量時保險）
      const satietyGain = Math.round(BASE_FEED_SATIETY * mult);
      const expGain = Math.round(BASE_FEED_EXP * mult);

      if (pet.stage === "egg") {
        // 蛋階段：餵食累積孵化進度
        pet.hatchProgress = (pet.hatchProgress || 0) + expGain;
        totalHatch += expGain;
        consumedUuids.add(it.uuid);
        fed++;
        // 累積到孵化門檻就停止繼續吃，剩餘飼料留背包不浪費
        if ((pet.hatchProgress || 0) >= HATCH_THRESHOLD) break;
      } else {
        // 已孵化：只補飽食度；已滿就不再吃（不浪費裝備）
        const before = Number(pet.satiety) || 0;
        if (before >= SATIETY_MAX) break;
        const after = Math.min(SATIETY_MAX, before + satietyGain);
        pet.satiety = after;
        pet.starveSince = null; pet.starveLevelsLost = 0;
        totalSatiety += after - before;
        consumedUuids.add(it.uuid);
        fed++;
        if (after >= SATIETY_MAX) break;
      }
    }

    // 孵化判定（達門檻 → 隨機開獎決定種類）
    let hatched = false;
    let hatchedSpecies = null;
    if (pet.stage === "egg" && (pet.hatchProgress || 0) >= HATCH_THRESHOLD) {
      const rolled = await this._rollSpecies(pet.eggType || "dragon");
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
        pet.rarity = rollPetTier(); // Model A：位階獨立 roll，決定強度（品種決定外觀/被動）
        pet.gatherMod = rolled.gather || { ...DEFAULT_GATHER_MOD };
        pet.combatPassives = Array.isArray(rolled.combatPassives) && rolled.combatPassives.length ? rolled.combatPassives : null; // 狼系戰鬥夥伴被動
        if (!pet.nickname) pet.nickname = rolled.name; // 預設用種類名
        hatchedSpecies = rolled.name;
        // 🐾圖鑑登錄：品種×位階，孵到就永久登錄（賣掉/放生都還在，只加不減）
        progress.petDex = (progress.petDex && typeof progress.petDex === "object") ? progress.petDex : {};
        const _dexKey = `${rolled.id}:${pet.rarity}`;
        if (!progress.petDex[_dexKey]) progress.petDex[_dexKey] = new Date().toISOString();
      }
      hatched = true;
    }

    // V0.4：階級孵化時定死，沒有跨階/進化事件（legacy 欄位回傳固定值供 UI 相容）
    const crossedTier = false;
    const gatherCleared = 0;
    const endTier = petTierOf(pet);

    // 預覽（dry-run）：不寫入 DB、不消耗背包，只回報「餵完後會變怎樣」
    if (opts.preview) {
      return {
        preview: true,
        willFeed: feedTargets.length, fed, protectedCount, totalSatiety, totalGrowth, totalHatch,
        hatched, hatchedSpecies, leveledTo, tierCapReached, crossedTier, gatherCleared, endTier,
        predictedLevel: pet.level || 1,
        predictedSatiety: Math.round(pet.satiety || 0),
        satietyMax: SATIETY_MAX,
        pet: this._toView(pet),
      };
    }

    // 消耗 inventory 裝備（只消耗實際吃下去的）
    progress.inventory = progress.inventory.filter((x) => !(x && consumedUuids.has(x.uuid)));
    pet.lastSatietyAt = nowMs();
    await this.progressRepository.save(progress);

    return {
      fed, protectedCount, totalSatiety, totalGrowth, totalHatch, hatched, hatchedSpecies, leveledTo,
      tierCapReached, crossedTier, gatherCleared, endTier,
      predictedLevel: pet.level || 1, predictedSatiety: Math.round(pet.satiety || 0), satietyMax: SATIETY_MAX,
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
    const matchTier = petTierOf(active);

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

    return {
      active: this._toView(active),
      matchTier,
      items,
      // 給前端算「剛好餵到下一個等級坎」的最少件數用
      growthExp: Math.round(active.growthExp || 0),
      levelupExp: 0,   // legacy（無等級系統）
      nextLevelCap: 0, // legacy（無等級系統）
      maxLevel: MAX_LEVEL,
      baseFeedSatiety: BASE_FEED_SATIETY,
      baseFeedExp: BASE_FEED_EXP
    };
  }

  // ── 孵化開獎：依 hatchWeight 從 pets 種類隨機抽一種 ──
  async _rollSpecies(eggType = "dragon") {
    const all = await this.petRepository.findAll();
    // 蛋種分池：模板 eggType 對上蛋的 eggType 才進池（舊龍模板無欄位 → 視為 dragon）
    const wanted = String(eggType || "dragon").toLowerCase();
    const pool = (all || []).filter((p) => p && p.id && String(p.eggType || "dragon").toLowerCase() === wanted);
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
  // 以 CAS（saveIfUnchanged）重試：避免與其他 progress 寫入（戰鬥獎勵、其他分頁）併發時
  // 整份覆寫互相覆蓋，導致「領取訊息顯示拿到，但實際背包沒有」的漏拿問題。
  async claimGathering(discordId) {
    const CAS_MAX_RETRIES = 6;
    const allItems = await this.itemRepository.findAll();

    for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
      const progress = await this._loadProgress(discordId);
      const prevUpdatedAt = progress.updatedAt;
      const active = this._getActivePet(progress);
      if (!active) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "目前沒有出戰寵物", 400);
      this._applyHungerDecay(active);
      this._settleGathering(active, this._dexGatherMult(progress));

      // 飽食歸零(餓壞了)不能領取採集物:必須先餵食。網頁與 DC 共用此方法 → 兩邊規則一致。
      if ((Number(active.satiety) || 0) <= 0) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "寵物餓壞了，餵飽後才能領取採集物 🍖", 400);
      }

      const items = Array.isArray(active.accruedItems) ? active.accruedItems : [];
      if (items.length === 0) {
        // 沒有可領取的，仍以 CAS 寫回（settle/飽食可能有變動）；失敗就重試
        const ok = typeof this.progressRepository.saveIfUnchanged === "function"
          ? await this.progressRepository.saveIfUnchanged(progress, prevUpdatedAt)
          : (await this.progressRepository.save(progress), true);
        if (!ok) continue;
        return { granted: [], pet: this._toView(active) };
      }

      const granted = [];
      for (const acc of items) {
        const tier = this._rollGatherTierForClaim(active);
        let entry = null;
        if (acc.kind === "gem") {
          const gemId = GEM_ID_BY_TIER[tier] || GEM_ID_BY_TIER.D;
          const gem = allItems.find((it) => it.id === gemId);
          if (gem) entry = this._buildInventoryEntry(gem);
        } else if (acc.kind === "gold") {
          // 金幣袋（按寵物階級 小/中/大）
          const pouchId = GOLD_POUCH_BY_TIER[tier] || GOLD_POUCH_BY_TIER.D;
          const pouch = allItems.find((it) => it.id === pouchId);
          if (pouch) entry = this._buildInventoryEntry(pouch);
        } else if (acc.kind === "curse") {
          // 詛咒彩蛋：我命由我不由天（史萊姆亂撿東西）
          const curse = allItems.find((it) => it.id === CURSE_POTION_ID);
          if (curse) entry = this._buildInventoryEntry(curse);
        } else {
          // 隨機該階「一般裝備」：排除 noPetGather（世界王卡等）、所有卡片（monsterCardSkill/monsterCardOf）、
          // 特殊槽位（special/稱號/職業徽章/錨點）— 寵物只撿得到普通裝備
          const pool = allItems.filter((it) =>
            it.itemType === "equipment" &&
            String(it.tier).toUpperCase() === tier &&
            !it.noPetGather &&
            !it.monsterCardSkill && !it.monsterCardOf &&
            !/^special/.test(String(it.equipSlot || "")) &&
            !["title_eq", "job_eq", "anchor"].includes(String(it.equipSlot || "")));
          if (pool.length) entry = this._buildInventoryEntry(pool[crypto.randomInt(0, pool.length)]);
        }
        if (entry) {
          progress.inventory.push(entry);
          granted.push({ itemName: entry.itemName, tier, kind: acc.kind });
        }
      }
      active.accruedItems = [];
      active.lastSettleAt = nowMs();
      active.gatherCapNotified = false; // 已領取 → 重置滿載通知旗標

      // CAS 寫回：成功才回報 granted（確保訊息＝實際入包）；失敗代表被併發覆寫，重新載入重 roll
      const ok = typeof this.progressRepository.saveIfUnchanged === "function"
        ? await this.progressRepository.saveIfUnchanged(progress, prevUpdatedAt)
        : (await this.progressRepository.save(progress), true);
      if (!ok) continue;
      return { granted, pet: this._toView(active) };
    }

    // 連續多次都被併發寫入卡住（罕見）：不謊報領取，請玩家重試
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "領取忙線中，請稍候再按一次領取。", 409);
  }

  // ── 狼系戰鬥夥伴：把出戰寵物變成「虛擬裝備」給戰鬥引擎（數值被動走 calcPlayerStats、
  //    咬擊追打走 combatLoop 現成 echo_strike hook）。read-only：不改 progress。
  //    生效條件：出戰中、已孵化、模板有 combatPassives、且「沒餓壞」（飽食估算 > 0）。
  //    加成隨寵物階級縮放：D 40% / C 60% / B 80% / A 100%（進化有感）。
  buildPetCombatEntry(progress) {
    try {
      const pet = this._getActivePet(progress);
      if (!pet || pet.stage !== "grown") return null;
      const passives = Array.isArray(pet.combatPassives) ? pet.combatPassives : null;
      if (!passives || !passives.length) return null;
      // 飽食讀時估算（不落地，按食量分階衰減）：餓壞的狼不幫你打
      const tier = petTierOf(pet);
      const graceHours = HUNGER_GRACE_HOURS_BY_TIER[tier] || HUNGER_GRACE_HOURS;
      const decayPerMs = (SATIETY_MAX / graceHours) / 3_600_000;
      const effSatiety = (Number(pet.satiety) || 0) - Math.max(0, nowMs() - Number(pet.lastSatietyAt || nowMs())) * decayPerMs;
      if (effSatiety <= 0) return null;
      // 階級孵化時定死 → 數值直接寫在物種模板（不再按等級縮放），深拷貝避免污染模板
      const scaled = passives.map((eff) => JSON.parse(JSON.stringify(eff)));
      return {
        itemId: `pet-companion-${pet.petId || "unknown"}`,
        itemName: `${pet.nickname || pet.speciesName || "寵物"}（戰鬥夥伴）`,
        itemType: "equipment",
        equipSlot: "pet_companion",
        tier,
        equipStats: null,
        passiveEffects: scaled,
        procEffects: [], combatEffects: [], useEffects: [],
      };
    } catch (_) { return null; }
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
      // 帶上怪物卡技能欄位，否則寵物採集到的卡片會被歸到「特殊」而非「卡片」分類
      monsterCardSkill: item.monsterCardSkill || null,
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
    const previousActive = this._getActivePet(progress);
    if (previousActive && previousActive.uuid !== petUuid) {
      this._applyHungerDecay(previousActive);
      this._settleGathering(previousActive, this._dexGatherMult(progress));
    }
    progress.activePetUuid = petUuid;
    // 切上前台後才開始計採集時間；既有累積物不清空。
    if (!previousActive || previousActive.uuid !== petUuid) pet.lastSettleAt = nowMs();
    pet.lastSatietyAt = nowMs();
    await this.progressRepository.save(progress);
    return { activePetUuid: petUuid, pet: this._toView(pet) };
  }

  // ── 取消出戰（變成沒有出戰寵物） ──
  async deactivatePet(discordId) {
    const progress = await this._loadProgress(discordId);
    const previousActive = this._getActivePet(progress);
    if (previousActive) {
      this._applyHungerDecay(previousActive);
      this._settleGathering(previousActive, this._dexGatherMult(progress));
    }
    progress.activePetUuid = null;
    await this.progressRepository.save(progress);
    return { activePetUuid: null };
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
    // 上鎖序列化:避免並發孵化同一顆蛋 → 一顆蛋孵出兩隻寵物的複製。
    return withPlayerProgressLock(discordId, () => this._hatchEggFromInventoryImpl(discordId, inventoryUuid));
  }

  async _hatchEggFromInventoryImpl(discordId, inventoryUuid) {
    const progress = await this._loadProgress(discordId);
    // 寵物欄位上限（含孵化中）：滿了必須先放生或上架交易才能再孵蛋
    if (Array.isArray(progress.pets) && progress.pets.length >= MAX_PETS) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `寵物已達上限 ${MAX_PETS} 隻，請先放生或上架交易一隻再孵蛋（蛋放在背包不佔上限）`, 400);
    }
    const idx = progress.inventory.findIndex((x) => x && x.uuid === inventoryUuid && x.itemType === "pet_egg");
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物蛋", 404);
    const egg = progress.inventory[idx];

    // 通用神秘蛋：孵化前不決定種類，petId 留 null，孵化達門檻時才依蛋種(eggType)分池 roll。
    // 蛋種來源：inventory 蛋條目 → items 庫該蛋道具 → 預設 dragon(相容既有神秘龍蛋)。
    let eggType = egg.eggType || null;
    if (!eggType && egg.itemId && this.itemRepository) {
      const eggLib = await this.itemRepository.findById(egg.itemId).catch(() => null);
      eggType = eggLib?.eggType || null;
    }
    const now = nowMs();
    const petInstance = {
      uuid: crypto.randomUUID(),
      eggType: String(eggType || "dragon").toLowerCase(),
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
    if (hadOtherActive) {
      const prev = progress.pets.find((p) => p && p.uuid === previousActiveUuid);
      if (prev) {
        this._applyHungerDecay(prev);
        this._settleGathering(prev, this._dexGatherMult(progress));
      }
    }
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

module.exports = { PetService, HATCH_THRESHOLD, MAX_LEVEL, MAX_PETS, BASE_FEED_EXP, GATHER_INTERVAL_MIN, GATHER_CAP, feedMultiplier, petTierOf };
