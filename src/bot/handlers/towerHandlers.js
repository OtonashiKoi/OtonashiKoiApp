"use strict";

// 🗼 爬塔總開關：false = 暫停開放。
//   已經貼在頻道的常駐面板不用刪，玩家點按鈕/選單會收到「暫停開放」的私訊提示。
//   戰鬥核心、房間、排行等程式碼全部保留（網頁組隊爬塔也共用這裡的核心），
//   要重新開放把這裡改回 true、並把 app 的 battle.tsx / leaderboard.tsx 的 TOWER_ENABLED 一起改 true。
const TOWER_ENABLED = false;

const { MessageFlags, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const config = require("../../config");
const { serviceContext, getBotClient } = require("../runtimeContext");
const { calcPlayerStats } = require("../../shared/combatStats");
const { mergeEquippedFromLibrary, applyEffectInstances, applyEffectsToStats, collectEquipmentEffects, isEffectConditionMet } = require("../../shared/effectEngine");
const { scaleSupportPartyEffect } = require("../../shared/supportAuraScaling");
const { runCombatLoop } = require("../../shared/combatLoop");
const { isWorldBossZone } = require("../../services/worldBoss/worldBossService");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { setTowerPresence, isTowerBattleActive } = require("../../shared/battlePresence");
const {
  TOWER_MAX_MEMBERS,
  TOWER_TOTAL_FLOORS,
  TOWER_FLOOR_BOSS,
  TOWER_LOBBY_TIMEOUT_MS,
  MAX_ROUNDS_PER_MEMBER,
  TOWER_MIN_LEVEL,
  TOWER_HOURLY_LIMIT,
  TOWER_HOURLY_WINDOW_MS,
  scaleTowerMonsterHp,
  scaleTowerMonsterAtk,
  getCumulativePartyBonus,
  calcTowerReward,
  getTowerClearBuff,
} = require("../../shared/towerConfig");
const {
  TOWER_IDS,
  createTowerHallMessage,
  createTowerThreadLobbyMessage,
  createTowerThreadBattleMessage,
  createTowerThreadResultMessage,
  createTowerRankingMessage,
} = require("../towerView");

// ── 記憶體狀態 ───────────────────────────────────────────────
// threadId → session
const activeSessions = new Map();
// discordId → threadId
const playerThreadMap = new Map();

// session.state:
//   "lobby"          → 等待加入
//   "ready_to_fight" → 等待隊長按「攻略下一層」
//   "fighting"       → 單層結算中（防重複按）
//   "done" | "failed"→ 結束

// ── Session 序列化（MongoDB 不支援 Set / Discord 物件）───────
function serializeSession(session) {
  return {
    threadId:        session.threadId,
    starterMessageId: session.starterMessage?.id || null,
    roomId:          session.roomId,
    leaderId:        session.leaderId,
    state:           session.state,
    members:         session.members,
    currentFloor:    session.currentFloor,
    clearedFloor:    session.clearedFloor,
    currentMonster:  session.currentMonster,
    lastFloorResult: session.lastFloorResult || null,
    floorResults:    Array.isArray(session.floorResults) ? session.floorResults : [],
    failReason:      session.failReason || null,
    savedAt:         new Date().toISOString(),
  };
}

async function persistSession(session) {
  try {
    const sc = serviceContext;
    await sc.towerSessionRepository.save(serializeSession(session));
  } catch (e) {
    console.error("[Tower] persistSession error:", e);
  }
}

async function deletePersistSession(threadId) {
  try {
    await serviceContext.towerSessionRepository.delete(threadId);
  } catch (_) {}
}

let _roomCounter = 0;
function genRoomId() {
  _roomCounter = (_roomCounter + 1) % 9999;
  return `T${String(_roomCounter).padStart(4, "0")}`;
}

// ── 職業偵測（依 job_eq 徽章）────────────────────────────────
const JOB_TRAITS = {
  swordsman:    { key: "swordsman", name: "劍士",   emoji: "⚔️",  traits: ["爬塔光環：隊伍受到傷害-5%", "單手劍/雙手劍強化", "前線防守"] },
  warrior:      { key: "warrior", name: "戰士",   emoji: "🪓",  traits: ["爬塔光環：高血怪傷害+5%", "斧系爆發", "火力檢定"] },
  dwarf_warrior:{ key: "dwarf_warrior", name: "矮人戰士",emoji: "🔨", traits: ["爬塔光環：全隊擊暈+5%", "暈眩目標傷害+10%", "控場破口"] },
  rogue:        { key: "rogue", name: "盜賊",   emoji: "🗡️",  traits: ["爬塔光環：隊伍連擊率+5%", "匕首連擊", "高速削血"] },
  mage:         { key: "mage", name: "法師",   emoji: "🪄",  traits: ["爬塔光環：隊伍無視DEF+5%", "法杖穿防", "高防對策"] },
  healer:       { key: "healer", name: "治療師", emoji: "💚",  traits: ["爬塔光環：每回合回復3% MaxHP", "跨層續航", "團隊支援"] },
  archer:       { key: "archer", name: "弓箭手", emoji: "🏹",  traits: ["爬塔光環：Boss/精英傷害+5%", "命中要害", "高血量狙擊"] },
  tactician:    { key: "tactician", name: "軍師",   emoji: "♟️",  traits: ["爬塔光環：隊伍傷害+5%", "Boss傷害+5%", "戰術指揮"] },
  bard:         { key: "bard", name: "詩人",   emoji: "🎼",  traits: ["爬塔光環：隊伍AGI+15%", "連擊率+5%", "行動軸支援"] },
  barrier_mage: { key: "barrier_mage", name: "結界師", emoji: "🛡️", traits: ["爬塔光環：隊伍減傷-10%", "MaxHP+8%", "防護結界"] },
  gambler:      { key: "gambler", name: "賭徒",   emoji: "🎲",  traits: ["爬塔光環：隊伍爆擊率+5%", "骰子吃 LUK", "高方差爆發"] },
  default:      { key: "default", name: "冒險者", emoji: "🧑",  traits: ["無職業加成"] },
};

function detectJob(equipped = {}) {
  const jobEq  = equipped?.job_eq || null;
  const jobId  = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const jobName = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();
  const has = (s) => jobId.includes(s) || jobName.includes(s);

  if (has("swordsman") || has("劍士")) return JOB_TRAITS.swordsman;
  if (has("dwarf") || has("矮人"))     return JOB_TRAITS.dwarf_warrior;
  if (has("warrior") || has("戰士"))   return JOB_TRAITS.warrior;
  if (has("archer") || has("弓箭手"))  return JOB_TRAITS.archer;
  if (has("healer") || has("治療師"))  return JOB_TRAITS.healer;
  if (has("tactician") || has("軍師"))  return JOB_TRAITS.tactician;
  if (has("bard") || has("詩人"))       return JOB_TRAITS.bard;
  if (has("barrier") || has("結界"))    return JOB_TRAITS.barrier_mage;
  if (has("mage") || has("法師"))      return JOB_TRAITS.mage;
  if (has("rogue") || has("盜賊"))     return JOB_TRAITS.rogue;
  if (has("gambler") || has("賭徒"))   return JOB_TRAITS.gambler;
  return JOB_TRAITS.default;
}

function towerPartyEffect(member, key, value, notes, mode = "pct") {
  return {
    key,
    trigger: "tower_aura",
    target: "party",
    chance: 100,
    stacks: 1,
    stackMode: "replace",
    duration: { mode: "battle", value: 1 },
    params: { value, mode },
    sourceName: member?.name || null,
    sourceJobName: member?.job?.name || null,
    sourceJobKey: member?.job?.key || null,
    notes,
  };
}

function getTowerJobAuraEffects(member) {
  const jobKey = member?.job?.key || "default";
  switch (jobKey) {
    case "swordsman":
      return [towerPartyEffect(member, "party_damage_reduction", 5, "爬塔：隊伍受到傷害 -5%")];
    case "warrior":
      return [towerPartyEffect(member, "party_high_hp_damage_up", 5, "爬塔：隊伍對 HP 50%以上怪物傷害 +5%")];
    case "dwarf_warrior":
      return [
        towerPartyEffect(member, "party_stun_chance_up", 8, "爬塔：全隊擊暈值 +8%"),
        towerPartyEffect(member, "party_stunned_damage_up", 12, "爬塔：對暈眩中的怪物傷害 +12%"),
      ];
    case "rogue":
      return [towerPartyEffect(member, "party_combo_up", 5, "爬塔：隊伍連擊率 +5%")];
    case "mage":
      return [towerPartyEffect(member, "party_def_ignore_up", 5, "爬塔：隊伍無視 DEF +5%")];
    case "archer":
      return [
        towerPartyEffect(member, "party_boss_damage_up", 5, "爬塔：隊伍對 Boss 傷害 +5%"),
        towerPartyEffect(member, "party_elite_damage_up", 5, "爬塔：隊伍對精英怪傷害 +5%"),
      ];
    case "healer":
      return [towerPartyEffect(member, "party_heal", 3, "爬塔：隊伍每回合回復 3% MaxHP")];
    case "tactician":
      return [
        towerPartyEffect(member, "party_damage_up", 5, "爬塔：隊伍傷害 +5%"),
        towerPartyEffect(member, "party_boss_damage_up", 5, "爬塔：隊伍對 Boss 傷害 +5%"),
      ];
    case "bard":
      return [
        towerPartyEffect(member, "party_agi_up", 15, "爬塔：隊伍 AGI +15%"),
        towerPartyEffect(member, "party_combo_up", 5, "爬塔：隊伍連擊率 +5%"),
      ];
    case "barrier_mage":
      return [
        towerPartyEffect(member, "party_damage_reduction", 10, "爬塔：隊伍受到傷害 -10%"),
        towerPartyEffect(member, "party_max_hp_up", 8, "爬塔：隊伍 MaxHP +8%"),
      ];
    case "gambler":
      return [towerPartyEffect(member, "party_crit_rate_up", 5, "爬塔：隊伍爆擊率 +5%")];
    default:
      return [];
  }
}

function isReplacedByTowerAura(jobKey, effectKey) {
  const replaced = {
    bard: new Set(["party_agi_up", "party_gold_gain_up"]),
    barrier_mage: new Set(["party_damage_reduction", "party_crit_damage_reduction"]),
    tactician: new Set(["party_monster_def_down"]),
    healer: new Set(["heal_over_time", "party_heal"]),
  };
  return replaced[jobKey]?.has(effectKey) || false;
}

// ── 讀取玩家資料（組隊時用，開始後不再讀 DB） ────────────────
async function loadMemberData(discordId) {
  const sc = serviceContext;
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (!progress) return null;
  const attrs    = progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const equipped = await mergeEquippedFromLibrary(progress.equipment || {}, sc.itemRepository);
  const inventory     = Array.isArray(progress.inventory)     ? progress.inventory     : [];
  const activeEffects = Array.isArray(progress.activeEffects) ? progress.activeEffects : [];
  const pStats = calcPlayerStats(attrs, equipped, activeEffects, inventory,
    { pkRating: progress.pkRating, petStat: require("../../shared/petDex").statBonusOf(progress?.petDex) });
  return {
    stats: pStats, equipped, inventory, activeEffects,
    level: Math.max(1, Number(progress.level || 1)),
    towerRecord: progress.towerRecord || null,
    job: detectJob(equipped),
  };
}

// ── 每小時挑戰次數檢查 ────────────────────────────────────────
async function checkHourlyLimit(discordId) {
  const sc = serviceContext;
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (!progress) return { ok: false, reason: "找不到玩家資料" };
  const now = Date.now();
  const runs = Array.isArray(progress.towerRecord?.recentRuns) ? progress.towerRecord.recentRuns : [];
  const recent = runs.filter((t) => now - t < TOWER_HOURLY_WINDOW_MS);
  if (recent.length >= TOWER_HOURLY_LIMIT) {
    const oldest = Math.min(...recent);
    const resetIn = Math.ceil((oldest + TOWER_HOURLY_WINDOW_MS - now) / 60000);
    return { ok: false, reason: `每小時最多挑戰 ${TOWER_HOURLY_LIMIT} 次，還需等待約 ${resetIn} 分鐘。` };
  }
  return { ok: true };
}

// ── 解散 ─────────────────────────────────────────────────────
function disbandSession(threadId) {
  const session = activeSessions.get(threadId);
  if (!session) return;
  if (session.lobbyTimer) clearTimeout(session.lobbyTimer);
  for (const m of session.members) {
    playerThreadMap.delete(m.discordId);
    setTowerPresence([m.discordId], false);
  }
  activeSessions.delete(threadId);
  deletePersistSession(threadId);
}

// ── 更新 Thread 首篇訊息 ─────────────────────────────────────
async function updateThreadPanel(session, payload) {
  if (!session.starterMessage) return;
  await session.starterMessage.edit(payload).catch(() => {});
}

// ── 選怪 ─────────────────────────────────────────────────────
// 按 zone 順序（beginner→normal→mid→ancient_city→ancient_city_deep→elite）+ 同 zone 內 HP 低到高（boss 排後）
// 第 floor 層就取排序後第 floor 隻，每隻只打一次
const TOWER_ZONE_ORDER = ["beginner", "normal", "mid", "ancient_city", "ancient_city_deep", "elite"];

let _cachedMonstersByZone = null;
let _cachedBossMap = null;

// ── 爬塔怪物池 ──────────────────────────────────────────────────
// 層段對應 zone，每段最後一層固定出指定 Boss（TOWER_FLOOR_BOSS 來自 towerConfig 單一來源）
const TOWER_FLOOR_ZONE = (floor) => {
  if (floor <= 10) return "beginner";
  if (floor <= 20) return "normal";          // 11-19 用 normal
  if (floor <= 30) return "mid";             // 21-29 用 mid
  if (floor <= 35) return "ancient_city";    // 31-35 古城
  if (floor <= 40) return "ancient_city_deep"; // 36-40 古城深處
  return "dragon_realm";                     // 41-50 龍族之領（51 大史王／52 古龍王 走固定王關）
};

// 排除不應出現在一般層的怪
const TOWER_EXCLUDED_MONSTERS = new Set(["廢都魔王(B)"]);

async function buildTowerMonsterPools() {
  const sc  = serviceContext;
  const all = await sc.monsterService.listMonsters({ includeDisabled: false }).catch(() => []);

  const byZone = {};
  const bossMap = {};

  for (const m of all) {
    // Boss 建立查詢 map
    if (m.isBoss) {
      bossMap[m.name] = m;
    }
    // 非 boss 且非排除清單，加入 zone 池
    if (!m.isBoss && !TOWER_EXCLUDED_MONSTERS.has(m.name)) {
      const z = m.zone || "normal";
      if (!byZone[z]) byZone[z] = [];
      byZone[z].push(m);
    }
  }

  _cachedMonstersByZone = byZone;
  _cachedBossMap = bossMap;
}

async function pickFloorMonster(floor) {
  if (!_cachedMonstersByZone) {
    await buildTowerMonsterPools();
  }

  // 固定 Boss 關
  const bossName = TOWER_FLOOR_BOSS[floor];
  if (bossName) {
    const boss = _cachedBossMap[bossName];
    if (boss) return boss;
  }

  // 一般層：從對應 zone 隨機抽一隻非 boss 怪
  const zone = TOWER_FLOOR_ZONE(floor);
  const pool = _cachedMonstersByZone[zone] || [];
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 收集全隊 party 光環 effects ──────────────────────────────
// 掃全員 equipped 的 target=party effects（與怪物區邏輯相同）
function buildTowerPartyEffects(members) {
  const bestByJobAndKey = new Map();
  const freeStackEffects = [];

  for (const m of members) {
    if (!m.equipped || m.currentHp <= 0) continue;
    const context = { equipped: m.equipped, inventory: m.inventory || [] };
    const refs = collectEquipmentEffects(m.equipped, null, context);
    const jobName = m.job?.name || null;
    const jobKey = m.job?.key || null;
    for (const r of refs) {
      if (r && r.target === "party" && isEffectConditionMet(r, context)) {
        if (isReplacedByTowerAura(jobKey, r.key)) continue;
        const scaled = scaleSupportPartyEffect(r, {
          providerStats: m.stats || {},
          jobKey,
          jobName,
          equipped: m.equipped || {}
        });
        const effect = { ...scaled, sourceName: m.name, sourceJobName: jobName };
        if (!jobName) {
          freeStackEffects.push(effect);
          continue;
        }
        const key = `${jobName}:${r.key}`;
        const current = bestByJobAndKey.get(key);
        const currentValue = Number(current?.params?.value || 0);
        const nextValue = Number(effect?.params?.value || 0);
        if (!current || nextValue > currentValue) bestByJobAndKey.set(key, effect);
      }
    }

    for (const rawEffect of getTowerJobAuraEffects(m)) {
      const effect = scaleSupportPartyEffect(rawEffect, {
        providerStats: m.stats || {},
        jobKey,
        jobName,
        equipped: m.equipped || {}
      });
      const key = `${jobName || jobKey || m.name}:${effect.key}`;
      const current = bestByJobAndKey.get(key);
      const currentValue = Number(current?.params?.value || 0);
      const nextValue = Number(effect?.params?.value || 0);
      if (!current || nextValue > currentValue) bestByJobAndKey.set(key, effect);
    }
  }
  return [...bestByJobAndKey.values(), ...freeStackEffects];
}

function sumPartyEffectValue(partyEffects = [], key) {
  return partyEffects.reduce((sum, effect) => (
    effect?.key === key ? sum + Math.max(0, Number(effect?.params?.value || 0)) : sum
  ), 0);
}

function calcTowerMemberMaxHp(member, floor, partyEffects = []) {
  const bonus = getCumulativePartyBonus(floor);
  const partyMaxHpPct = sumPartyEffectValue(partyEffects, "party_max_hp_up");
  const baseMaxHp = Math.max(1, Number(member?.stats?.maxHp || 100));
  return Math.max(1, Math.round(baseMaxHp * (1 + bonus.hpPct / 100) * (1 + partyMaxHpPct / 100)));
}

function refreshTowerMemberMaxHp(session, floor, { initialize = false } = {}) {
  const partyEffects = buildTowerPartyEffects(session.members);
  for (const member of session.members) {
    const beforeMax = Math.max(0, Number(member.maxHp || 0));
    const beforeHp = Math.max(0, Number(member.currentHp || 0));
    const nextMax = calcTowerMemberMaxHp(member, floor, partyEffects);
    member.maxHp = nextMax;
    if (initialize || beforeMax <= 0) {
      member.currentHp = nextMax;
    } else if (nextMax > beforeMax) {
      member.currentHp = Math.min(nextMax, beforeHp + (nextMax - beforeMax));
    } else {
      member.currentHp = Math.min(beforeHp, nextMax);
    }
  }
}

function buildMonsterEquipped(monster) {
  const base = monster?.equipment || {};
  if (!monster?.monsterCardSkill) return base;
  return {
    ...base,
    special_1: {
      ...(base.special_1 || {}),
      monsterCardSkill: monster.monsterCardSkill,
      itemName: monster.name,
    },
  };
}

function getEffectiveMemberStats(member, partyEffects = []) {
  const baseStats = member?.stats || {};
  const activeEffects = Array.isArray(member?.activeEffects) ? member.activeEffects : [];
  const effective = applyEffectsToStats(baseStats, activeEffects, {
    equipped: member?.equipped || {},
    inventory: member?.inventory || []
  });
  const partyAgiPct = sumPartyEffectValue(partyEffects, "party_agi_up");
  const partyStunChance = sumPartyEffectValue(partyEffects, "party_stun_chance_up");
  if (partyAgiPct > 0) {
    effective.agi = Math.round((Number(effective.agi || 0)) * (1 + partyAgiPct / 100));
  }
  if (partyStunChance > 0) {
    effective.stunChance = Math.min(100, Math.max(0, Number(effective.stunChance || 0) + partyStunChance));
  }
  return effective;
}

function buildTowerActionPreview(members = [], monsterCalc = null, partyEffects = []) {
  const actors = members
    .filter((m) => m && (m.currentHp == null || m.currentHp > 0))
    .map((m, index) => {
      const stats = getEffectiveMemberStats(m, partyEffects);
      return {
        type: "member",
        discordId: m.discordId,
        name: m.name,
        agi: Number(stats.agi || 0),
        dex: Number(stats.dex || 0),
        speed: 100 + Math.max(0, Number(stats.agi || 0)),
        gauge: 0,
        index
      };
    });
  if (monsterCalc) {
    actors.push({
      type: "monster",
      discordId: "monster",
      name: "怪物",
      agi: Number(monsterCalc.agi || 0),
      dex: Number(monsterCalc.dex || 0),
      speed: 100 + Math.max(0, Number(monsterCalc.agi || 0)),
      gauge: 0,
      index: 999
    });
  }

  const preview = [];
  for (let i = 0; i < 12 && actors.length > 0; i++) {
    const nextNeed = Math.min(...actors.map((a) => (1000 - a.gauge) / Math.max(1, a.speed)));
    for (const actor of actors) actor.gauge += actor.speed * nextNeed;
    const ready = actors
      .filter((a) => a.gauge >= 999.999)
      .sort((a, b) => (b.gauge - a.gauge) || (b.agi - a.agi) || (b.dex - a.dex) || (a.index - b.index));
    const actor = ready[0];
    actor.gauge -= 1000;
    preview.push({ ...actor, overflow: actor.gauge });
  }
  return preview;
}

function calcTowerPartyHeal(partyEffects = [], maxHp = 1) {
  let total = 0;
  for (const effect of partyEffects) {
    if (effect?.key !== "heal_over_time" && effect?.key !== "party_heal") continue;
    const params = effect.params || {};
    const value = Number(params.value || 0);
    if (value <= 0) continue;
    total += params.mode === "flat"
      ? Math.round(value)
      : Math.round(maxHp * (value / 100));
  }
  return Math.max(0, total);
}

function applyTowerPartyHealing(members = [], partyEffects = []) {
  const healed = [];
  for (const member of members) {
    if (!member || member.currentHp <= 0) continue;
    const heal = calcTowerPartyHeal(partyEffects, member.maxHp || member.stats?.maxHp || 1);
    if (heal <= 0) continue;
    const before = member.currentHp;
    member.currentHp = Math.min(member.maxHp, member.currentHp + heal);
    const actual = member.currentHp - before;
    if (actual > 0) healed.push({ name: member.name, amount: actual, hp: member.currentHp, maxHp: member.maxHp });
  }
  return healed;
}

function tickTowerCardCooldowns(members = []) {
  for (const member of members) {
    if (!member || member.currentHp <= 0 || !member.cardCooldowns) continue;
    for (const bucket of Object.values(member.cardCooldowns)) {
      if (!bucket || typeof bucket !== "object") continue;
      for (const key of Object.keys(bucket)) {
        bucket[key] = Math.max(0, Number(bucket[key] || 0) - 1);
      }
    }
  }
}

function getTowerPartyDefense(partyEffects = []) {
  let damageReductionPct = 0;
  let critReductionPct = 0;
  for (const effect of partyEffects) {
    const value = Number(effect?.params?.value || 0);
    if (effect?.key === "party_damage_reduction") damageReductionPct += Math.max(0, value);
    if (effect?.key === "party_crit_damage_reduction") critReductionPct += Math.max(0, value);
  }
  return { damageReductionPct, critReductionPct };
}

function createTowerFloorStats(members = []) {
  const byId = new Map();
  for (const member of members) {
    byId.set(member.discordId, {
      discordId: member.discordId,
      name: member.name,
      damageDealt: 0,
      damageTaken: 0,
      healingReceived: 0,
    });
  }
  return byId;
}

function addTowerStat(stats, discordId, key, amount) {
  const row = stats.get(discordId);
  const value = Math.max(0, Math.round(Number(amount || 0)));
  if (!row || value <= 0) return;
  row[key] = Math.max(0, Math.round(Number(row[key] || 0) + value));
}

function compactTowerMemberLogs(memberLogs = [], limit = 8) {
  return (Array.isArray(memberLogs) ? memberLogs : [])
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((entry) => ({
      type: entry?.type || "member",
      name: entry?.name || "???",
      agi: entry?.agi,
      logs: Array.isArray(entry?.logs)
        ? entry.logs.map((log) => {
          const lines = String(log || "").split("\n").filter(Boolean);
          const important = lines.filter((line) => /中毒|淬毒|燒傷|流血|冰凍|擊暈|麻痺|詛咒|閃電|震盪/.test(line));
          return [...new Set([...important.slice(-3), ...lines.slice(-2)])].slice(-4).join("\n");
        }).filter(Boolean)
        : [],
      outcome: entry?.outcome,
      monsterHpAfter: entry?.monsterHpAfter,
      playerHpAfter: entry?.playerHpAfter,
      partyHpAfter: Array.isArray(entry?.partyHpAfter) ? entry.partyHpAfter : [],
    }));
}

function summarizeTowerAuras(partyEffects = []) {
  const seen = new Set();
  const lines = [];
  for (const effect of partyEffects) {
    if (!effect?.key) continue;
    const source = effect.sourceJobName || effect.sourceName || "未知";
    const value = Number(effect?.params?.value || 0);
    const note = effect.notes || `${effect.key} ${value}`;
    const key = `${source}:${effect.key}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${source}｜${note}`);
  }
  return lines;
}

function formatTowerEndPartyStatus(members = []) {
  const lines = (Array.isArray(members) ? members : []).map((member) => {
    const job = member?.job || {};
    const jobLabel = `${job.emoji ? `${job.emoji} ` : ""}${job.name || "冒險者"}`;
    const hp = Math.max(0, Math.round(Number(member?.currentHp || 0)));
    const maxHp = Math.max(1, Math.round(Number(member?.maxHp || member?.stats?.maxHp || 1)));
    return `• ${member?.name || "???"}｜${jobLabel}｜HP ${hp.toLocaleString()} / ${maxHp.toLocaleString()}`;
  });
  return lines.length ? `**── 結束狀態 ──**\n${lines.join("\n")}` : null;
}

function buildTowerFloorSummary(stats, auraLines = []) {
  const rows = [...stats.values()];
  const sortBy = (key) => rows
    .filter((row) => Number(row[key] || 0) > 0)
    .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))
    .map((row) => ({ name: row.name, value: Math.round(Number(row[key] || 0)) }));
  return {
    mvpDamage: sortBy("damageDealt"),
    damageTaken: sortBy("damageTaken"),
    healing: sortBy("healingReceived"),
    auras: auraLines,
  };
}

