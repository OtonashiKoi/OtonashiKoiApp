"use strict";

const { Router } = require("express");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");
const { calcPlayerStats } = require("../../shared/combatStats");
const { runCombatLoop } = require("../../shared/combatLoop");
const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");
const { isWorldBossZone } = require("../../services/worldBoss/worldBossService");

const MAX_ITERATIONS = 200;
const DEFAULT_ROUNDS = 15;
const WORLD_BOSS_PARTS = new Set(["head", "body", "legs", "wings"]);

function authenticate(req, res, next) {
  const token = (req.header("Authorization") || "").replace("Bearer ", "");
  if (token !== config.api.adminPassword) {
    res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
    return;
  }
  next();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function applyWorldBossPhase(monsterStats, phase) {
  if (!phase) return { ...monsterStats };
  return {
    ...monsterStats,
    atk: Math.max(1, Math.round(toNumber(monsterStats.atk, 1) * Math.max(0.1, toNumber(phase.atkMultiplier, 1)))),
    def: clamp(toNumber(monsterStats.def) * Math.max(0.1, toNumber(phase.defMultiplier, 1)), 0, 75),
  };
}

function applyWorldBossTarget(playerStats, monsterStats, part, zone) {
  const nextPlayer = { ...playerStats };
  const nextMonster = { ...monsterStats };
  const target = WORLD_BOSS_PARTS.has(part) ? part : "body";

  // 古龍王採破部位削弱，攻擊當下不套一般世界王的部位難度。
  if (zone === "dragon_king_lair" || target === "wings") {
    return { playerStats: nextPlayer, monsterStats: nextMonster, part: target };
  }
  if (target === "body") {
    nextPlayer.atk = Math.max(1, Math.round(toNumber(nextPlayer.atk, 1) * 0.8));
    nextMonster.flatDef = Math.max(0, Math.round(toNumber(nextMonster.flatDef) * 1.6));
  } else if (target === "legs") {
    nextMonster.atk = Math.max(1, Math.round(toNumber(nextMonster.atk, 1) * 1.3));
  }
  return { playerStats: nextPlayer, monsterStats: nextMonster, part: target };
}

function applyDragonKingBrokenParts(monsterStats, brokenParts = {}) {
  const next = { ...monsterStats };
  if (brokenParts.legs) {
    next.atk = Math.max(1, Math.round(toNumber(next.atk, 1) * 0.8));
  }
  return next;
}

function applyWorldBossMonsterEquipped(monsterEquipped, part, zone, brokenParts = {}) {
  const next = { ...(monsterEquipped || {}) };
  const card = next.special_1;
  if (!card?.monsterCardSkill) return next;

  const skill = {
    ...card.monsterCardSkill,
    procEffects: Array.isArray(card.monsterCardSkill.procEffects)
      ? card.monsterCardSkill.procEffects.map((effect) => ({
        ...effect,
        params: { ...(effect.params || {}) },
      }))
      : card.monsterCardSkill.procEffects,
  };

  if (zone !== "dragon_king_lair" && part === "head") {
    skill.chance = Math.min(100, toNumber(skill.chance, 30) + 25);
  }
  if (zone === "dragon_king_lair") {
    if (brokenParts.body) {
      skill.chance = Math.min(toNumber(skill.chance, 50), 30);
    }
    if (brokenParts.wings && Array.isArray(skill.procEffects)) {
      skill.procEffects = skill.procEffects.map((effect) => (
        effect?.key === "lightning"
          ? {
            ...effect,
            params: {
              ...(effect.params || {}),
              value: Math.max(1, Math.round(toNumber(effect.params?.value) * 0.85)),
            },
          }
          : effect
      ));
    }
  }

  next.special_1 = {
    ...card,
    monsterCardSkill: skill,
    cardProcChance: skill.chance,
  };
  return next;
}

function normalizeCustomStats(input = {}) {
  const maxHp = Math.max(1, Math.round(toNumber(input.maxHp, 1000)));
  return {
    str: Math.max(0, toNumber(input.str, 1)),
    agi: Math.max(0, toNumber(input.agi, 1)),
    vit: Math.max(0, toNumber(input.vit, 1)),
    int: Math.max(0, toNumber(input.int, 1)),
    dex: Math.max(0, toNumber(input.dex, 1)),
    luk: Math.max(0, toNumber(input.luk, 1)),
    maxHp,
    atk: Math.max(1, Math.round(toNumber(input.atk, 100))),
    def: clamp(toNumber(input.def), 0, 85),
    flatDef: Math.max(0, toNumber(input.flatDef)),
    dodge: clamp(toNumber(input.dodge), 0, 95),
    hit: clamp(toNumber(input.hit, 75), 0, 100),
    crit: clamp(toNumber(input.crit), 0, 100),
    combo: clamp(toNumber(input.combo), 0, 100),
    comboDamageMultiplier: Math.max(0.1, toNumber(input.comboDamageMultiplier, 1)),
    blockChance: clamp(toNumber(input.blockChance), 0, 95),
    weaponMainStatValue: Math.max(0, toNumber(input.weaponMainStatValue)),
    weaponType: input.weaponType || null,
    dmgMin: clamp(toNumber(input.dmgMin, 0.7), 0.1, 1),
    dmgMax: clamp(toNumber(input.dmgMax, 1), 0.1, 1),
    bypassMonsterDefPct: clamp(toNumber(input.bypassMonsterDefPct), 0, 100),
    armorBreakChance: clamp(toNumber(input.armorBreakChance), 0, 100),
    stunChance: clamp(toNumber(input.stunChance), 0, 100),
    stunDuration: Math.max(1, Math.round(toNumber(input.stunDuration, 3))),
    monsterAttackCount: Math.max(1, Math.round(toNumber(input.monsterAttackCount, 1))),
    tierDamageMultiplier: Math.max(0.1, toNumber(input.tierDamageMultiplier, 1)),
    tierFinalDamageMultiplier: Math.max(0.1, toNumber(input.tierFinalDamageMultiplier, 1)),
    tierBossDamageMultiplier: Math.max(0.1, toNumber(input.tierBossDamageMultiplier, 1)),
    tierCritDamageMultiplier: Math.max(0.1, toNumber(input.tierCritDamageMultiplier, 1)),
    executeChance: clamp(toNumber(input.executeChance), 0, 100),
    executeThresholdPct: clamp(toNumber(input.executeThresholdPct), 0, 100),
  };
}

async function resolvePlayer(serviceContext, body) {
  if (body.mode === "custom") {
    return {
      name: String(body.playerName || "自訂玩家"),
      level: Math.max(1, Math.round(toNumber(body.playerLevel, 1))),
      stats: normalizeCustomStats(body.customStats),
      equipped: {},
      inventory: [],
      activeEffects: [],
    };
  }

  const discordId = String(body.discordId || "").trim();
  if (!discordId) throw new Error("請選擇玩家");
  const [player, progress] = await Promise.all([
    serviceContext.playerRepository.findByDiscordId(discordId),
    serviceContext.progressRepository.findByPlayerId(discordId),
  ]);
  if (!player || !progress) throw new Error("找不到玩家資料");

  const equipped = await mergeEquippedFromLibrary(
    progress.equipment || {},
    serviceContext.itemRepository
  );
  const attributes = progress.attributes || {};
  const stats = calcPlayerStats(
    attributes,
    equipped,
    progress.activeEffects || [],
    progress.inventory || [],
    { pkRating: progress.pkRating }
  );
  return {
    name: player.displayName || player.name || discordId,
    level: Math.max(1, Math.round(toNumber(progress.level, 1))),
    stats,
    equipped,
    inventory: progress.inventory || [],
    activeEffects: progress.activeEffects || [],
  };
}

function summarize(results) {
  const damages = results.map((row) => row.totalDamage);
  const rounds = results.map((row) => row.combatStats?.attackCount || 0);
  const count = Math.max(1, results.length);
  const outcomes = results.reduce((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] || 0) + 1;
    return acc;
  }, {});
  return {
    iterations: results.length,
    averageDamage: Math.round(damages.reduce((sum, value) => sum + value, 0) / count),
    minDamage: Math.min(...damages),
    maxDamage: Math.max(...damages),
    averageAttacks: Math.round((rounds.reduce((sum, value) => sum + value, 0) / count) * 10) / 10,
    wins: outcomes.win || 0,
    losses: outcomes.lose || 0,
    timeouts: outcomes.timeout || 0,
    winRate: Math.round(((outcomes.win || 0) / count) * 1000) / 10,
  };
}

