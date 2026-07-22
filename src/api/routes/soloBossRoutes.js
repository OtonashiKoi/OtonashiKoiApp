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

      const { runCombatLoop } = require("../../shared/combatLoop");
      const r = runCombatLoop(pStats, battleMonsterStats, monster.name, Math.max(1, partHpNow), undefined, {
        stance: battleStanceKey,
        teamStunRounds: teamStunOn ? 999 : 0,
        monsterEquipped: battleMonsterEquipped, playerLevel: progress.level, monsterLevel: battleMonsterStats.level,
        equipped, inventory: progress.inventory || [],
        playerActiveEffects: [...(progress.activeEffects || []), ...berserkEffects],
        monsterElement: monster?.element || null, // 屬性相剋；無 element 則不參與
        sacrificeHpCostPct: sacrificeOn ? sacrificeCfg.hpCostPct : 0,
        sacrificeAtkUpPct: sacrificeOn ? sacrificeCfg.atkUpPct : 0,
        warGaugeCritBonus: gaugeFull ? gaugeCfg.critRateBonus : 0,
      });
      // 戰後存氣（updateFields 只動這個欄位）
      if (gaugeCfg) {
        const _nextGauge = _bg.next(gaugeBefore, gaugeCfg, { consumed: gaugeFull });
        progress.berserkGauge = _nextGauge;
        await serviceContext.progressRepository.updateFields(discordId, { berserkGauge: _nextGauge }).catch(() => {});
      }
      const newPartHp = Math.max(0, Number(r.finalMonsterHp) || 0);
      const partsHp = { ...st.worldBossPartsHp, [part]: newPartHp };
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
      let killsToday = st.killsToday;
      let nextPartsHp = partsHp;
      const nextPartsMax = st.worldBossPartsMaxHp;
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();

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
        // 暈眩條（矮人戰士長）：戰後最新狀態＋本場是否吃到免傷
        bossStun: {
          ..._dsg.view(await _dsg.read(stunGaugeKey, boss.zone).catch(() => null)),
          immune: teamStunOn,
          knocked: stunKnock?.knocked || 0,
          triggeredByMe: Boolean(stunKnock?.triggered),
          canKnock: _dsg.canKnock(equipped?.job_eq),
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