// ── 單層戰鬥結算（全職業完整邏輯） ──────────────────────────
// 依 AGI 速度條輪流出手；高 AGI 會更快回到行動點。
// 怪物殘血與怪物身上的 debuff / stun 會在全隊之間共享。
async function fightFloor(session, monster, scaledHp, scaledAtk) {
  const floor  = session.currentFloor;
  const bonus  = getCumulativePartyBonus(floor);

  // 完整帶入 monster.calc：level / flatDef / int / dmgMin/dmgMax / dodge / hit / critRate / defIgnorePct … 全部沿用真實值，
  // 只有 atk / maxHp 依樓層縮放。確保塔的攻防邏輯（等級壓制、固定減傷等）與世界王 / 一般 PvE 完全一致，
  // 不再因為手挑欄位而漏掉 level（被當 1 級）或 flatDef（被當 0）。
  const calc = monster.calc || {};
  const mCalc = {
    ...calc,
    atk:          scaledAtk,
    maxHp:        scaledHp,
    finalDamageMultiplier: 1,
  };

  const aliveMembers = () => session.members.filter((m) => m.currentHp > 0);
  if (aliveMembers().length === 0)
    return { survived: false, memberLogs: [], totalRounds: 0, monsterKilled: false, monsterHpFinal: scaledHp, actionOrder: [] };

  let   monsterHp    = scaledHp;
  const memberLogs   = [];
  let   monsterActiveEffects = [];
  let   stunRoundsLeft = 0;
  let   sharedRound = 1;
  let   totalActions = 0;
  const openingPartyEffects = buildTowerPartyEffects(session.members);
  const floorStats = createTowerFloorStats(session.members);
  const floorAuraLines = summarizeTowerAuras(openingPartyEffects);
  const initialActionOrder = buildTowerActionPreview(session.members, mCalc, openingPartyEffects).slice(0, 10);
  const gauges = new Map();
  for (const member of session.members) gauges.set(member.discordId, 0);
  gauges.set("monster", 0);
  const maxActionSlices = Math.max(50, Math.max(1, MAX_ROUNDS_PER_MEMBER) * Math.max(2, session.members.length + 1));

  while (monsterHp > 0 && aliveMembers().length > 0 && totalActions < maxActionSlices) {
    const partyEffects = buildTowerPartyEffects(session.members);
    const actors = [
      ...session.members
        .filter((m) => m.currentHp > 0)
        .map((m, index) => {
          const stats = getEffectiveMemberStats(m, partyEffects);
          return {
            type: "member",
            id: m.discordId,
            name: m.name,
            member: m,
            stats,
            agi: Number(stats.agi || 0),
            dex: Number(stats.dex || 0),
            speed: 100 + Math.max(0, Number(stats.agi || 0)),
            index,
          };
        }),
    ];
    // 王不再單獨佔一個行動格；改為在「每位成員出戰」時，由 runCombatLoop 正常回擊該成員，
    // 這樣攻、防兩個方向都走同一套引擎（與世界王 / 一般 PvE 完全一致）。行動軸（誰先動）不變。
    if (actors.length === 0) break;

    const nextNeed = Math.min(...actors.map((actor) => (1000 - (gauges.get(actor.id) || 0)) / Math.max(1, actor.speed)));
    for (const actor of actors) gauges.set(actor.id, (gauges.get(actor.id) || 0) + actor.speed * nextNeed);
    const ready = actors
      .filter((actor) => (gauges.get(actor.id) || 0) >= 999.999)
      .sort((a, b) => ((gauges.get(b.id) || 0) - (gauges.get(a.id) || 0)) || (b.agi - a.agi) || (b.dex - a.dex) || (a.index - b.index));
    const actor = ready[0];
    gauges.set(actor.id, (gauges.get(actor.id) || 0) - 1000);
    totalActions += 1;
    tickTowerCardCooldowns(session.members);

    const m = actor.member;
    const healed = applyTowerPartyHealing(session.members, partyEffects);
    for (const heal of healed) {
      const target = session.members.find((member) => member.name === heal.name);
      if (target) addTowerStat(floorStats, target.discordId, "healingReceived", heal.amount);
    }
    const nonHealPartyEffects = partyEffects.filter((effect) => effect?.key !== "heal_over_time" && effect?.key !== "party_heal");
    const effStats = {
      ...actor.stats,
      atk: Math.round((actor.stats.atk || 10) * (1 + bonus.atkPct / 100)),
      maxHp: m.maxHp,
    };
    const options = {
      startMonsterHp: monsterHp,
      startPlayerHp: m.currentHp,
      startRound: sharedRound,
      playerName: m.name,
      playerLevel: m.level || 1,
      equipped: m.equipped,
      inventory: m.inventory || [],
      playerActiveEffects: Array.isArray(m.activeEffects) ? [...m.activeEffects] : [],
      cardCooldowns: m.cardCooldowns || { player: {}, monster: {} },
      tickCardCooldowns: false,
      partyEffects: nonHealPartyEffects,
      monsterEquipped: buildMonsterEquipped(monster),
      monsterIsBoss: Boolean(monster.isBoss),
      monsterIsElite: monster.zone === "elite",
      monsterElement: monster?.element || null, // 屬性相剋；無 element 則不參與
      monsterActiveEffects,
      stunRoundsLeft,
    };
    const beforeMonsterHp = monsterHp;
    const beforePlayerHp = m.currentHp;
    // 同一套攻防：本回合該成員打王、王也回擊該成員（王用完整真實數值，含等級壓制/flatDef/破防/格擋/階級骰）
    const result = runCombatLoop(
      effStats,
      mCalc,
      monster.name,
      scaledHp,
      1,
      options
    );

    monsterHp = result.finalMonsterHp;
    m.currentHp = Math.max(0, Math.round(result.finalPlayerHp));
    addTowerStat(floorStats, m.discordId, "damageDealt", Math.max(0, beforeMonsterHp - monsterHp));
    addTowerStat(floorStats, m.discordId, "damageTaken", Math.max(0, beforePlayerHp - m.currentHp));
    // 稽核採證：記錄該成員本層的有效攻擊力(含層段加成)與單次最大傷害,用來抓「傷害被異常放大」
    {
      const _row = floorStats.get(m.discordId);
      if (_row) {
        _row.atk = effStats.atk;
        _row.maxHit = Math.max(Number(_row.maxHit) || 0, Math.max(0, beforeMonsterHp - monsterHp));
      }
    }
    m.activeEffects = Array.isArray(options.playerActiveEffects) ? options.playerActiveEffects : [];
    m.cardCooldowns = result.cardCooldowns || options.cardCooldowns || { player: {}, monster: {} };
    monsterActiveEffects = Array.isArray(result.monsterActiveEffects) ? result.monsterActiveEffects : [];
    stunRoundsLeft = Math.max(0, Number(result.stunRoundsLeft || 0));
    sharedRound = Math.max(sharedRound + 1, Number(result.nextRound || sharedRound + 1));
    memberLogs.push({
      type: "member",
      name: m.name,
      agi: actor.agi,
      logs: [
        ...(healed.length ? [`💚 全隊回復：${healed.map((h) => `${h.name}+${h.amount}`).join("、")}`] : []),
        ...(result.roundLogs || [])
      ],
      outcome: result.outcome,
      monsterHpAfter: monsterHp,
      playerHpAfter: m.currentHp,
      partyHpAfter: session.members.map((mb) => ({ name: mb.name, hp: mb.currentHp, maxHp: mb.maxHp })),
    });
  }

  const killed   = monsterHp <= 0;
  const survived = aliveMembers().length > 0;
  return {
    survived,
    memberLogs,
    totalRounds: totalActions,
    monsterKilled: killed,
    monsterHpFinal: monsterHp,
    actionOrder: initialActionOrder,
    summary: buildTowerFloorSummary(floorStats, floorAuraLines),
    // 稽核用：每人原始輸出（含溢傷，不被怪剩血夾住），用來抓「單人傷害爆量」的異常
    memberDamage: [...floorStats.values()].map((s) => ({ discordId: s.discordId, name: s.name, damageDealt: Math.round(s.damageDealt || 0), atk: Math.round(s.atk || 0), maxHit: Math.round(s.maxHit || 0) })),
  };
}

