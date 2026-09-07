"use strict";

const recordQuestForPlayersInBackground = (...args) => require("./battleQuestProgress").recordQuestForPlayersInBackground(...args);
const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");

const { isEffectConditionMet, collectEquipmentEffects, mergeEquippedFromLibrary, applyEffectInstances, decrementActiveEffects } = require("../../shared/effectEngine");
const collectRewardEffectRefs = (...args) => require("./battleRewardRules").collectRewardEffectRefs(...args);
const buildRewardModifiers = (...args) => require("./battleRewardRules").buildRewardModifiers(...args);
const toMultiplier = (...args) => require("./battleRewardRules").toMultiplier(...args);
const getDynamicGoldPoolFloor = (...args) => require("./battleRewardRules").getDynamicGoldPoolFloor(...args);
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const _announceLevelMilestone = (...args) => require("./battlePresentation")._announceLevelMilestone(...args);

async function grantKillCurrencyAndExp(context) {
  const { state, discordId, zoneKey, monster, sc, displayName, totalDamage, session, rewardLines } = context;
  // 參戰名單（含本次打到尾段的玩家）
  const participants = [...new Set([...(Array.isArray(state.participants) ? state.participants : []), discordId])];

  // 世界王解鎖累計：原 hard 區拆成古城/古城深處，兩區擊殺都算
  if ((zoneKey === "ancient_city" || zoneKey === "ancient_city_deep") && !monster?.isBoss && sc.worldBossServiceFor(zoneKey)) {
    await sc.worldBossServiceFor(zoneKey).recordHardZoneKill(1).catch(() => {});
  }

  // 任務勝利判定：怪物被擊殺時，全參戰者都算 1 次勝利。
  // 這裡統一寫入，確保 Discord/Web 兩條戰鬥流程規則一致。
  recordQuestForPlayersInBackground(sc.questService || sc.weeklyQuestService, participants, "battle_win", 1);

  // ── 依傷害比例計算每人分配量 ──
  const rawDmgMap = state.damageMap || {};
  // 合入本次尾段傷害
  const mergedDmg = { ...rawDmgMap, [discordId]: { name: displayName, damage: (rawDmgMap[discordId]?.damage || 0) + totalDamage } };
  const battleHpBasis = Math.max(1, Number(monster?.calc?.maxHp || session.monsterMaxHp || 1));
  const dmgRatio = (pid) => Math.min(1, Math.max(0, (mergedDmg[pid]?.damage || 0) / battleHpBasis));

  // ── 不使用怪物等級做獎勵壓制 ──

  // 每位參戰者的獎勵紀錄（用來最後 DM 通知）
  const perPidRewards = {};
  participants.forEach(pid => { perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [], healerGoldBonus: 0, healerExpBonus: 0, isHealer: false }; });
  // 圖鑑：本次出手者(discordId)的「本場累積%」掛到他的獎勵紀錄,擊殺 DM 會顯示
  if (session && session._bestiary && perPidRewards[discordId]) {
    perPidRewards[discordId].bestiary = session._bestiary;
  }
  const canSendRewardNotice = (pid) => !perPidRewards[pid]?._expGrantFailed;

  // 預載參戰者資料，用於個人化結算倍率（金幣 / EXP / 掉落）
  const progressCache = {};
  await Promise.all(participants.map(async (pid) => {
    const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
    if (prog) progressCache[pid] = prog;
  }));
  await Promise.all(participants.map(async (pid) => {
    const prog = progressCache[pid];
    if (prog) {
      // 永遠從 DB 讀取最新 effects，確保光環與獎勵加成使用最新設計值
      prog.equipment = await mergeEquippedFromLibrary(prog.equipment || {}, sc.itemRepository);
    }
  }));
  const rewardModsByPid = {};
  const partyRewardEffects = [];
  for (const pid of participants) {
    const prog = progressCache[pid];
    if (!prog) continue;
    for (const effect of collectRewardEffectRefs(prog)) {
      if (effect?.target === "party") partyRewardEffects.push({ ...effect, sourcePlayerId: pid });
    }
  }
  const activeAura = state?.activeHealerAura;
  if (activeAura?.effects && !participants.includes(activeAura.discordId)) {
    for (const effect of activeAura.effects) {
      if (effect?.target === "party") partyRewardEffects.push({ ...effect, sourcePlayerId: activeAura.discordId });
    }
  }
  await Promise.all(participants.map(async (pid) => {
    const prog = progressCache[pid];
    rewardModsByPid[pid] = buildRewardModifiers(prog, partyRewardEffects);
  }));

  // ── 光環職業（治療師/軍師/詩人/結界師）本人結算時額外 +10% 金幣、EXP、掉落率 +5% ──
  const AURA_JOB_IDS = ["healer", "tactician", "bard", "barrier_mage"];
  const AURA_JOB_NAMES = ["治療", "軍師", "詩人", "結界"];
  const healerBonusPids = new Set();
  for (const pid of participants) {
    const prog = progressCache[pid];
    if (!prog) continue;
    const jobEq = prog.equipment?.job_eq;
    if (!jobEq) continue;
    const jobId = String(jobEq.itemId || jobEq.id || "").toLowerCase();
    const jobName = String(jobEq.itemName || jobEq.name || "").toLowerCase();
    const isAuraJob = AURA_JOB_IDS.some(k => jobId.includes(k)) || AURA_JOB_NAMES.some(k => jobName.includes(k));
    if (isAuraJob) {
      healerBonusPids.add(pid);
      if (perPidRewards[pid]) perPidRewards[pid].isHealer = true;
      const mod = rewardModsByPid[pid];
      mod.goldPct    = (mod.goldPct    || 0) + 10;
      mod.expPct     = (mod.expPct     || 0) + 10;
      mod.dropPct    = (mod.dropPct    || 0) + 5;
      mod.goldMultiplier = toMultiplier(mod.goldPct);
      mod.expMultiplier  = toMultiplier(mod.expPct);
      mod.dropMultiplier = toMultiplier(mod.dropPct);
    }
  }

  // ── 耕作疲勞：一般區域連續打怪滿6h → 該玩家經驗/金幣 ×0.2（世界王不算）。每位參戰者各自算。
  const _isWorldBossKill = isWorldBossZone(zoneKey) && Boolean(monster?.isBoss);
  const fatigueMultByPid = {};
  if (!_isWorldBossKill) {
    const farmFatigue = require("../../services/farmFatigue/farmFatigueService");
    const _now = Date.now();
    for (const pid of participants) {
      fatigueMultByPid[pid] = await farmFatigue.applyAndGetMultiplier(pid, _now).catch(() => 1);
    }
  }
  const fatMul = (pid) => fatigueMultByPid[pid] ?? 1;
  if (fatMul(discordId) < 1) rewardLines.push("🥱 連續耕作已滿 6 小時，經驗/金幣暫時 −80%（停打一般區域 30 分鐘即恢復）");

  // ── 金幣依比例分配 ──
  // 依玩家各自對「怪物完整血量」的傷害比例結算
  const dynamicGoldPool = getDynamicGoldPoolFloor(zoneKey, participants.length);
  const effectiveGoldReward = Math.max(monster.goldReward || 0, dynamicGoldPool);

  let myBaseGoldShare = 0;
  if (effectiveGoldReward > 0) {
    for (const pid of participants) {
      const baseShare = Math.max(1, Math.round(effectiveGoldReward * dmgRatio(pid)));
      const mod = rewardModsByPid[pid] || { goldMultiplier: 1 };
      const share = Math.max(1, Math.round(baseShare * mod.goldMultiplier * fatMul(pid)));
      try {
        await sc.rewardService.grantCurrency({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          currencyType: "gold", amount: share,
          source: CURRENCY_SOURCES.MONSTER_KILL_REWARD, operator: "monster_zone",
          // 不可用以 monster.seq 為基礎的 sourceRef：seq 會隨怪物輪替重複出現，
          // 重複擊殺同一隻怪會被誤判為重複交易而「不發金幣」。
          // 一次性結算已由 claimKill(DB 原子) + killInProgress 保證，無需 sourceRef。
        });
        if (perPidRewards[pid]) perPidRewards[pid].gold = share;
      } catch (e) {
        console.error(`[MonsterZone] grantCurrency(gold) failed for ${pid}`, e);
        if (perPidRewards[pid]) perPidRewards[pid]._goldGrantFailed = true;
      }
    }

    const myBaseShare = Math.max(1, Math.round(effectiveGoldReward * dmgRatio(discordId)));
    myBaseGoldShare = myBaseShare;
    const myMod = rewardModsByPid[discordId] || { goldMultiplier: 1, goldPct: 0 };
    const myShare = Math.max(1, Math.round(myBaseShare * myMod.goldMultiplier * fatMul(discordId)));
    const pct = `${Math.round(dmgRatio(discordId) * 100)}%`;
    const poolNote = dynamicGoldPool > (monster.goldReward || 0) ? `（動態金幣池）` : "";
    const modNote = myMod.goldPct > 0 ? `，個人加成 +${Math.round(myMod.goldPct)}%` : "";
    rewardLines.push(`你造成了 **${totalDamage}** 點傷害。`);
    rewardLines.push(`💰 金幣 +${myShare}（傷害佔比 ${pct}，共 ${effectiveGoldReward}${poolNote}${modNote}）`);
  }

  // ── EXP 依比例分配（含組隊倍率）──
  // 組隊倍率：人多共鬥獎勵更多，封頂 ×3.5
  // 組隊倍率公式：1~2人=×1.0，3人起平滑無上限增加
  // mult = 1 + (n-2)^0.7 × 0.6，人越多總池越大但每人平均遞減，不會爆量
  const n = participants.length;
  const partyMult = n <= 2 ? 1.0 : +(1 + Math.pow(n - 2, 0.7) * 0.6).toFixed(2);
  const effectiveExpReward = Math.round(monster.expReward * partyMult);

  let myBaseExpShare = 0;
  if (effectiveExpReward > 0) {
    const myBaseShare = Math.max(1, Math.round(effectiveExpReward * dmgRatio(discordId)));
    myBaseExpShare = myBaseShare;
    const myMod = rewardModsByPid[discordId] || { expMultiplier: 1, expPct: 0 };
    const myShare = Math.max(1, Math.round(myBaseShare * myMod.expMultiplier * fatMul(discordId)));
    let killerLvLine = "";
    let killerOverflowGold = 0; // 滿等溢出經驗轉的金幣（給戰報顯示）
    for (const pid of participants) {
      const baseShare = Math.max(1, Math.round(effectiveExpReward * dmgRatio(pid)));
      const mod = rewardModsByPid[pid] || { expMultiplier: 1 };
      const share = Math.max(1, Math.round(baseShare * mod.expMultiplier * fatMul(pid)));
      try {
        const expResult = await sc.progressService.grantExp({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          amount: share, source: EXP_SOURCES.MONSTER_KILL
        });
        if (perPidRewards[pid]) {
          perPidRewards[pid].exp = share;
          perPidRewards[pid].overflowGold = Number(expResult.overflowGold) || 0; // 滿等溢出→金幣(給網頁戰報)
          if (expResult.levelUps > 0) {
            perPidRewards[pid].levelUps = expResult.levelUps;
            perPidRewards[pid].newLevel = expResult.progress?.level ?? 0;
            perPidRewards[pid].levelUpDetails = expResult.levelUpDetails || [];
          }
        }
        if (pid === discordId) killerOverflowGold = Number(expResult.overflowGold) || 0;
        if (expResult.levelUps > 0) {
          const prevLevel = (expResult.progress?.level ?? 0) - expResult.levelUps;
          const pidName = pid === discordId ? displayName : (mergedDmg[pid]?.name || pid);
          _announceLevelMilestone(sc, pid, pidName, prevLevel, expResult.progress.level).catch(() => {});
        }
        if (pid === discordId && expResult.levelUps > 0) {
          const detailText = Array.isArray(expResult.levelUpDetails) && expResult.levelUpDetails.length
            ? expResult.levelUpDetails.map((lv) => `Lv.${lv.level}：${Array.isArray(lv.attrsZh) ? lv.attrsZh.join("、") : ""}`).join("；")
            : "";
          killerLvLine = detailText
            ? ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}\n   ${detailText}`
            : ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}`;
        }
      } catch (e) {
        console.error(`[MonsterZone] grantExp failed for ${pid}`, e?.message || e);
        // 記錄失敗原因，幫助診斷 DM 通知與實際經驗值不符的問題
        if (!perPidRewards[pid]) perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
        perPidRewards[pid]._expGrantFailed = true;
      }
    }

    const pct = `${Math.round(dmgRatio(discordId) * 100)}%`;
    const partyNote = partyMult > 1 ? `　👥 ×${partyMult}（${participants.length}人）` : "";
    const modNote = myMod.expPct > 0 ? `，個人加成 +${Math.round(myMod.expPct)}%` : "";
    if (canSendRewardNotice(discordId)) {
      rewardLines.push(`⭐ EXP +${myShare}（傷害佔比 ${pct}，共 ${effectiveExpReward}${partyMult > 1 ? ` 原${monster.expReward}` : ""}${modNote}）${partyNote}${killerLvLine}`);
      if (killerOverflowGold > 0) {
        rewardLines.push(`💰 已滿等，溢出經驗轉為 ${killerOverflowGold} 金幣`);
      }
    } else {
      console.warn(`[MonsterZone] skip EXP line for ${discordId} because EXP was not committed`);
    }
  }

  return { healerBonusPids, perPidRewards, participants, rewardModsByPid, mergedDmg, canSendRewardNotice, progressCache };
}

module.exports = { grantKillCurrencyAndExp };
