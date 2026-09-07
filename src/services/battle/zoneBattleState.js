"use strict";

const killInProgress = new Set();

const GOLD_POOL_RULE_BY_ZONE = {
  beginner: { minPerPlayer: 80 },
  normal: { minPerPlayer: 220 },
  mid: { minPerPlayer: 650 },
  hard: { minPerPlayer: 1200 },
  elite: { minPerPlayer: 6000 }
};

const RARE_TIERS = new Set(["A", "S", "SS", "SSR", "UR"]);

const ZONE_PARTICIPATION_GEM_TIER = {
  beginner: 'D', normal: 'D', mid: 'C', hard: 'B', elite: 'A',
  ancient_city: 'B',
  // A 階區域統一給 A 石：秘銀(深處)/龍鱗(龍族)/焚獄(火焰)/期間活動
  ancient_city_deep: 'A', dragon_realm: 'A', hellfire: 'A',
  dragon_king_lair: 'A', hellfire_depths: 'A',
  event_1: 'A', event_boss: 'A', event_boss_hutao_preview: 'A'
};

const GEM_TIER_ORDER = ["D", "C", "B", "A"];

const ENHANCE_GEM_IDS = {
  'D': '72fde92d-e33f-42fb-8d86-2e811d03f84d',
  'C': '556db9e1-b084-4b22-bab5-a66c2b586184',
  'B': '8fdfa7d9-f0fa-4e6a-a291-703b1e354072',
  'A': 'a6ae293d-52fc-4af5-8770-891ddf842e35'
};

const GEM_PARTICIPATION_RATE = { D: 0.20, C: 0.20, B: 0.12, A: 0.06 };

const GEM_PARTICIPATION_DOUBLE_DROP_RATE = {};

const HUTAO_PREVIEW_ZONE = "event_boss_hutao_preview";

const HELLFANG_ZONE = "hellfire_depths";

const DRAGON_KING_ZONE = "dragon_king_lair";

const TURTLE_ZONE = "event_boss";

const worldBossTimeoutTimers = new Map();

const WORLD_BOSS_CHEST_BY_MONSTER = {
  "elite-daishi-king": "chest-daishi-king",
  "dragon-king-boss": "chest-dragon-king",
  "0393acee-9851-4bcb-a8f5-fdb60a9968f1": "chest-hellfang-king", // 地獄狼牙王
  "event-island-turtle": "chest-island-turtle",                  // 島島龜王（期間限定活動）
};

const zoneLastChosen = new Map();

const zoneEventTimers = new Map();

const BOSS_SPAWN_BROADCAST_ENABLED = false;

const monsterTransitionTimers = new Map();

const MONSTER_TRANSITION_MS = 500;

const activeMonsterTransitions = new Map();

const SUPPORT_JOB_KEYS = new Set(["healer", "tactician", "bard", "barrier_mage"]);

const MAX_ROUNDS = 15;

const BTN = {
  enterBattle: "monster-zone:enter-battle",
  enterBattlePrefix: "monster-zone:enter-battle:",
  deleteLog:   "monster-zone:delete-log",
  humanCheckPrefix: "monster-zone:human-check:" // <token>:<選項index>
};

const WORLD_BOSS_TARGET_PARTS = new Set(["head", "body", "legs", "wings", "upper_body", "lower_body", "tail"]);

const HELLFANG_CORE_PLAYER_MULT = 0.7;

const HELLFANG_PART_WEAKNESS = { head: "physical", upper_body: "magic", lower_body: "physical", tail: "magic", legs: "physical" };

const HELLFANG_WRONG_TYPE_MULT = 0.3;

const HELLFANG_FLIP_FRACTION = 1 / 3;

const HELLFANG_FLIP_DURATION_MS = 10 * 60 * 1000;

const HELLFANG_PART_LABELS = { head: "頭部", upper_body: "上軀幹", lower_body: "下軀幹", tail: "尾巴", legs: "腿部" };

const HELLFANG_FRENZY_DODGE_BONUS = 40;

const HELLFANG_FRENZY_DMG_MULT = 0.5;

module.exports = { killInProgress, GOLD_POOL_RULE_BY_ZONE, RARE_TIERS, ZONE_PARTICIPATION_GEM_TIER, GEM_TIER_ORDER, ENHANCE_GEM_IDS, GEM_PARTICIPATION_RATE, GEM_PARTICIPATION_DOUBLE_DROP_RATE, HUTAO_PREVIEW_ZONE, HELLFANG_ZONE, DRAGON_KING_ZONE, TURTLE_ZONE, worldBossTimeoutTimers, WORLD_BOSS_CHEST_BY_MONSTER, zoneLastChosen, zoneEventTimers, BOSS_SPAWN_BROADCAST_ENABLED, monsterTransitionTimers, MONSTER_TRANSITION_MS, activeMonsterTransitions, SUPPORT_JOB_KEYS, MAX_ROUNDS, BTN, WORLD_BOSS_TARGET_PARTS, HELLFANG_CORE_PLAYER_MULT, HELLFANG_PART_WEAKNESS, HELLFANG_WRONG_TYPE_MULT, HELLFANG_FLIP_FRACTION, HELLFANG_FLIP_DURATION_MS, HELLFANG_PART_LABELS, HELLFANG_FRENZY_DODGE_BONUS, HELLFANG_FRENZY_DMG_MULT };