// ── 全服爬塔最高紀錄廣播 ────────────────────────────────────
async function broadcastTowerServerRecord(session, newRecord) {
  const client = getBotClient();
  if (!client?.isReady()) return;
  const channelId = config.discord.towerFloorBroadcastChannelId;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const memberList = session.members
    .map((m) => `<@${m.discordId}>${m.job?.emoji ? ` ${m.job.emoji}` : ""}`)
    .join("、");
  const isFull = newRecord >= TOWER_TOTAL_FLOORS;

  const content = [
    isFull
      ? `🏆 **全服爬塔最高紀錄刷新！隊伍全層通關！**`
      : `🗼 **全服爬塔最高紀錄刷新！第 ${newRecord} 層！**`,
    `成員：${memberList}`,
    `房號 \`${session.roomId}\``,
  ].join("\n");

  await channel.send({ content }).catch(() => {});
}

// ── 攻略單層（隊長每次按按鈕觸發一層） ──────────────────────
async function processNextFloor(session) {
  const floor = session.clearedFloor + 1;
  session.currentFloor = floor;
  session.state = "fighting";

  // 區段升級與結界師 MaxHP 光環都在每層前重算；光環來源陣亡時會自然失效。
  refreshTowerMemberMaxHp(session, floor);

  // 顯示「結算中」（按鈕 disable）
  await updateThreadPanel(session, createTowerThreadBattleMessage(session));

  const monster = await pickFloorMonster(floor);
  if (!monster) {
    session.failReason = `第 ${floor} 層找不到合適怪物，攻塔中斷。`;
    return finishTower(session);
  }
  session.currentMonster = { name: monster.name, maxHp: 0, currentHp: 0 };

  const scaledHp  = scaleTowerMonsterHp(monster.calc?.maxHp || monster.maxHp || 200, floor);
  const scaledAtk = scaleTowerMonsterAtk(monster.calc?.atk  || 20,  floor);

  const fightResult = await fightFloor(session, monster, scaledHp, scaledAtk);
  session.currentMonster = null;

  // 戰鬥結果存入 session，供面板顯示
  session.lastFloorResult = {
    floor,
    monsterName:   monster.name,
    scaledHp,
    memberLogs:    compactTowerMemberLogs(fightResult.memberLogs),
    actionOrder:   fightResult.actionOrder,
    totalRounds:   fightResult.totalRounds,
    monsterKilled: fightResult.monsterKilled,
    survived:      fightResult.survived,
    monsterHpFinal: fightResult.monsterHpFinal,
    summary:       fightResult.summary,
  };

  // ── 攻塔稽核 LOG：每層累積一筆（可事後查「怪有沒有真的被打死」）──
  if (!Array.isArray(session.floorResults)) session.floorResults = [];
  {
    const _hpFinal = Math.max(0, Math.round(Number(fightResult.monsterHpFinal) || 0));
    const _hpDrained = Math.max(0, Math.round(scaledHp - (Number(fightResult.monsterHpFinal) || 0)));
    const _memberDamage = Array.isArray(fightResult.memberDamage) ? fightResult.memberDamage : [];
    const _topHit = _memberDamage.reduce((mx, d) => Math.max(mx, Number(d.damageDealt) || 0), 0);
    const _actions = Number(fightResult.totalRounds) || 0;
    const _killed = Boolean(fightResult.monsterKilled);
    // 異常旗標：①宣稱擊殺但怪還有血(資料矛盾=怪沒死也通) ②高樓層卻在「行動格≤隊伍人數」內擊殺(一擊秒殺類)
    const _suspicious = (_killed && _hpFinal > 0) ||
      (_killed && floor >= 15 && _actions <= session.members.length);
    session.floorResults.push({
      floor,
      monster: monster.name,
      scaledHp: Math.round(scaledHp),
      monsterHpFinal: _hpFinal,
      hpDrained: _hpDrained,             // 實際扣掉的血(上限=scaledHp)
      topHit: Math.round(_topHit),       // 單人最高貢獻
      memberDamage: _memberDamage,       // 每人貢獻分佈(定位異常輸出者)
      monsterKilled: _killed,
      survived: Boolean(fightResult.survived),
      actions: _actions,                 // 總行動格(合法高樓層需大量行動)
      survivors: session.members.filter((m) => m.currentHp > 0).length,
      partySize: session.members.length,
      suspicious: _suspicious,
    });
  }

  if (!fightResult.monsterKilled || !fightResult.survived) {
    session.failReason = !fightResult.monsterKilled
      ? `第 ${floor} 層行動格耗盡（${fightResult.totalRounds} 格），火力不足以擊敗 ${monster.name}，攻塔終止。（每人約 ${MAX_ROUNDS_PER_MEMBER} 格，需提升 ATK 或帶高輸出職業）`
      : `第 ${floor} 層通關後全員陣亡。`;
    await persistSession(session);
    return finishTower(session);
  }

  session.clearedFloor = floor;

  // 每層通關後嘗試掉落怪物卡
  awardFloorCardDrops(session, monster).catch(() => {});
  // 每層通關後嘗試掉落藥水
  awardFloorPotionDrop(session, floor).then((r) => {
    if (r) console.log(`[Tower] 第${floor}層掉落藥水：${r.itemName} → ${r.name}`);
  }).catch(() => {});


  if (session.clearedFloor >= TOWER_TOTAL_FLOORS) {
    await persistSession(session);
    return finishTower(session);
  }

  session.state = "ready_to_fight";
  await persistSession(session);
  await updateThreadPanel(session, createTowerThreadBattleMessage(session));
}

