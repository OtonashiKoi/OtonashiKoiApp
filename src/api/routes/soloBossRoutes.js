"use strict";
/**
 * 世界王-單人 API（網頁版新分類）＝現行世界王的「每人獨立版」。
 *   GET  /api/me/solo-boss/status              回傳單人王清單＋個人部位狀態＋今日剩餘擊殺數
 *   POST /api/me/solo-boss/battle { key, part } 打一場（沿用世界王部位/入場費/掉落/打法）
 *
 * 與使用者確認的規格：
 *   ＝現行大史王世界王，其餘全同（3 部位、部位削弱、入場費 5000/場、戰鬥掉落、打法）。
 *   差異：每人自己一份部位狀態；HP 45 萬；不限場次累積磨；每日最多「擊殺 3 隻」＝領 3 次獎勵
 *        （每殺一隻：直接掉落計算 ＋ 額外 1 個大史王寶箱）；隔日重置；不進全服榜/冷卻。
 */
const { Router } = require("express");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");
const crypto = require("crypto");
const {
  ensureWorldBossPartState, getWorldBossPartKeys, getWorldBossPartWeakness,
  applyWorldBossTargetToPlayerStats, applyWorldBossTargetToMonster,
  isWorldBossAllPartsDefeated,
} = require("../../bot/handlers/monsterZoneHandlers");
const { bestiaryGainFromDamage } = require("../../shared/bestiary");
const { buildItemEffectLines } = require("../../shared/itemEffectLines");

const PART_LABELS = { head: "頭部", body: "軀幹", wings: "龍翼", legs: "下盤", upper_body: "上軀幹", lower_body: "下軀幹", tail: "尾巴" };

const SOLO_BOSSES = {
  daishi: {
    key: "daishi", zone: "elite", monsterName: "大史王", monsterId: "elite-daishi-king",
    maxHp: 450000, killsPerDay: 3, entryFee: 5000,
    chestId: "chest-daishi-king", chestName: "大史王寶箱",
    chestEffect: { type: "open_world_boss_chest", monsterId: "elite-daishi-king", bossName: "大史王" },
  },
};

function taipeiDateKey(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }

// 戰鬥每回合節奏（與 quick-battle 同公式，讓單人戰鬥速度一致）
function calculateTickDelay(agi = 1) {
  const baseDelay = 1500, minDelay = 500, capAgi = 40;
  const capped = Math.min(Math.max(1, agi), capAgi);
  return Math.round(baseDelay - ((capped - 1) / (capAgi - 1)) * (baseDelay - minDelay));
}

// 讀個人狀態（含部位血），日界線重置；擊殺後重生也在此保底
function readState(progress, boss) {
  const all = (progress.soloBoss && typeof progress.soloBoss === "object") ? progress.soloBoss : {};
  const cur = all[boss.key] || {};
  const today = taipeiDateKey();
  if (cur.dateKey !== today) {
    const seed = ensureWorldBossPartState({}, boss.maxHp, boss.zone);
    return { dateKey: today, killsToday: 0, worldBossPartsHp: seed.worldBossPartsHp, worldBossPartsMaxHp: seed.worldBossPartsMaxHp };
  }
  const ensured = ensureWorldBossPartState(
    { worldBossPartsHp: cur.worldBossPartsHp, worldBossPartsMaxHp: cur.worldBossPartsMaxHp },
    boss.maxHp, boss.zone
  );
  return { dateKey: today, killsToday: Math.max(0, Number(cur.killsToday) || 0), worldBossPartsHp: ensured.worldBossPartsHp, worldBossPartsMaxHp: ensured.worldBossPartsMaxHp };
}

function partsForResp(boss, partsHp, partsMaxHp) {
  const keys = getWorldBossPartKeys(boss.zone) || Object.keys(partsHp);
  return keys.filter((k) => Object.prototype.hasOwnProperty.call(partsHp, k)).map((k) => {
    const hp = Math.max(0, Number(partsHp[k] || 0));
    const max = Math.max(1, Number((partsMaxHp || {})[k] || hp || 1));
    return { key: k, name: PART_LABELS[k] || k, currentHp: Math.round(hp), maxHp: Math.round(max), broken: hp <= 0, weak: getWorldBossPartWeakness(boss.zone, k) };
  });
}

const soloInFlight = new Set();