function createAdminCombatCalculatorRoutes(serviceContext) {
  const router = Router();
  router.use("/admin/combat-calculator", authenticate);

  router.get("/admin/combat-calculator/options", async (_req, res, next) => {
    try {
      const [players, monsters] = await Promise.all([
        serviceContext.playerRepository.listAll(),
        serviceContext.monsterService.listMonsters({ includeDisabled: true }),
      ]);
      res.json(ok({
        players: players
          .filter((player) => player.status !== "disabled")
          .map((player) => ({
            discordId: player.discordId,
            displayName: player.displayName || player.name || player.discordId,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-Hant")),
        monsters: monsters.map((monster) => ({
          id: monster.id,
          name: monster.name,
          zone: monster.zone || "normal",
          enabled: monster.enabled !== false,
          isBoss: Boolean(monster.isBoss),
          imageUrl: monster.imageThumbnailUrl || monster.imageUrl || null,
          calc: monster.calc,
        })),
      }, "combat calculator options fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/combat-calculator/simulate", async (req, res, next) => {
    try {
      const body = req.body || {};
      const monster = await serviceContext.monsterService.getMonsterById(String(body.monsterId || ""));
      const player = await resolvePlayer(serviceContext, body);
      const iterations = clamp(Math.round(toNumber(body.iterations, 20)), 1, MAX_ITERATIONS);
      const maxRounds = clamp(Math.round(toNumber(body.maxRounds, DEFAULT_ROUNDS)), 1, 100);
      const zone = monster.zone || "normal";
      const worldBoss = isWorldBossZone(zone) && monster.isBoss;
      let phase = null;
      let baseMonsterStats = { ...monster.calc, isBoss: Boolean(monster.isBoss) };
      let basePlayerStats = { ...player.stats, level: player.level };
      let monsterEquipped = buildMonsterEquipped(monster);

      if (worldBoss) {
        const worldBossService = serviceContext.worldBossServiceFor?.(zone);
        const config = await worldBossService?.getConfig();
        phase = worldBossService?.resolvePhase(config, clamp(toNumber(body.worldBossHpPct, 100), 0, 100)) || null;
        baseMonsterStats = applyWorldBossPhase(baseMonsterStats, phase);
        const targeted = applyWorldBossTarget(basePlayerStats, baseMonsterStats, body.worldBossPart, zone);
        basePlayerStats = targeted.playerStats;
        baseMonsterStats = targeted.monsterStats;
        if (zone === "dragon_king_lair") {
          baseMonsterStats = applyDragonKingBrokenParts(baseMonsterStats, body.brokenParts || {});
        }
        monsterEquipped = applyWorldBossMonsterEquipped(
          monsterEquipped,
          body.worldBossPart,
          zone,
          body.brokenParts || {}
        );
      }

      const results = [];
      for (let index = 0; index < iterations; index += 1) {
        results.push(runCombatLoop(
          { ...basePlayerStats },
          { ...baseMonsterStats },
          monster.name,
          monster.calc.maxHp,
          maxRounds,
          {
            playerName: player.name,
            playerLevel: player.level,
            equipped: player.equipped,
            inventory: player.inventory,
            playerActiveEffects: player.activeEffects.map((effect) => ({
              ...effect,
              params: { ...(effect.params || {}) },
            })),
            monsterEquipped,
            monsterIsBoss: Boolean(monster.isBoss),
            worldBossPhase: phase,
            isWorldBoss: worldBoss,
            zone,
            bestiaryBonusPct: clamp(toNumber(body.bestiaryBonusPct), 0, 30),   // 上限留 30 容納兵聖知彼放大後的值
          }
        ));
      }

      res.json(ok({
        player: {
          name: player.name,
          level: player.level,
          stats: basePlayerStats,
        },
        monster: {
          id: monster.id,
          name: monster.name,
          zone,
          isBoss: Boolean(monster.isBoss),
          stats: baseMonsterStats,
          maxHp: monster.calc.maxHp,
        },
        worldBoss: worldBoss ? {
          phase,
          part: WORLD_BOSS_PARTS.has(body.worldBossPart) ? body.worldBossPart : "body",
          brokenParts: body.brokenParts || {},
        } : null,
        summary: summarize(results),
        sample: results[0],
      }, "combat simulation completed"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createAdminCombatCalculatorRoutes,
};