// ── 攻塔結束（結算） ─────────────────────────────────────────
async function finishTower(session) {
  session.state = session.clearedFloor >= TOWER_TOTAL_FLOORS ? "done" : "failed";
  const reward = calcTowerReward(session.clearedFloor);
  await settleTowerSession(session, reward);
  await updateThreadPanel(session, createTowerThreadResultMessage(session, reward));
  await refreshTowerHallPanelByConfig().catch((e) => {
    console.warn("[Tower] refresh hall panel failed:", e?.message || e);
  });

  setTimeout(async () => {
    const t = session.thread;
    disbandSession(session.threadId);
    if (t?.delete) await t.delete("攻塔結束自動清除").catch(() => {});
  }, 5 * 60 * 1000);
}

// ── 每層怪物卡掉落（在 processNextFloor 通關後呼叫） ─────────
async function awardFloorCardDrops(session, monster) {
  if (!monster || session.members.length === 0) return null;
  const sc = serviceContext;
  const pool = Array.isArray(monster.drops) ? [...monster.drops] : [];
  const cardItemId = monster?.equipment?.special_1?.itemId || monster?.equipment?.special_1?.id || null;
  if (cardItemId) {
    const card = await sc.itemRepository.findById(cardItemId).catch(() => null);
    if (card) {
      const existIdx = pool.findIndex((d) => d?.itemId === cardItemId);
      if (existIdx >= 0) pool[existIdx] = { ...pool[existIdx], chance: 1 };
      else pool.push({ itemId: card.id, chance: 1, source: "monster_card" });
    }
  }
  if (pool.length === 0) return null;

  const luckyMember = session.members[Math.floor(Math.random() * session.members.length)];
  const droppedItems = [];
  for (const drop of pool) {
    const item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
    if (!item) continue;
    // S 階（S 裝備 / S 強化寶石）只走世界王機制：一般樓層不掉；
    // 但塔內的「世界王樓層」(大史王 51 / 古龍王 52，zone elite / dragon_king_lair) 比照外面、照掉落表掉 S。
    if (String(item.tier || "").toUpperCase() === "S" && !isWorldBossZone(monster?.zone)) continue;
    const finalChance = Math.min(100, Math.max(0, Number(drop.chance)));
    if (Math.random() * 100 < finalChance) {
      const equipStats = item.equipStats ? { ...item.equipStats } : {};
      droppedItems.push({
        uuid: require("crypto").randomUUID(),
        itemId: item.id, itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        useEffects: item.useEffects || [], passiveEffects: item.passiveEffects || [],
        procEffects: item.procEffects || [], combatEffects: item.combatEffects || [],
        itemType: item.itemType || "consumable",
        imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || null, equipStats,
        weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
        atkStat: item.atkStat || null, tier: item.tier || null,
        monsterCardSkill: item.monsterCardSkill || null,
        enhanceLevel: 0, source: "tower_drop", sourceRef: monster.name,
        purchasedAt: new Date().toISOString(),
      });
    }
  }
  if (droppedItems.length === 0) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const latestProg = await sc.progressRepository.findByPlayerId(luckyMember.discordId).catch(() => null);
    if (!latestProg) break;
    const next = { ...latestProg, inventory: [...(latestProg.inventory || []), ...droppedItems], updatedAt: new Date().toISOString() };
    try {
      if (typeof sc.progressRepository.saveIfUnchanged === "function") {
        const ok = await sc.progressRepository.saveIfUnchanged(next, latestProg.updatedAt);
        if (ok) return { name: luckyMember.name, items: droppedItems.map((i) => i.itemName) };
      } else {
        await sc.progressRepository.save(next);
        return { name: luckyMember.name, items: droppedItems.map((i) => i.itemName) };
      }
    } catch (_) {}
    if (attempt < 2) await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
  }
  return null;
}

// ── 結算：發獎 + 更新個人紀錄 ───────────────────────────────
function buildTowerRunProgress(session) {
  const result = session?.lastFloorResult || null;
  const maxHp = Math.max(0, Math.round(Number(result?.scaledHp || 0)));
  if (!result || maxHp <= 0) {
    return {
      floor: Math.max(0, Number(session?.clearedFloor || 0)),
      monsterName: null,
      damage: 0,
      damagePct: 0,
      remainingHp: 0,
      maxHp: 0,
    };
  }

  const remainingHp = Math.max(0, Math.min(maxHp, Math.round(Number(result.monsterHpFinal || 0))));
  const damage = Math.max(0, maxHp - remainingHp);
  return {
    floor: Math.max(0, Number(result.floor || session?.clearedFloor || 0)),
    monsterName: result.monsterName || null,
    damage,
    damagePct: maxHp > 0 ? Number(((damage / maxHp) * 100).toFixed(2)) : 0,
    remainingHp,
    maxHp,
  };
}