function createSoloBossRoutes(serviceContext) {
  const router = Router();
  const repo = serviceContext.progressRepository;

  async function resolveMonster(boss) {
    const list = await serviceContext.monsterService.listMonsters({ includeDisabled: true, zone: boss.zone });
    return list.find((m) => m.id === boss.monsterId || m.name === boss.monsterName) || null;
  }

  async function saveSoloState(discordId, boss, st) {
    const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
    const db = await getMongoDb();
    await db.collection("progress").updateOne(
      { playerId: discordId },
      { $set: { [`soloBoss.${boss.key}`]: st, updatedAt: new Date().toISOString() } }
    );
  }

  router.get("/api/me/solo-boss/status", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await repo.findByPlayerId(discordId);
      if (!progress) return res.status(404).json(fail("PLAYER_NOT_FOUND", "找不到玩家進度"));
      const bosses = [];
      for (const boss of Object.values(SOLO_BOSSES)) {
        const st = readState(progress, boss);
        const m = await resolveMonster(boss).catch(() => null);
        const parts = partsForResp(boss, st.worldBossPartsHp, st.worldBossPartsMaxHp);
        const killsLeft = Math.max(0, boss.killsPerDay - st.killsToday);
        // 回傳「世界王 WorldBossEntry」形狀 → 前端直接重用現行世界王面板/部位攻擊
        bosses.push({
          zoneKey: `solo:${boss.key}`, bossKey: boss.key, bossName: `${boss.monsterName}（單人）`,
          element: m?.element || null,
          imageUrl: m?.imageUrl || null,
          bossMaxHp: boss.maxHp, currentHp: parts.reduce((s, p) => s + p.currentHp, 0),
          respawnCooldownMinutes: 0, cooldownRemainingMs: 0, cooldownRemainingMinutes: 0,
          canChallenge: killsLeft > 0, lastKilledAt: null, battleTimeLimitMinutes: 15,
          parts, partEffects: [],
          hints: { title: "單人挑戰（每人獨立一隻）", lines: [
            `血量 ${boss.maxHp.toLocaleString()}、入場費 ${boss.entryFee.toLocaleString()} 🪙/場，不限場次累積磨。`,
            `破 3 部位＝擊殺一隻 → 掉落 ＋ ${boss.chestName} ×1。`,
            `今日還可擊殺 ${killsLeft}/${boss.killsPerDay} 隻（隔日重置）。`,
          ] },
          // 額外欄位（前端可選用）
          killsPerDay: boss.killsPerDay, killsToday: st.killsToday, killsLeft, entryFee: boss.entryFee,
        });
      }
      return res.json(ok({ bosses }));
    } catch (err) { next(err); }
  });

  router.post("/api/me/solo-boss/battle", requireAuth, async (req, res, next) => {
    const { discordId, displayName } = req.playerRecord;
    if (soloInFlight.has(discordId)) return res.status(409).json(fail("BUSY", "你已有一場單人王戰鬥進行中。"));
    soloInFlight.add(discordId);
    try {
      const key = String(req.body?.key || "").trim();
      const boss = SOLO_BOSSES[key];
      if (!boss) return res.status(400).json(fail("INVALID_ARGUMENT", "未知的單人王"));
      const partKeys = getWorldBossPartKeys(boss.zone) || [];
      const part = String(req.body?.part || "").trim();
      if (!partKeys.includes(part)) return res.status(400).json(fail("INVALID_PART", "請選擇要攻擊的部位"));

      const progress = await repo.findByPlayerId(discordId);
      if (!progress) return res.status(404).json(fail("PLAYER_NOT_FOUND", "找不到玩家進度"));

      // 背包已滿 → 不能出戰（在收入場費之前擋下）
      {
        const bagFull = await require("../../services/backpack/backpackService")
          .checkBackpackFullForBattle(discordId, progress.inventory).catch(() => null);
        if (bagFull) {
          return res.status(409).json({ status: "error", code: "bag_full", message: bagFull.message });
        }
      }

      // 續航偵測：與 DC／一般討伐共用同一份連續遊玩計時，避免換入口繞過驗證
      {
        const humanCheck = require("../../services/humanCheck/humanCheckService");
        const gate = await humanCheck.guard(discordId);
        if (!gate.ok) return res.status(429).json(humanCheck.webPayload(gate));
      }

      const st = readState(progress, boss);
      if (st.killsToday >= boss.killsPerDay) {
        return res.status(400).json(fail("NO_KILLS", `今日已擊敗 ${boss.killsPerDay} 隻${boss.monsterName}，明天再來！`));
      }

      const partHpNow = Math.max(0, Number(st.worldBossPartsHp[part] || 0));
      if (partHpNow <= 0) {
        return res.status(409).json({ status: "error", code: "part_broken", message: `${PART_LABELS[part] || "該部位"}已被擊破，請重新選擇部位。`, part, parts: partsForResp(boss, st.worldBossPartsHp, st.worldBossPartsMaxHp) });
      }

      const monster = await resolveMonster(boss);
      if (!monster) return res.status(500).json(fail("BOSS_NOT_FOUND", "找不到單人王資料"));

      // 玩家/怪物數值
      const { calcPlayerStats } = require("../../shared/combatStats");
      const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");
      const equipped = await mergeEquippedFromLibrary(progress.equipment || {}, serviceContext.itemRepository);
      const petStat = require("../../shared/petDex").statBonusOf(progress.petDex);
      let pStats = calcPlayerStats(progress.attributes || {}, equipped, progress.activeEffects || [], progress.inventory || [], { pkRating: progress.pkRating, zone: boss.zone, petStat });

      // 入場費（同現行；金幣不足擋下）
      if (boss.entryFee > 0) {
        const walletNow = await serviceContext.walletService.getWalletByDiscordId(discordId, displayName).catch(() => null);
        const goldOwned = Math.max(0, Number(walletNow?.wallet?.gold ?? walletNow?.gold) || 0);
        if (goldOwned < boss.entryFee) {
          return res.status(400).json(fail("NO_GOLD", `挑戰 ${boss.monsterName} 需要 ${boss.entryFee.toLocaleString()} 金幣，你目前只有 ${goldOwned.toLocaleString()} 金幣。`));
        }
        await serviceContext.rewardService.grantCurrency({
          discordId, displayName, currencyType: "gold", amount: -boss.entryFee,
          source: require("../../shared/sources").CURRENCY_SOURCES.MONSTER_ENTRY_FEE, operator: "solo_boss:web_enter_battle",
        });
      }

      // 部位調整（同現行）
      pStats = applyWorldBossTargetToPlayerStats(pStats, part, boss.zone).stats || pStats;
      const adjM = applyWorldBossTargetToMonster(monster.calc, monster.equipment || {}, part, boss.zone);
      const battleMonsterStats = adjM.monsterStats || monster.calc;
      const battleMonsterEquipped = adjM.monsterEquipped || monster.equipment || {};

      // 戰鬥：以「該部位當前血量」為基準（同現行）
      // 戰鬥姿態（同 quick-battle）
      let battleStanceKey = null;
      try {
        battleStanceKey = require("../../shared/battleStance").resolveRequestedStance(equipped, req.body?.stance);
      } catch (stanceErr) {
        return res.status(stanceErr.statusCode || 400).json({ status: "error", message: stanceErr.message });
      }

      // 連擊氣條（影舞者）：單人王＝世界王簡化版,氣條照累、滿格照觸發；
      const _sg = require("../../shared/shadowGauge");
      const shadowOn = _sg.hasGauge(equipped?.job_eq);
      const shadowGridsBefore = shadowOn ? _sg.read(progress, boss.zone) : 0;
      // 氣力格（劍鬼）：與網頁共用同一份狀態（同區跨場沿用）
      const _og = require("../../shared/oniGauge");
      const oniOn = _og.hasGauge(equipped?.job_eq);
      const oniGridsBefore = oniOn ? _og.read(progress, boss.zone) : 0;
      // 日之精靈（聖靈師）：跨場沿用
      const _ssp = require("../../shared/sunSpirit");
      const spiritOn = _ssp.hasSpirit(equipped?.job_eq);
      const spiritPctBefore = spiritOn ? _ssp.read(progress, boss.zone) : 0;
      // 震盪值（神射手）：跨場沿用（單人王沒有掩護射擊——沒有隊友可掩護）
      const _sng = require("../../shared/sniperGauge");
      const sniperOn = _sng.hasGauge(equipped?.job_eq);
      const sniperGridsBefore = sniperOn ? _sng.read(progress, boss.zone) : 0;
      // 命運骰＋手氣（賭神）
      const _dgg = require("../../shared/diceGauge");
      const diceGodOn = _dgg.hasGauge(equipped?.job_eq);
      const diceGridsBefore = diceGodOn ? _dgg.read(progress, boss.zone) : 0;
      const diceLuckBefore = diceGodOn ? _dgg.readLuck(progress) : 0;
      // 計謀值（兵聖）：跨場沿用
      const _sag = require("../../shared/sageGauge");
      const sageOn = _sag.hasGauge(equipped?.job_eq);
      const sageGridsBefore = sageOn ? _sag.read(progress, boss.zone) : 0;
      // 演奏判定（吟遊詩人）
      const _bs = require("../../shared/bardSong");
      const bardOn = _bs.hasSong(equipped?.job_eq);
      const bardResult = bardOn
        ? _bs.scorePerformance(progress?.bardScore || null, req.body?.bardInput || null, _bs.readStreak(progress, boss.zone))
        : null;

      // 戰意集氣＋血祭（狂戰士，同 quick-battle；單人王也是「打一次怪」）
      const _bg = require("../../shared/berserkGauge");
      const _ja = require("../../shared/jobAdvancement");
      const gaugeCfg = _ja.getGauge(equipped?.job_eq);
      const sacrificeCfg = _ja.getSacrifice(equipped?.job_eq);
      const gaugeBefore = gaugeCfg ? _bg.read(progress, gaugeCfg) : 0;
      const gaugeFull = Boolean(gaugeCfg && _bg.isFull(gaugeBefore, gaugeCfg));
      const berserkEffects = gaugeFull ? _bg.buffs(gaugeCfg) : [];
      let sacrificeOn = false;
      if (req.body?.sacrifice === true) {
        if (!sacrificeCfg) {
          return res.status(400).json({ status: "error", message: "此職業無法使用「血祭」" });
        }
        sacrificeOn = true;
        berserkEffects.push(..._bg.sacrificeBuffs(sacrificeCfg));
      }

      // ── 暈眩條（矮人戰士長・巨神震擊）── 單人王＝世界王簡化版，每人自己一條
      const _dsg = require("../../shared/dwarfStunGauge");
      const stunGaugeKey = _dsg.gaugeKeyForSolo(discordId, boss.key);
      const stunStateBefore = await _dsg.read(stunGaugeKey, boss.zone).catch(() => null);
      const teamStunOn = Boolean(stunStateBefore?.stunned);

      // ── 區域冰凍值（元素師・凍霜）── 單人王每人自己一條；與暈眩條完全分開
      const _zfg = require("../../shared/zoneFreezeGauge");
      const freezeGaugeKey = _zfg.gaugeKeyForSolo(discordId, boss.key);
      const freezeStateBefore = await _zfg.read(freezeGaugeKey, boss.zone).catch(() => null);
      const zoneFrozenOn = Boolean(freezeStateBefore?.frozen);

      // ── 區域聖域值（聖域師）── 單人王每人自己一條；窗口內出戰受傷減半＋每回合回血
      const _scg = require("../../shared/sanctumGauge");
      const sanctumGaugeKey = _scg.gaugeKeyForSolo(discordId, boss.key);
      const sanctumStateBefore = await _scg.read(sanctumGaugeKey, boss.zone).catch(() => null);
      const zoneSanctumOn = Boolean(sanctumStateBefore?.sanctum);
      const _SANCTUM_DEF = require("../../shared/jobAdvancement").getSanctum({ itemId: "job_sanctum_t2_v1" });

      const { runCombatLoop } = require("../../shared/combatLoop");
      const r = runCombatLoop(pStats, battleMonsterStats, monster.name, Math.max(1, partHpNow), undefined, {
        stance: battleStanceKey,
        teamStunRounds: (teamStunOn || zoneFrozenOn) ? 999 : 0,
        teamStunStyle: (!teamStunOn && zoneFrozenOn) ? "freeze" : undefined,
        monsterEquipped: battleMonsterEquipped, playerLevel: progress.level, monsterLevel: battleMonsterStats.level,
        equipped, inventory: progress.inventory || [],
        playerActiveEffects: [...(progress.activeEffects || []), ...berserkEffects],
        monsterElement: monster?.element || null, // 屬性相剋；無 element 則不參與
        monsterElementLevel: monster?.element ? (monster?.elementLevel || 1) : 0,
        sacrificeHpCostPct: sacrificeOn ? sacrificeCfg.hpCostPct : 0,
        sacrificeAtkUpPct: sacrificeOn ? sacrificeCfg.atkUpPct : 0,
        warGaugeCritBonus: gaugeFull ? gaugeCfg.critRateBonus : 0,
        shadowGaugeGrids: shadowGridsBefore, // 連擊氣條（影舞者）
        oniGaugeGrids: oniGridsBefore,       // 氣力格（劍鬼）
        sunSpiritHpPct: spiritOn ? spiritPctBefore : undefined, // 日之精靈（聖靈師）
        sniperGaugeGrids: sniperGridsBefore, // 震盪值（神射手）
        sageGaugeGrids: sageGridsBefore,     // 計謀值（兵聖）
        diceGaugeGrids: diceGridsBefore,     // 命運骰（賭神）
        diceLuckStacks: diceLuckBefore,      // 手氣正旺（賭神）
        bardDamageMult: bardResult?.dmgMult, // 演奏判定（吟遊詩人）
        bardChordPct: bardResult?.chordPct,
        bardPerformNote: bardResult?.note,
        // 聖域窗口（聖域師）：本場受傷減免＋每回合回血
        sanctuaryCutPct: zoneSanctumOn ? (Number(_SANCTUM_DEF?.sanctumDamageCutPct) || 50) : 0,
        sanctuaryHealPct: zoneSanctumOn ? (Number(_SANCTUM_DEF?.sanctumHealPct) || 3) : 0,
      });
      // 連擊氣條（影舞者）：戰後氣量落地
      if (shadowOn) {
        const _nextShadow = _sg.next(r?.shadowGauge ?? shadowGridsBefore, boss.zone);
        progress.shadowGauge = _nextShadow;
        await serviceContext.progressRepository.updateFields(discordId, { shadowGauge: _nextShadow }).catch(() => {});
      }
      // 氣力格（劍鬼）：戰後氣量落地
      if (oniOn) {
        const _nextOni = _og.next(r?.oniGauge ?? oniGridsBefore, boss.zone);
        progress.oniGauge = _nextOni;
        await serviceContext.progressRepository.updateFields(discordId, { oniGauge: _nextOni }).catch(() => {});
      }
      // 日之精靈（聖靈師）：戰後血量落地
      if (spiritOn) {
        const _nextSpirit = _ssp.next(r?.sunSpirit?.hpPct ?? spiritPctBefore, boss.zone);
        progress.sunSpirit = _nextSpirit;
        await serviceContext.progressRepository.updateFields(discordId, { sunSpirit: _nextSpirit }).catch(() => {});
      }
      // 震盪值（神射手）：戰後格數落地
      if (sniperOn) {
        const _nextSniper = _sng.next(r?.sniperGauge ?? sniperGridsBefore, boss.zone);
        progress.sniperGauge = _nextSniper;
        await serviceContext.progressRepository.updateFields(discordId, { sniperGauge: _nextSniper }).catch(() => {});
      }
      // 計謀值（兵聖）：戰後格數落地
      if (sageOn) {
        const _nextSage = _sag.next(r?.sageGauge ?? sageGridsBefore, boss.zone);
        progress.sageGauge = _nextSage;
        await serviceContext.progressRepository.updateFields(discordId, { sageGauge: _nextSage }).catch(() => {});
      }
      // 命運骰＋手氣（賭神）：戰後格數與手氣層落地
      if (diceGodOn) {
        const _nextDice = _dgg.next(r?.diceGauge ?? diceGridsBefore, boss.zone);
        const _nextLuck = _dgg.nextLuck(r?.diceLuck ?? diceLuckBefore);
        progress.diceGauge = _nextDice;
        progress.diceLuck = _nextLuck;
        await serviceContext.progressRepository.updateFields(discordId, { diceGauge: _nextDice, diceLuck: _nextLuck }).catch(() => {});
      }
      // 演奏判定（吟遊詩人）：連奏落地＋出下一題（陣亡＝連奏歸零；難度依戰後連奏）
      if (bardOn) {
        const _bardDied = r?.outcome === "lose";
        const _bardStreakAfter = _bardDied ? 0 : (bardResult?.streak || 0);
        // 難度階梯：完美→照連奏爬升；沒全對→降一級（困難→普通→簡單）；陣亡/換區/閒置→回簡單
        const _lvBefore = _bs.readLevel(progress, boss.zone);
        const _lvAfter = _bardDied
          ? 0
          : (_bardStreakAfter > 0 ? Math.max(_lvBefore, _bs.levelFromStreak(_bardStreakAfter)) : Math.max(0, _lvBefore - 1));
        const _nextStreak = _bs.nextStreak(_bardStreakAfter, boss.zone, _lvAfter);
        const _nextChallenge = _bs.newChallenge(_lvAfter);
        progress.bardStreak = _nextStreak;
        progress.bardScore = _nextChallenge;
        await serviceContext.progressRepository.updateFields(discordId, { bardStreak: _nextStreak, bardScore: _nextChallenge }).catch(() => {});
      }
      // 戰後存氣（updateFields 只動這個欄位）
      if (gaugeCfg) {
        const _nextGauge = _bg.next(gaugeBefore, gaugeCfg, { consumed: gaugeFull });
        progress.berserkGauge = _nextGauge;
        await serviceContext.progressRepository.updateFields(discordId, { berserkGauge: _nextGauge }).catch(() => {});
      }
      const newPartHp = Math.max(0, Number(r.finalMonsterHp) || 0);
      const partsHp = { ...st.worldBossPartsHp, [part]: newPartHp };
      // ── 炎圈（元素師）：單人王也是「所有部位一起受傷」── 其他尚存部位鏡射炎圈總傷
      let fcMirrorTotal = 0;
      {
        const _fcDmg = Math.max(0, Math.round(Number(r?.combatStats?.fireCircleDamage) || 0));
        if (_fcDmg > 0) {
          for (const _pk of Object.keys(partsHp)) {
            if (_pk === part) continue;
            const _cur = Math.max(0, Number(partsHp[_pk] || 0));
            if (_cur <= 0) continue;
            const _dealt = Math.min(_cur, _fcDmg);
            partsHp[_pk] = _cur - _dealt;
            fcMirrorTotal += _dealt;
          }
        }
      }
      const partBroken = newPartHp <= 0 && partHpNow > 0;
      const allDefeated = isWorldBossAllPartsDefeated(partsHp);

      const rewardLines = [];
      const drops = [];
      // 敲暈眩條（只有矮人戰士長敲得動）；單人王不發全服公告。
      // ⚠️ 必須放在 rewardLines 宣告之後——之前插在前面造成 TDZ ReferenceError（單人王整個開不了）
      let stunKnock = null;
      if (_dsg.canKnock(equipped?.job_eq)) {
        stunKnock = await _dsg
          .knock(stunGaugeKey, boss.zone, r?.combatStats?.attackRounds || 0, displayName || "")
          .catch(() => null);
        if (stunKnock?.triggered) {
          rewardLines.push(`⛰️ **巨神震擊**！**${monster.name}** 應聲倒地——接下來 ${Math.round(_dsg.STUN_WINDOW_MS / 1000)} 秒出戰全程免傷！`);
        } else if (stunKnock?.knocked > 0) {
          rewardLines.push(`🔨 暈眩值 +${stunKnock.knocked}（${stunKnock.gauge} / ${stunKnock.threshold}）`);
        }
      }
      // 炎圈鏡射戰報行＋累積冰凍值（元素師・凍霜姿態；不廣播）
      if (fcMirrorTotal > 0) {
        rewardLines.push(`🔥 **炎圈**延燒全身——其他部位共受到 **${fcMirrorTotal.toLocaleString()}** 點灼燒！`);
      }
      let freezeKnock = null;
      if (_zfg.canKnock(equipped?.job_eq) && battleStanceKey === "frost") {
        // 累積量＝戰鬥回合數（不論命中）
        freezeKnock = await _zfg
          .knock(freezeGaugeKey, boss.zone, Math.max(0, (Number(r?.nextRound) || 1) - 1), displayName || "")
          .catch(() => null);
        if (freezeKnock?.triggered) {
          rewardLines.push(`🧊 **區域冰封**！**${monster.name}** 被凍結——接下來 ${Math.round(_zfg.FREEZE_WINDOW_MS / 1000)} 秒出戰全程免傷！`);
        } else if (freezeKnock?.knocked > 0) {
          rewardLines.push(`❄️ 冰凍值 +${freezeKnock.knocked}（${freezeKnock.gauge} / ${freezeKnock.threshold}）`);
        }
      }
      // ── 累積區域聖域值（只有聖域師）── 每場 +1；不廣播
      let sanctumKnock = null;
      if (_scg.canKnock(equipped?.job_eq)) {
        sanctumKnock = await _scg.knock(sanctumGaugeKey, boss.zone, 1, displayName || "").catch(() => null);
        if (sanctumKnock?.triggered) {
          rewardLines.push(`🏛️ **聖域展開**！聖光籠罩戰場——${Math.round(_scg.SANCTUM_WINDOW_MS / 1000)} 秒內出戰受傷減半、每回合回血！`);
        } else if (sanctumKnock?.knocked > 0) {
          rewardLines.push(`✨ 聖域值 +${sanctumKnock.knocked}（${sanctumKnock.gauge} / ${sanctumKnock.threshold}）`);
        }
      }
      let killsToday = st.killsToday;
      let nextPartsHp = partsHp;
      const nextPartsMax = st.worldBossPartsMaxHp;
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();

      // KDA（附錄C v3）：單人世界王也是世界王場次——K/D 計入賽季累積（單人無隊友，助攻自然為空）
      try {
        let _resistPct = 0;
        try {
          _resistPct = require("../../shared/elementSystem")
            .getSameElementResist(equipped || {}, monster?.element || null).pct || 0;
        } catch (_) { /* 抗性算不出來就當 0 */ }
        require("../../services/kda/kdaService").recordBattle({
          discordId, displayName,
          damage: Math.max(0, Math.round(Number(r.totalDamage) || 0)),
          died: r?.outcome === "lose",
          quest: {
            questService: serviceContext.questService || serviceContext.weeklyQuestService,
            rounds: (r?.nextRound || 2) - 1,
            resistPct: _resistPct,
          },
        }).catch(() => {});
      } catch (_) { /* KDA 記錄失敗不影響結算 */ }

      // 圖鑑進度：每場依「本場傷害/部位血量」累積（同現行世界王，記在同一隻大史王圖鑑）
      try {
        const partMax = Math.max(1, Number(st.worldBossPartsMaxHp[part] || partHpNow));
        const bGain = bestiaryGainFromDamage(r.totalDamage, partMax);
        if (bGain > 0) {
          const monId = String(monster.id || boss.monsterId);
          await db.collection("progress").updateOne({ playerId: discordId }, { $inc: { ["bestiary." + monId]: bGain } });
          rewardLines.push(`📖 圖鑑進度 +${Math.round(bGain * 100) / 100}`);
        }
      } catch (_) { /* noop */ }

      if (partBroken && !allDefeated) {
        rewardLines.push(`💥 已擊破 **${monster.name}** 的${PART_LABELS[part] || "部位"}！繼續擊破其餘部位才能屠王。`);
      }

      if (allDefeated) {
        killsToday += 1;
        // 擊殺獎勵：經驗 + 金錢（同現行大史王）
        const expReward = Math.max(0, Number(monster.expReward) || 0);
        const goldReward = Math.max(0, Number(monster.goldReward) || 0);
        if (expReward > 0 && serviceContext.progressService?.grantExp) {
          try { await serviceContext.progressService.grantExp({ discordId, displayName, amount: expReward, source: "solo_boss_kill" }); } catch (_) { /* noop */ }
        }
        if (goldReward > 0) {
          try { await serviceContext.rewardService.grantCurrency({ discordId, displayName, currencyType: "gold", amount: goldReward, source: "solo_boss_kill", operator: "solo_boss:kill" }); } catch (_) { /* noop */ }
        }
        // 直接骰掉落表（LUK 微加成）；掉落給前端用 toWebDrop 完整格式（才顯示名字/圖/特效）
        const luk = Math.max(0, Number(pStats.luk) || 0);
        for (const d of (monster.drops || [])) {
          const chance = Math.max(0, Number(d.chance) || 0) + luk * 0.1;
          if (Math.random() * 100 < chance) {
            const item = await serviceContext.itemRepository.findById(d.itemId).catch(() => null);
            if (!item) continue;
            const entry = {
              uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name,
              itemEffect: item.effect || { type: "none", value: 0 },
              useEffects: item.useEffects || [], passiveEffects: item.passiveEffects || [],
              procEffects: item.procEffects || [], combatEffects: item.combatEffects || [],
              itemType: item.itemType || "consumable", imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
              equipSlot: item.equipSlot || null, equipStats: item.equipStats ? { ...item.equipStats } : {},
              weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
              atkStat: item.atkStat || null, tier: item.tier || null, monsterCardSkill: item.monsterCardSkill || null,
              enhanceLevel: 0, source: "solo_boss_drop", sourceRef: monster.name, purchasedAt: new Date().toISOString(),
            };
            try { require("../../services/enchant/enchantService").rollForEntry(entry); } catch (_) { /* noop */ }
            try {
              await repo.addOrStackInventoryItem(discordId, item.id, entry);
              drops.push({
                uuid: entry.uuid, itemId: item.id, name: item.name,
                image: item.imageThumbnailUrl || item.imageUrl || null, imageUrl: item.imageUrl || null,
                tier: item.tier || null, itemType: item.itemType || null, equipSlot: item.equipSlot || null,
                equipStats: entry.equipStats || {}, weaponType: item.weaponType || null, isTwoHanded: !!item.isTwoHanded,
                effect: item.effect || null, useEffects: entry.useEffects, passiveEffects: entry.passiveEffects,
                procEffects: entry.procEffects, combatEffects: entry.combatEffects, monsterCardSkill: item.monsterCardSkill || null,
                effectLines: (() => { try { return buildItemEffectLines(entry); } catch (_) { return []; } })(),
                source: "solo_boss_drop", sourceRef: monster.name,
              });
              // 世界王卡(怪物卡·稀有 0.1%)→ 廣播到聊天大廳＋DC，比照寶箱公告
              if (item.monsterCardOf || item.monsterCardSkill) {
                try {
                  const tc = require("../../shared/announceTownChat");
                  const who = await tc.resolveDiscordName(discordId).catch(() => (displayName || "某位勇者"));
                  tc.announceTownChat(`🃏✨ **${who}** 單人討伐 **${monster.name}**，打到了世界王卡【**${item.name}**】！稀有難得！`).catch(() => {});
                } catch (_) { /* 公告失敗不影響掉落 */ }
              }
            } catch (_) { /* noop */ }
          }
        }
        // 額外 1 個寶箱（原子）
        const chestEntry = {
          uuid: crypto.randomUUID(), itemId: boss.chestId, itemName: boss.chestName, itemEffect: boss.chestEffect,
          itemType: "consumable", equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false, tier: null,
          source: "solo_boss", sourceRef: `solo:${boss.key}`, purchasedAt: new Date().toISOString(), name: boss.chestName,
        };
        try { await repo.addOrStackInventoryItem(discordId, boss.chestId, chestEntry); } catch (e) { console.error("[SoloBoss] chest grant failed:", e?.message || e); }
        // 擊殺獎勵總結（讓戰報通知看得到）
        rewardLines.push(`🏆 **擊敗 ${monster.name}！**`);
        if (expReward > 0) rewardLines.push(`✨ 經驗 +${expReward.toLocaleString()}`);
        if (goldReward > 0) rewardLines.push(`🪙 金幣 +${goldReward.toLocaleString()}`);
        rewardLines.push(`🎁 獲得 **${boss.chestName}** ×1`);
        if (drops.length) rewardLines.push(`📦 掉落：**${drops.map((d) => d.name).join("、")}**`);
        // 擊殺後：今日還有次數 → 重生一隻新的（部位回滿）；否則維持全破（今日結束）
        if (killsToday < boss.killsPerDay) {
          const fresh = ensureWorldBossPartState({}, boss.maxHp, boss.zone);
          nextPartsHp = fresh.worldBossPartsHp;
        }
      }

      const killsLeft = Math.max(0, boss.killsPerDay - killsToday);
      rewardLines.push(`🏆 今日擊殺 ${killsToday}/${boss.killsPerDay}（剩 ${killsLeft} 次獎勵）`);

      // 落地狀態（原子 $set，避免全文件覆寫競態）
      await saveSoloState(discordId, boss, { dateKey: st.dateKey, killsToday, worldBossPartsHp: nextPartsHp, worldBossPartsMaxHp: nextPartsMax });

      const respParts = partsForResp(boss, allDefeated && killsLeft > 0 ? nextPartsHp : partsHp, nextPartsMax);
      // CD 與現行世界王完全同公式：回合數 × perRoundMs(依 AGI 的 tickMs) + 2000 + 敗北再加 10 秒
      const _perRoundMs = process.env.ROUND_MS ? (Number(process.env.ROUND_MS) || 900) : calculateTickDelay(pStats.agi || 1);
      const animDurationMs = (r.roundLogs || []).length * _perRoundMs + 2000 + (r.outcome === "lose" ? 10000 : 0);

      return res.json(ok({
        outcome: allDefeated ? "win" : r.outcome,
        monsterName: monster.name, monsterImageUrl: monster.imageUrl || null,
        monsterElement: monster?.element || null,
        monsterElementLevel: monster?.element ? (monster?.elementLevel || 1) : 0,
        logs: r.roundLogs || [], rewardLines, drops,
        totalDamage: r.totalDamage, finalPlayerHp: Math.max(0, r.finalPlayerHp || 0),
        playerMaxHp: Math.max(1, Math.round(Number(pStats.maxHp) || 0)),
        // 血條顯示「本場所打部位」的血量（同現行世界王）
        finalMonsterHp: newPartHp, monsterStartHp: partHpNow, monsterMaxHp: Math.max(1, Number(st.worldBossPartsMaxHp[part] || partHpNow)),
        cooldownMs: animDurationMs,
        tickMs: calculateTickDelay(pStats.agi || 1),
        // 部位資訊（前端刷新部位血條 + 是否破 + 全破）
        targetPart: part, partName: PART_LABELS[part] || part,
        partHp: { current: newPartHp, max: Math.max(1, Number(st.worldBossPartsMaxHp[part] || partHpNow)) },
        partBroken, allPartsDefeated: allDefeated, parts: respParts,
        // 單人王狀態
        soloBoss: { key: boss.key, killsToday, killsLeft, killedFull: allDefeated, chestGranted: allDefeated },
        // 戰意集氣（狂戰士）：戰後最新氣量；非狂戰士回 null
        berserkGauge: gaugeCfg ? { ..._bg.view(progress, gaugeCfg), unleashed: gaugeFull, sacrificed: sacrificeOn } : null,
        // 連擊氣條（影舞者）：戰後氣量
        shadowGauge: shadowOn ? _sg.view(r?.shadowGauge ?? shadowGridsBefore) : null,
        // 氣力格（劍鬼）：戰後氣量
        oniGauge: oniOn ? _og.view(r?.oniGauge ?? oniGridsBefore) : null,
        // 日之精靈（聖靈師）：戰後精靈血量
        sunSpirit: spiritOn ? (r?.sunSpirit || null) : null,
        // 震盪值（神射手）：戰後格數
        sniperGauge: sniperOn ? _sng.view(r?.sniperGauge ?? sniperGridsBefore) : null,
        diceGauge: diceGodOn ? _dgg.view(r?.diceGauge ?? diceGridsBefore, r?.diceLuck ?? diceLuckBefore) : null,
        // 計謀值（兵聖）：戰後格數
        sageGauge: sageOn ? _sag.view(r?.sageGauge ?? sageGridsBefore) : null,
        // 演奏判定（吟遊詩人）：下一題＋演奏結果
        bardSong: bardOn ? {
          ..._bs.viewChallenge(progress.bardScore),
          streak: bardResult?.streak || 0,
          last: bardResult?.played ? { correct: bardResult.correct, wrong: bardResult.wrong, perfect: bardResult.perfect, mult: bardResult.dmgMult } : null,
        } : null,
        // 暈眩條（矮人戰士長）：戰後最新狀態＋本場是否吃到免傷
        bossStun: {
          ..._dsg.view(await _dsg.read(stunGaugeKey, boss.zone).catch(() => null)),
          immune: teamStunOn,
          knocked: stunKnock?.knocked || 0,
          triggeredByMe: Boolean(stunKnock?.triggered),
          canKnock: _dsg.canKnock(equipped?.job_eq),
        },
        // 區域冰凍值（元素師・凍霜）：單人王每人自己一條
        zoneFreeze: {
          ..._zfg.view(await _zfg.read(freezeGaugeKey, boss.zone).catch(() => null)),
          immune: zoneFrozenOn,
          knocked: freezeKnock?.knocked || 0,
          triggeredByMe: Boolean(freezeKnock?.triggered),
          canKnock: _zfg.canKnock(equipped?.job_eq),
        },
        // 區域聖域值（聖域師）：單人王每人自己一條
        zoneSanctum: {
          ..._scg.view(await _scg.read(sanctumGaugeKey, boss.zone).catch(() => null)),
          active: zoneSanctumOn,
          knocked: sanctumKnock?.knocked || 0,
          triggeredByMe: Boolean(sanctumKnock?.triggered),
          canKnock: _scg.canKnock(equipped?.job_eq),
        },
      }));
    } catch (err) {
      next(err);
    } finally {
      soloInFlight.delete(discordId);
    }
  });

  return router;
}

module.exports = { createSoloBossRoutes };