function isBetterTowerRecordRun(clearedFloor, runProgress, record = {}) {
  const prevFloor = Number(record.bestFloor || 0);
  if (clearedFloor !== prevFloor) return clearedFloor > prevFloor;

  const prevPct = Number(record.bestProgressDamagePct || 0);
  const nextPct = Number(runProgress?.damagePct || 0);
  if (nextPct !== prevPct) return nextPct > prevPct;

  const prevDamage = Number(record.bestProgressDamage || 0);
  const nextDamage = Number(runProgress?.damage || 0);
  return nextDamage > prevDamage;
}

async function settleTowerSession(session, reward) {
  const sc = serviceContext;
  const clearBuff = getTowerClearBuff(session.clearedFloor);
  const settledAt = new Date().toISOString();
  const runId = `${session.roomId || session.threadId || "tower"}:${Date.now()}`;
  const partySnapshot = session.members.map((p) => ({ discordId: p.discordId, name: p.name }));
  const runProgress = buildTowerRunProgress(session);

  // 結算前先抓全服最高層紀錄
  let serverBestBefore = 0;
  try {
    const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
    const mongoDb = await getMongoDb();
    const rec = await mongoDb.collection("progress").findOne(
      { "towerRecord.bestFloor": { $exists: true } },
      { sort: { "towerRecord.bestFloor": -1 }, projection: { "towerRecord.bestFloor": 1 } }
    );
    serverBestBefore = rec?.towerRecord?.bestFloor || 0;
  } catch (_) {}

  for (const m of session.members) {
    try {
      const prog = await sc.progressRepository.findByPlayerId(m.discordId).catch(() => null);
      if (!prog) continue;
      const prevBest = prog.towerRecord?.bestFloor || 0;
      m.towerRecord = { ...(m.towerRecord || {}), prevBest };
      const newBest = Math.max(prevBest, session.clearedFloor);
      const isNewRecord = isBetterTowerRecordRun(session.clearedFloor, runProgress, prog.towerRecord);

      // 記錄本次挑戰時間（用於每小時次數限制）
      const now = Date.now();
      const recentRuns = Array.isArray(prog.towerRecord?.recentRuns) ? prog.towerRecord.recentRuns : [];
      const pruned = recentRuns.filter((t) => now - t < TOWER_HOURLY_WINDOW_MS);
      pruned.push(now);

      prog.towerRecord = {
        ...(prog.towerRecord || {}),
        bestFloor: newBest,
        bestAt: isNewRecord
          ? settledAt
          : (prog.towerRecord?.bestAt || settledAt),
        totalRuns: (prog.towerRecord?.totalRuns || 0) + 1,
        bestParty: isNewRecord ? partySnapshot : (prog.towerRecord?.bestParty || partySnapshot),
        bestProgressFloor: isNewRecord ? runProgress.floor : (prog.towerRecord?.bestProgressFloor || runProgress.floor),
        bestProgressMonsterName: isNewRecord ? runProgress.monsterName : (prog.towerRecord?.bestProgressMonsterName || runProgress.monsterName),
        bestProgressDamage: isNewRecord ? runProgress.damage : Number(prog.towerRecord?.bestProgressDamage || 0),
        bestProgressDamagePct: isNewRecord ? runProgress.damagePct : Number(prog.towerRecord?.bestProgressDamagePct || 0),
        bestProgressRemainingHp: isNewRecord ? runProgress.remainingHp : Number(prog.towerRecord?.bestProgressRemainingHp || 0),
        bestProgressMaxHp: isNewRecord ? runProgress.maxHp : Number(prog.towerRecord?.bestProgressMaxHp || 0),
        lastFloor: session.clearedFloor,
        lastAt: settledAt,
        lastParty: partySnapshot,
        lastRunId: runId,
        lastProgressFloor: runProgress.floor,
        lastProgressMonsterName: runProgress.monsterName,
        lastProgressDamage: runProgress.damage,
        lastProgressDamagePct: runProgress.damagePct,
        lastProgressRemainingHp: runProgress.remainingHp,
        lastProgressMaxHp: runProgress.maxHp,
        recentRuns: pruned,
      };
      prog.towerRecord.bestFloor = newBest;
      m.towerRecord = prog.towerRecord;

      // 發放過關 Buff（刷新模式，condition: zone=monster）
      if (clearBuff) {
        // 過關祝福為限定時間增益，發放後在後續戰鬥皆生效。
        // 註：原本帶 condition:{zone:["monster"]} 會在「發放當下（無戰鬥 context）」就被 isEffectConditionMet 判不符而整個跳過，
        //     導致 buff 根本沒寫進 activeEffects；且 "monster" 並非任何真實 zone key。故移除該條件。
        const effectsToApply = clearBuff.effects.map((e) => ({
          ...e,
          duration: { mode: "seconds", value: clearBuff.durationSec },
          stackMode: "refresh",
        }));
        prog.activeEffects = applyEffectInstances(
          prog.activeEffects || [],
          effectsToApply,
          { source: "tower_buff", sourceType: "tower_buff" },
        );
      }

      await sc.progressRepository.save(prog).catch(() => {});

      if (reward.gold > 0) {
        await sc.rewardService.grantCurrency({
          discordId: m.discordId, displayName: m.name,
          currencyType: "gold", amount: reward.gold,
          source: CURRENCY_SOURCES.TOWER_REWARD, operator: "tower:clear",
        }).catch(() => {});
      }
      if (reward.exp > 0) {
        const _r = await sc.progressService.grantExp({
          discordId: m.discordId, displayName: m.name,
          amount: reward.exp, source: EXP_SOURCES.TOWER_REWARD_EXP,
        }).catch(() => null);
        m._overflowGold = _r ? (Number(_r.overflowGold) || 0) : 0; // 滿等溢出→金幣(給DM戰報)
      }
    } catch (e) { /* ignore per-member errors */ }
  }

  // 刷新全服最高紀錄 → 廣播
  if (session.clearedFloor > serverBestBefore) {
    broadcastTowerServerRecord(session, session.clearedFloor).catch(() => {});
  }

  // 41 層通關 → 寫入全服名人堂（只記錄一次，不依人頭）
  if (session.clearedFloor >= TOWER_TOTAL_FLOORS) {
    try {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const mongoDb = await getMongoDb();
      await mongoDb.collection("towerHallOfFame").insertOne({
        clearedAt: new Date().toISOString(),
        members: session.members.map((m) => ({
          discordId: m.discordId,
          name: m.name,
          job: m.job?.name || m.job || null,
          level: m.level || null,
        })),
        floor: session.clearedFloor,
      });
    } catch (_e) { /* 寫入失敗不影響主流程 */ }
  }

  // ── 攻塔稽核 LOG：每次結束（通關或失敗）寫入完整逐層紀錄，可事後查證 ──
  try {
    const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
    const mongoDb = await getMongoDb();
    const floors = Array.isArray(session.floorResults) ? session.floorResults : [];
    const suspicious = floors.filter((f) => f.suspicious);
    await mongoDb.collection("towerRunLogs").insertOne({
      runId,
      settledAt,
      status: session.state,                 // done | failed
      clearedFloor: session.clearedFloor,
      totalFloors: TOWER_TOTAL_FLOORS,
      failReason: session.failReason || null,
      party: partySnapshot,
      floors,
      suspiciousCount: suspicious.length,     // >0 代表有「1 回合或傷害異常爆量」的可疑層，需人工複查
      createdAt: new Date().toISOString(),
    });
    if (suspicious.length > 0) {
      console.warn(`[Tower][AUDIT] runId=${runId} 有 ${suspicious.length} 層可疑（1回合或傷害爆量）：${suspicious.map((f) => `F${f.floor}`).join(",")}`);
    }
  } catch (e) {
    console.error("[Tower] towerRunLogs write failed:", e?.message || e);
  }

  for (const m of session.members) {
    try {
      // DM 通知
      const client = getBotClient();
        const user   = await client.users.fetch(m.discordId).catch(() => null);
        if (user) {
          const isFull    = session.clearedFloor >= TOWER_TOTAL_FLOORS;
          const isNewRec  = session.clearedFloor > (m.towerRecord?.prevBest || 0);
          const rewardLines = [
            reward.gold > 0 ? `💰 金幣 +${reward.gold}` : null,
            reward.exp  > 0 ? `✨ EXP +${reward.exp}`   : null,
            (Number(m._overflowGold) > 0) ? `💰 已滿等，溢出經驗轉為 ${m._overflowGold} 金幣` : null,
            reward.bonusMsg  || null,
          ].filter(Boolean).join("\n");

          // 祝福效果描述
          const BUFF_EFFECT_LABELS = {
            atk_multiplier_up:    (v) => `ATK ×${v}`,
            def_multiplier_up:    (v) => `DEF ×${v}`,
            max_hp_multiplier_up: (v) => `MaxHP ×${v}`,
          };
          const buffEffectDesc = clearBuff
            ? clearBuff.effects
                .map((e) => BUFF_EFFECT_LABELS[e.key]?.(e.params?.value))
                .filter(Boolean)
                .join("、")
            : null;
          const durationLabel = clearBuff
            ? (clearBuff.durationSec >= 3600 ? "1 小時" : "30 分鐘")
            : null;
          const buffLine = clearBuff
            ? `⚡ **${clearBuff.label}** 已啟動（${durationLabel}，限怪物區）${buffEffectDesc ? `\n　效果：${buffEffectDesc}` : ""}`
            : null;

          // 失敗時顯示原因標籤與怪物剩餘血量
          const lastResult = session.lastFloorResult;
          let failTypeLabel = null;
          let monsterHpLine = null;
          if (!isFull && lastResult) {
            if (!lastResult.monsterKilled) {
              failTypeLabel = `⏱️ **終止原因：行動格耗盡（火力不足）**`;
              if (lastResult.scaledHp > 0) {
                const remaining = Math.max(0, lastResult.monsterHpFinal);
                const pct = Math.round((remaining / lastResult.scaledHp) * 100);
                monsterHpLine = `🩸 怪物剩餘 HP：${remaining.toLocaleString()} / ${lastResult.scaledHp.toLocaleString()}（${pct}%）`;
              }
            } else if (!lastResult.survived) {
              failTypeLabel = `💀 **終止原因：通關後全員陣亡**`;
            }
          }

          const dmLines = [
            isFull
              ? `🎉 **恭喜！組隊攻塔全層通關！**`
              : `🗼 **組隊攻塔結束 ― 第 ${session.clearedFloor} 層**`,
            session.failReason ? `❌ ${session.failReason}` : null,
            failTypeLabel,
            monsterHpLine,
            formatTowerEndPartyStatus(session.members),
            "",
            isNewRec ? `🆕 **個人新紀錄！** 最高層：${session.clearedFloor} 層` : `個人最高：${m.towerRecord?.bestFloor || session.clearedFloor} 層`,
            "",
            rewardLines ? `**── 獎勵 ──**\n${rewardLines}` : null,
            buffLine,
          ].filter((l) => l !== null).join("\n");

          await user.send({ content: dmLines }).catch(() => {});
        }
    } catch (_) {}
  }
}

// ── 取頻道 ───────────────────────────────────────────────────
async function getTowerForumChannel() {
  const client = getBotClient();
  if (!client?.isReady()) return null;
  const id = config.discord.towerForumChannelId;
  if (!id) return null;
  return client.channels.fetch(id).catch(() => null);
}

// ── 工具 ─────────────────────────────────────────────────────
function getDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
}

function findSessionByStarter(messageId) {
  if (!messageId) return null;
  for (const s of activeSessions.values()) {
    if (s.starterMessage?.id === messageId) return s;
  }
  return null;
}

// ── Handlers ─────────────────────────────────────────────────

async function handleOpenLobby(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;

  if (playerThreadMap.has(discordId)) {
    const tid = playerThreadMap.get(discordId);
    const rid = activeSessions.get(tid)?.roomId || tid;
    await interaction.editReply({ content: `⚠️ 你已有進行中的隊伍（\`${rid}\`），請先解散或等攻塔結束。` });
    return;
  }

  const pData = await loadMemberData(discordId);
  if (!pData) {
    await interaction.editReply({ content: "❌ 找不到玩家資料，請先建立角色。" });
    return;
  }
  if (pData.level < TOWER_MIN_LEVEL) {
    await interaction.editReply({ content: `❌ 需要達到 **${TOWER_MIN_LEVEL} 等**才能組隊攻塔（目前 ${pData.level} 等）。` });
    return;
  }
  const limitCheck = await checkHourlyLimit(discordId);
  if (!limitCheck.ok) {
    await interaction.editReply({ content: `❌ ${limitCheck.reason}` });
    return;
  }

  const forum = await getTowerForumChannel();
  if (!forum?.threads?.create) {
    await interaction.editReply({ content: "❌ 找不到組隊論壇頻道，請通知管理員確認設定。" });
    return;
  }

  const name   = getDisplayName(interaction);
  const roomId = genRoomId();
  const session = {
    roomId, threadId: null, thread: null, starterMessage: null,
    leaderId: discordId,
    state: "lobby",
    members: [],
    currentFloor: 0, clearedFloor: 0,
    currentMonster: null,
    lastFloorLog: [],
    failReason: null, lobbyTimer: null,
  };

  session.members.push({
    discordId, name, level: pData.level,
    stats: pData.stats,          // 快照（不再更新）
    equipped: pData.equipped,
    inventory: pData.inventory,
    activeEffects: pData.activeEffects,
    currentHp: 0, maxHp: 0,
    towerRecord: pData.towerRecord,
    job: pData.job,
  });

  const thread = await forum.threads.create({
    name: `[攻塔] ${name} 的隊伍 [${roomId}]`,
    autoArchiveDuration: 60,
    reason: "Tower party lobby",
    message: createTowerThreadLobbyMessage(session),
  }).catch(() => null);

  if (!thread) {
    await interaction.editReply({ content: "❌ 建立隊伍貼文失敗，請稍後再試。" });
    return;
  }

  session.thread   = thread;
  session.threadId = thread.id;
  session.starterMessage = await thread.fetchStarterMessage().catch(() => null);

  activeSessions.set(thread.id, session);
  playerThreadMap.set(discordId, thread.id);
  setTowerPresence([discordId], true);
  await persistSession(session);

  session.lobbyTimer = setTimeout(async () => {
    const s = activeSessions.get(thread.id);
    if (s?.state === "lobby") {
      disbandSession(thread.id);
      await thread.delete("等待逾時自動解散").catch(() => {});
    }
  }, TOWER_LOBBY_TIMEOUT_MS);

  await interaction.editReply({ content: `✅ 隊伍已建立！前往論壇邀請隊友：<#${thread.id}>` });
  await refreshHallPanel(interaction.message).catch(() => {});
}

async function handleJoin(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;

  if (playerThreadMap.has(discordId)) {
    const rid = activeSessions.get(playerThreadMap.get(discordId))?.roomId || "";
    await interaction.editReply({ content: `⚠️ 你已在房間 \`${rid}\` 中。` });
    return;
  }

  const session = findSessionByStarter(interaction.message?.id);
  if (!session) {
    await interaction.editReply({ content: "❌ 找不到對應隊伍，可能已解散。" });
    return;
  }
  if (session.state !== "lobby") {
    await interaction.editReply({ content: "❌ 攻塔已開始，無法加入。" });
    return;
  }
  if (session.members.length >= TOWER_MAX_MEMBERS) {
    await interaction.editReply({ content: `❌ 隊伍已滿（最多 ${TOWER_MAX_MEMBERS} 人）。` });
    return;
  }

  const pData = await loadMemberData(discordId);
  if (!pData) {
    await interaction.editReply({ content: "❌ 找不到你的玩家資料。" });
    return;
  }
  if (pData.level < TOWER_MIN_LEVEL) {
    await interaction.editReply({ content: `❌ 需要達到 **${TOWER_MIN_LEVEL} 等**才能加入攻塔隊伍（目前 ${pData.level} 等）。` });
    return;
  }
  const limitCheck = await checkHourlyLimit(discordId);
  if (!limitCheck.ok) {
    await interaction.editReply({ content: `❌ ${limitCheck.reason}` });
    return;
  }

  session.members.push({
    discordId, name: getDisplayName(interaction),
    level: pData.level, stats: pData.stats,
    equipped: pData.equipped, inventory: pData.inventory, activeEffects: pData.activeEffects,
    currentHp: 0, maxHp: 0, towerRecord: pData.towerRecord,
    cardCooldowns: { player: {}, monster: {} },
    job: pData.job,
  });
  playerThreadMap.set(discordId, session.threadId);
  setTowerPresence([discordId], true);
  await persistSession(session);

  await interaction.editReply({ content: `✅ 已加入隊伍 \`${session.roomId}\`！` });
  await updateThreadPanel(session, createTowerThreadLobbyMessage(session));
}

async function handleLeave(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const session   = activeSessions.get(playerThreadMap.get(discordId));

  if (!session) {
    await interaction.editReply({ content: "⚠️ 你不在任何隊伍中。" });
    return;
  }
  if (session.state !== "lobby") {
    await interaction.editReply({ content: "❌ 攻塔進行中，無法離開。" });
    return;
  }
  if (session.leaderId === discordId) {
    await interaction.editReply({ content: "⚠️ 你是隊長，請點 **解散** 而非離開。" });
    return;
  }

  session.members = session.members.filter((m) => m.discordId !== discordId);
  playerThreadMap.delete(discordId);
  setTowerPresence([discordId], false);
  await persistSession(session);
  await interaction.editReply({ content: "✅ 已離開隊伍。" });
  await updateThreadPanel(session, createTowerThreadLobbyMessage(session));
}

async function handleDisband(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const threadId  = playerThreadMap.get(discordId);
  const session   = threadId ? activeSessions.get(threadId) : null;

  if (!session) {
    await interaction.editReply({ content: "⚠️ 找不到你的隊伍。" });
    return;
  }
  if (session.leaderId !== discordId) {
    await interaction.editReply({ content: "❌ 只有隊長能解散。" });
    return;
  }
  if (session.state === "fighting") {
    await interaction.editReply({ content: "❌ 正在結算中，請稍候。" });
    return;
  }

  const thread = session.thread;
  disbandSession(threadId);
  await interaction.editReply({ content: `✅ 隊伍 \`${session.roomId}\` 已解散。` });
  if (thread) {
    await thread.delete("隊長解散隊伍").catch(() => {});
  }
}

// 開始：快照全員裝備，初始化 HP，切換到 ready_to_fight
async function handleStart(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const threadId  = playerThreadMap.get(discordId);
  const session   = threadId ? activeSessions.get(threadId) : null;

  if (!session) {
    await interaction.editReply({ content: "❌ 找不到你的隊伍。" });
    return;
  }
  if (session.leaderId !== discordId) {
    await interaction.editReply({ content: "❌ 只有隊長能開始。" });
    return;
  }
  if (session.state !== "lobby") {
    await interaction.editReply({ content: "⚠️ 攻塔已開始或結束。" });
    return;
  }

  if (session.lobbyTimer) { clearTimeout(session.lobbyTimer); session.lobbyTimer = null; }

  // ── 快照鎖定：此刻讀到的 stats 是最終戰鬥數值，之後不再讀 DB ──
  // 先讓全員視為存活，才能把開場爬塔光環納入 MaxHP 計算。
  for (const m of session.members) {
    m.maxHp = 1;
    m.currentHp = 1;
    m.cardCooldowns = { player: {}, monster: {} };
  }
  refreshTowerMemberMaxHp(session, 1, { initialize: true });

  session.state        = "ready_to_fight";
  session.clearedFloor = 0;
  await persistSession(session);

  await interaction.editReply({
    content: `✅ 攻塔開始！${session.members.length} 位冒險者的裝備已鎖定。隊長按按鈕攻略每一層！`,
  });
  await updateThreadPanel(session, createTowerThreadBattleMessage(session));
}

// 隊長按「攻略下一層」
async function handleFightNext(interaction) {
  await interaction.deferUpdate();
  const discordId = interaction.user.id;
  const session   = findSessionByStarter(interaction.message?.id);

  if (!session) {
    await interaction.followUp({ content: "❌ 找不到對應隊伍。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (session.leaderId !== discordId) {
    await interaction.followUp({ content: "❌ 只有隊長能操作攻略。", flags: MessageFlags.Ephemeral });
    return;
  }
  if (session.state !== "ready_to_fight") {
    // 已在 fighting（防重複按）或已結束
    return;
  }

  await processNextFloor(session).catch((err) => {
    console.error("[Tower] processNextFloor error:", err);
    session.state = "failed";
    session.failReason = "系統錯誤，攻塔中斷。";
    finishTower(session).catch(() => {});
  });
}

async function handleRefresh(interaction) {
  const session = findSessionByStarter(interaction.message?.id);
  if (!session) {
    await interaction.update({ embeds: [{ title: "隊伍已解散", color: 0x95a5a6 }], components: [] });
    return;
  }
  const payload = session.state === "lobby"
    ? createTowerThreadLobbyMessage(session)
    : createTowerThreadBattleMessage(session);
  await interaction.update(payload);
}

async function handleRanking(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ranking = await serviceContext.progressRepository.findTopByTowerRecord(10).catch(() => []);
  await interaction.editReply(createTowerRankingMessage(ranking));
}

// ── 常駐大廳面板 ─────────────────────────────────────────────
async function fetchTowerHallRecords(limit = 5) {
  return serviceContext.progressRepository.findTopByTowerRecord(limit).catch(() => []);
}

async function getStoredTowerHallPanelRef() {
  const layout = await serviceContext.channelLayoutRepository?.get?.().catch(() => null);
  const panel = layout?.discord?.towerHallPanel || null;
  return {
    channelId: panel?.channelId || config.discord.towerLobbyChannelId || "",
    messageId: panel?.messageId || "",
  };
}

async function saveTowerHallPanelRef(message) {
  if (!message?.id || !message?.channelId) return;
  // 使用 MongoDB atomic update，只動 towerHallPanel 欄位，不重寫整份 layout，
  // 避免跟 publishMonsterZonePanel / publishCoinShopPanel 等 read-modify-write 競爭
  try {
    const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
    const db = await getMongoDb();
    await db.collection("channelLayout").updateOne(
      { _id: "default" },
      {
        $set: {
          "value.discord.towerHallPanel": {
            channelId: message.channelId,
            messageId: message.id,
            updatedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
  } catch (_) { /* swallow */ }
}

async function publishTowerHallPanel(interaction) {
  const ranking = await fetchTowerHallRecords(5);
  await interaction.reply(createTowerHallMessage(ranking));
  const message = await interaction.fetchReply().catch(() => null);
  await saveTowerHallPanelRef(message);
}

// 從後台呼叫：清空頻道後直接發送
async function publishTowerHallPanelToChannel(channelId, { cleanChannel = true } = {}) {
  const client = getBotClient();
  if (!client?.isReady()) throw new Error("Discord bot is not ready");

  const channel = await client.channels.fetch(String(channelId).trim());
  if (!channel || !channel.isTextBased || !channel.isTextBased()) {
    throw new Error("target channel is not text-based");
  }

  if (cleanChannel) {
    let lastId;
    for (let i = 0; i < 20; i++) {
      const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) }).catch(() => null);
      if (!batch || batch.size === 0) break;
      const deletable = batch.filter((m) => !m.pinned);
      if (deletable.size === 0) break;
      try { await channel.bulkDelete(deletable, true); }
      catch (_) {
        for (const m of deletable.values()) { await m.delete().catch(() => {}); }
      }
      lastId = batch.last()?.id;
      if (batch.size < 100) break;
    }
  }

  const storedRef = await getStoredTowerHallPanelRef();
  if (storedRef.messageId && storedRef.channelId === channel.id) {
    await channel.messages.fetch(storedRef.messageId).then((m) => m.delete()).catch(() => {});
  }

  const ranking = await fetchTowerHallRecords(5);
  const sent = await channel.send(createTowerHallMessage(ranking));
  await saveTowerHallPanelRef(sent);
  return { channelId: sent.channelId, messageId: sent.id };
}

async function refreshHallPanel(hallMessage) {
  if (!hallMessage) return;
  const ranking = await fetchTowerHallRecords(5);
  await hallMessage.edit(createTowerHallMessage(ranking)).catch(() => {});
  await saveTowerHallPanelRef(hallMessage);
}

async function refreshTowerHallPanelByConfig() {
  const client = getBotClient();
  if (!client?.isReady() || !config.discord.towerLobbyChannelId) return;

  const storedRef = await getStoredTowerHallPanelRef();
  const channel = await client.channels.fetch(storedRef.channelId || config.discord.towerLobbyChannelId).catch(() => null);
  if (!channel?.messages?.fetch) return;

  if (storedRef.messageId) {
    const storedMessage = await channel.messages.fetch(storedRef.messageId).catch(() => null);
    if (storedMessage) {
      await refreshHallPanel(storedMessage);
      return;
    }
  }

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return;

  const panelMessage = messages.find((msg) => {
    const hasTowerEmbed = msg.embeds?.some((embed) => String(embed.title || "").includes("組隊攻塔"));
    const hasTowerButton = msg.components?.some((row) =>
      row.components?.some((component) => component.customId === TOWER_IDS.openLobby)
    );
    return msg.author?.id === client.user.id && (hasTowerEmbed || hasTowerButton);
  });

  if (panelMessage) await refreshHallPanel(panelMessage);
  else console.warn(`[Tower] hall panel not found in channel ${channel.id}; please republish /發布爬塔面板`);
}

// ── Bot 重啟後從 DB 還原進行中的 session ──────────────────────
async function restoreTowerSessions() {
  const client = getBotClient();
  if (!client?.isReady()) return;

  let saved = [];
  try {
    saved = await serviceContext.towerSessionRepository.findAll();
  } catch (e) {
    console.error("[Tower] restoreTowerSessions DB error:", e);
    return;
  }

  let restored = 0;
  for (const data of saved) {
    // 已結束的清掉
    if (data.state === "done" || data.state === "failed") {
      await serviceContext.towerSessionRepository.delete(data.threadId).catch(() => {});
      continue;
    }

    try {
      const thread = await client.channels.fetch(data.threadId).catch(() => null);
      if (!thread) {
        await serviceContext.towerSessionRepository.delete(data.threadId).catch(() => {});
        continue;
      }

      // Forum thread 的 starter message 用儲存的 ID fetch，比 fetchStarterMessage() 更可靠
      let starterMessage = null;
      if (data.starterMessageId) {
        starterMessage = await thread.messages.fetch(data.starterMessageId).catch(() => null);
      }
      if (!starterMessage) {
        starterMessage = await thread.fetchStarterMessage().catch(() => null);
      }

      const session = {
        roomId:          data.roomId,
        threadId:        data.threadId,
        thread,
        starterMessage,
        leaderId:        data.leaderId,
        state:           data.state === "fighting" ? "ready_to_fight" : data.state,
        members:         data.members || [],
        currentFloor:    data.currentFloor || 0,
        clearedFloor:    data.clearedFloor || 0,
        currentMonster:  data.currentMonster || null,
        lastFloorResult: data.lastFloorResult || null,
        floorResults:    Array.isArray(data.floorResults) ? data.floorResults : [],
        failReason:      data.failReason || null,
        lobbyTimer:      null,
      };

      activeSessions.set(session.threadId, session);
      // lobby 狀態的隊伍重啟後若不重啟逾時計時器，會永遠不解散；補上重新武裝
      if (session.state === "lobby") {
        session.lobbyTimer = setTimeout(async () => {
          const s = activeSessions.get(session.threadId);
          if (s?.state === "lobby") {
            disbandSession(session.threadId);
            await thread.delete("等待逾時自動解散").catch(() => {});
          }
        }, TOWER_LOBBY_TIMEOUT_MS);
      }
      for (const m of session.members) {
        playerThreadMap.set(m.discordId, session.threadId);
        setTowerPresence([m.discordId], true);
      }

      // 在 thread 補發還原通知
      if (starterMessage) {
        const payload = session.state === "lobby"
          ? createTowerThreadLobbyMessage(session)
          : createTowerThreadBattleMessage(session);
        await starterMessage.edit(payload).catch(() => {});
      }
      await thread.send({ content: "🔄 **伺服器已重啟，隊伍狀態已還原。** 隊長可繼續按攻略按鈕。" }).catch(() => {});

      restored++;
    } catch (e) {
      console.error(`[Tower] restore session ${data.threadId} error:`, e);
    }
  }

  if (restored > 0) console.log(`[Tower] 還原 ${restored} 個進行中的隊伍。`);
}

// ── 路由 ─────────────────────────────────────────────────────
function isTowerButton(customId) {
  return typeof customId === "string" && customId.startsWith("tower:");
}

// ── 爬塔藥水：道具 ID 對應 ────────────────────────────────────
const TOWER_POTION_IDS = {
  "f56aefd0-faa8-45b5-8451-fbbae5810c74": { name: "回復藥水（小）",  effect: { type: "tower_heal_flat", value: 80 } },
  "97fbd546-e207-4130-b130-2fadd799703a": { name: "回復藥水（中）",  effect: { type: "tower_heal_flat", value: 200 } },
  "3eb1d302-3d04-40a5-8335-1f9ed844dc27": { name: "回復藥水（大）",  effect: { type: "tower_heal_pct",  value: 50 } },
  "12bfb110-6489-4784-8537-f3f496759f8f": { name: "復活藥水（小）", effect: { type: "tower_revive_pct", value: 30 } },
  "c4794326-ced1-4efe-983d-17c14ee2f2f8": { name: "復活藥水（大）", effect: { type: "tower_revive_pct", value: 70 } },
};

// 爬塔各層掉落藥水機率表（依通關層數，機率 = %，可掉0~1罐）
function getTowerPotionDropPool(floor) {
  if (floor >= 35) return [
    { id: "3eb1d302-3d04-40a5-8335-1f9ed844dc27", chance: 6 },  // 回復大
    { id: "c4794326-ced1-4efe-983d-17c14ee2f2f8", chance: 4 },  // 復活大
    { id: "12bfb110-6489-4784-8537-f3f496759f8f", chance: 3 },  // 復活小
  ];
  if (floor >= 20) return [
    { id: "97fbd546-e207-4130-b130-2fadd799703a", chance: 8 },  // 回復中
    { id: "3eb1d302-3d04-40a5-8335-1f9ed844dc27", chance: 4 },  // 回復大
    { id: "12bfb110-6489-4784-8537-f3f496759f8f", chance: 3 },  // 復活小
  ];
  if (floor >= 10) return [
    { id: "f56aefd0-faa8-45b5-8451-fbbae5810c74", chance: 10 }, // 回復小
    { id: "97fbd546-e207-4130-b130-2fadd799703a", chance: 5 },  // 回復中
  ];
  return [
    { id: "f56aefd0-faa8-45b5-8451-fbbae5810c74", chance: 8 },  // 回復小
  ];
}

// 爬塔通關後嘗試掉落藥水給隨機成員
async function awardFloorPotionDrop(session, floor) {
  const sc = serviceContext;
  const pool = getTowerPotionDropPool(floor);
  const dropped = pool.find((p) => Math.random() * 100 < p.chance);
  if (!dropped) return null;
  const potion = TOWER_POTION_IDS[dropped.id];
  if (!potion) return null;

  const luckyMember = session.members[Math.floor(Math.random() * session.members.length)];

  for (let attempt = 0; attempt < 3; attempt++) {
    const prog = await sc.progressRepository.findByPlayerId(luckyMember.discordId).catch(() => null);
    if (!prog) break;
    const inv = [...(prog.inventory || [])];
    const existing = inv.find((e) => e?.itemId === dropped.id && TOWER_POTION_IDS[e.itemId]);
    if (existing) {
      existing.itemName = potion.name;
      existing.itemEffect = potion.effect;
      existing.itemType = "tower_consumable";
      existing.stackCount = Math.max(1, Number(existing.stackCount) || 1) + 1;
    } else {
      inv.push({
        uuid: require("crypto").randomUUID(),
        itemId: dropped.id,
        itemName: potion.name,
        itemEffect: potion.effect,
        useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
        itemType: "tower_consumable",
        imageUrl: null, imageThumbnailUrl: null,
        equipSlot: null, equipStats: {}, weaponType: null, isTwoHanded: false,
        tier: null, enhanceLevel: 0, stackCount: 1,
        source: "tower_drop", sourceRef: `第${floor}層`,
        purchasedAt: new Date().toISOString(),
      });
    }
    const next = { ...prog, inventory: inv, updatedAt: new Date().toISOString() };
    try {
      if (typeof sc.progressRepository.saveIfUnchanged === "function") {
        const ok = await sc.progressRepository.saveIfUnchanged(next, prog.updatedAt);
        if (ok) return { name: luckyMember.name, itemName: potion.name };
      } else {
        await sc.progressRepository.save(next);
        return { name: luckyMember.name, itemName: potion.name };
      }
    } catch (_) {}
    if (attempt < 2) await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
  }
  return null;
}

// ── 使用道具：隊長按「使用道具」按鈕，彈出藥水選單 ─────────
async function handleUseItem(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordId = interaction.user.id;
  const session = [...activeSessions.values()].find((s) => s.threadId === interaction.channelId);
  if (!session) return interaction.editReply({ content: "❌ 找不到攻塔房間。" });
  if (session.leaderId !== discordId) return interaction.editReply({ content: "❌ 只有隊長可以使用道具。" });
  if (session.state !== "ready_to_fight") return interaction.editReply({ content: "❌ 只能在層與層之間（準備攻略下一層前）使用道具。" });

  // 收集所有成員背包中的爬塔藥水（依 itemId 疊加）
  const sc = serviceContext;
  const allPotions = [];
  for (const m of session.members) {
    const prog = await sc.progressRepository.findByPlayerId(m.discordId).catch(() => null);
    const inv = (prog?.inventory || []).filter((e) => TOWER_POTION_IDS[e.itemId]);
    const grouped = new Map();
    for (const entry of inv) {
      const count = Math.max(1, Number(entry.stackCount) || 1);
      if (grouped.has(entry.itemId)) {
        grouped.get(entry.itemId).count += count;
      } else {
        grouped.set(entry.itemId, { member: m, entry, count });
      }
    }
    for (const g of grouped.values()) allPotions.push(g);
  }

  if (allPotions.length === 0) return interaction.editReply({ content: "🎒 隊伍中目前沒有任何爬塔藥水。" });

  // 建立藥水選單（先選藥水，最多25個選項）
  const options = allPotions.slice(0, 25).map((p) => {
    const potionInfo = TOWER_POTION_IDS[p.entry.itemId];
    const isRevive = potionInfo.effect.type === "tower_revive_pct";
    const isDead = p.member.currentHp <= 0;
    const canUse = isRevive ? isDead : !isDead;
    return {
      label: `${p.entry.itemName}${p.count > 1 ? ` ×${p.count}` : ""}`,
      description: `持有者：${p.member.name}（${isRevive ? "復活，目標需已陣亡" : "回血，目標需存活"}）${canUse ? "" : " ⚠️ 持有者狀態不符"}`,
      value: `${p.entry.itemId}:${p.member.discordId}`,
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("tower:use_item_pick_potion")
    .setPlaceholder("選擇要使用的藥水…")
    .addOptions(options);

  await interaction.editReply({
    content: "🧪 **使用爬塔道具**\n選擇藥水後，再選擇目標隊員。",
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

// ── 選完藥水後，選目標成員 ──────────────────────────────────
async function handlePickPotion(interaction) {
  await interaction.deferUpdate();
  const [itemId, ownerDiscordId] = interaction.values[0].split(":");
  const session = [...activeSessions.values()].find((s) => s.threadId === interaction.channelId);
  if (!session) return interaction.editReply({ content: "❌ 找不到攻塔房間。" });
  if (session.leaderId !== interaction.user.id) return interaction.editReply({ content: "❌ 只有隊長可以使用道具。" });

  const sc = serviceContext;
  const ownerProg = await sc.progressRepository.findByPlayerId(ownerDiscordId).catch(() => null);
  const entry = (ownerProg?.inventory || []).find((e) => e.itemId === itemId && TOWER_POTION_IDS[e.itemId]);
  if (!entry) return interaction.editReply({ content: "❌ 找不到該道具（可能已被使用）。", components: [] });

  const potionInfo = TOWER_POTION_IDS[entry.itemId];
  if (!potionInfo) return interaction.editReply({ content: "❌ 無效的道具。", components: [] });

  const isRevive = potionInfo.effect.type === "tower_revive_pct";

  // 根據藥水類型篩選可選目標
  const validTargets = session.members.filter((m) => isRevive ? m.currentHp <= 0 : m.currentHp > 0);
  if (validTargets.length === 0) {
    const reason = isRevive ? "目前沒有已陣亡的隊員可以復活。" : "目前所有隊員都已陣亡，無法使用回復藥水。";
    return interaction.editReply({ content: `❌ ${reason}`, components: [] });
  }

  const memberOptions = validTargets.map((m) => ({
    label: m.name,
    description: isRevive ? "已陣亡，可復活" : `HP ${m.currentHp} / ${m.maxHp}`,
    value: `${itemId}:${ownerDiscordId}:${m.discordId}`,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("tower:use_item_pick_target")
    .setPlaceholder(`選擇要對誰使用「${entry.itemName}」…`)
    .addOptions(memberOptions);

  await interaction.editReply({
    content: `🧪 **${entry.itemName}** — 選擇目標隊員`,
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

// ── 選完目標後，執行藥水效果 ────────────────────────────────
async function handleApplyPotion(interaction) {
  await interaction.deferUpdate();
  const [itemId, ownerDiscordId, targetDiscordId] = interaction.values[0].split(":");
  const session = [...activeSessions.values()].find((s) => s.threadId === interaction.channelId);
  if (!session) return interaction.editReply({ content: "❌ 找不到攻塔房間。", components: [] });
  if (session.leaderId !== interaction.user.id) return interaction.editReply({ content: "❌ 只有隊長可以使用道具。", components: [] });
  if (session.state !== "ready_to_fight") return interaction.editReply({ content: "❌ 只能在層與層之間使用道具。", components: [] });

  const sc = serviceContext;
  // 從背包取出並消耗道具（疊加藥水：stackCount-1，歸零時移除條目）
  let entry = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const prog = await sc.progressRepository.findByPlayerId(ownerDiscordId).catch(() => null);
    if (!prog) break;
    const idx = (prog.inventory || []).findIndex((e) => e.itemId === itemId && TOWER_POTION_IDS[e.itemId]);
    if (idx === -1) break;
    entry = prog.inventory[idx];
    const stackCount = Math.max(1, Number(entry.stackCount) || 1);
    let newInv;
    if (stackCount <= 1) {
      newInv = prog.inventory.filter((_, i) => i !== idx);
    } else {
      newInv = prog.inventory.map((e, i) => i === idx ? { ...e, stackCount: stackCount - 1 } : e);
    }
    const next = { ...prog, inventory: newInv, updatedAt: new Date().toISOString() };
    try {
      if (typeof sc.progressRepository.saveIfUnchanged === "function") {
        const ok = await sc.progressRepository.saveIfUnchanged(next, prog.updatedAt);
        if (ok) break;
      } else {
        await sc.progressRepository.save(next);
        break;
      }
    } catch (_) {}
    entry = null;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
  }
  if (!entry) return interaction.editReply({ content: "❌ 道具消耗失敗（可能已被使用）。", components: [] });

  const potionInfo = TOWER_POTION_IDS[entry.itemId];
  const target = session.members.find((m) => m.discordId === targetDiscordId);
  if (!target) return interaction.editReply({ content: "❌ 找不到目標隊員。", components: [] });

  const ownerMember = session.members.find((m) => m.discordId === ownerDiscordId);
  const ownerName = ownerMember ? ownerMember.name : "隊員";

  // 套用效果
  const eff = potionInfo.effect;
  let resultMsg = "";
  if (eff.type === "tower_heal_flat") {
    if (target.currentHp <= 0) return interaction.editReply({ content: "❌ 目標已陣亡，無法使用回復藥水。", components: [] });
    const before = target.currentHp;
    target.currentHp = Math.min(target.maxHp, target.currentHp + eff.value);
    const healed = target.currentHp - before;
    resultMsg = `💚 **${target.name}** 恢復了 **${healed} HP**（${before} → ${target.currentHp} / ${target.maxHp}）`;
  } else if (eff.type === "tower_heal_pct") {
    if (target.currentHp <= 0) return interaction.editReply({ content: "❌ 目標已陣亡，無法使用回復藥水。", components: [] });
    const before = target.currentHp;
    const heal = Math.round(target.maxHp * eff.value / 100);
    target.currentHp = Math.min(target.maxHp, target.currentHp + heal);
    const healed = target.currentHp - before;
    resultMsg = `💚 **${target.name}** 恢復了 **${healed} HP**（${eff.value}% MaxHP，${before} → ${target.currentHp} / ${target.maxHp}）`;
  } else if (eff.type === "tower_revive_pct") {
    if (target.currentHp > 0) return interaction.editReply({ content: "❌ 目標尚未陣亡，無法使用復活藥水。", components: [] });
    const reviveHp = Math.round(target.maxHp * eff.value / 100);
    target.currentHp = Math.max(1, reviveHp);
    resultMsg = `✨ **${target.name}** 復活！恢復 **${target.currentHp} HP**（${eff.value}% MaxHP）`;
  }

  await persistSession(session);
  await updateThreadPanel(session, createTowerThreadBattleMessage(session));
  await interaction.editReply({
    content: `${resultMsg}\n（${ownerName} 的「${entry.itemName}」已消耗）`,
    components: [],
  });
}

/** 爬塔暫停開放時，對點面板的玩家回一則私訊提示（不改動面板本身）。 */
async function replyTowerClosed(interaction) {
  const payload = { content: "🗼 爬塔目前暫停開放，敬請期待後續公告。", flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (_) { /* 互動已過期就算了 */ }
}

async function handleTowerButton(interaction) {
  if (!TOWER_ENABLED) return replyTowerClosed(interaction);
  switch (interaction.customId) {
  case TOWER_IDS.openLobby:  return handleOpenLobby(interaction);
  case TOWER_IDS.join:       return handleJoin(interaction);
  case TOWER_IDS.leave:      return handleLeave(interaction);
  case TOWER_IDS.start:      return handleStart(interaction);
  case TOWER_IDS.disband:    return handleDisband(interaction);
  case TOWER_IDS.fightNext:  return handleFightNext(interaction);
  case TOWER_IDS.refresh:    return handleRefresh(interaction);
  case TOWER_IDS.ranking:    return handleRanking(interaction);
  case TOWER_IDS.useItem:    return handleUseItem(interaction);
  }
}

function isTowerSelectMenu(customId) {
  return typeof customId === "string" && (
    customId === "tower:use_item_pick_potion" ||
    customId === "tower:use_item_pick_target"
  );
}

async function handleTowerSelectMenu(interaction) {
  if (!TOWER_ENABLED) return replyTowerClosed(interaction);
  if (interaction.customId === "tower:use_item_pick_potion") return handlePickPotion(interaction);
  if (interaction.customId === "tower:use_item_pick_target") return handleApplyPotion(interaction);
}

function getTowerDiagnostics() {
  const sessionStates = {};
  let memberCount = 0;
  let sessionsWithThreadRef = 0;
  let sessionsWithStarterMessage = 0;
  let lobbyTimers = 0;
  for (const session of activeSessions.values()) {
    const state = session?.state || "unknown";
    sessionStates[state] = (sessionStates[state] || 0) + 1;
    memberCount += Array.isArray(session?.members) ? session.members.length : 0;
    if (session?.thread) sessionsWithThreadRef += 1;
    if (session?.starterMessage) sessionsWithStarterMessage += 1;
    if (session?.lobbyTimer) lobbyTimers += 1;
  }
  return {
    activeSessions: activeSessions.size,
    sessionStates,
    playerThreadMap: playerThreadMap.size,
    memberCount,
    sessionsWithThreadRef,
    sessionsWithStarterMessage,
    lobbyTimers
  };
}

module.exports = {
  TOWER_ENABLED, // 🗼 總開關（playerAppRoutes 的 /api/tower 守衛會讀這個）
  isTowerButton,
  handleTowerButton,
  isTowerSelectMenu,
  handleTowerSelectMenu,
  publishTowerHallPanel,
  publishTowerHallPanelToChannel,
  restoreTowerSessions,
  getTowerDiagnostics,
  // 測試用(模擬塔)：暫時導出內部函式
  fightFloor,
  pickFloorMonster,
  // 網頁組隊爬塔重用：成員準備 / 每層前重算 MaxHP / 隊伍光環彙總 / 戰報壓縮 / 爬塔藥水表
  loadMemberData,
  refreshTowerMemberMaxHp,
  buildTowerPartyEffects,
  compactTowerMemberLogs,
  TOWER_POTION_IDS,
};
