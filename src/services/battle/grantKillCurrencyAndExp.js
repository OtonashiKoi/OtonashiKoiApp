"use strict";

const recordQuestForPlayersInBackground = (...args) => require("./battleQuestProgress").recordQuestForPlayersInBackground(...args);
const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");

const { isEffectConditionMet, collectEquipmentEffects, mergeEquippedFromLibrary, applyEffectInstances, decrementActiveEffects } = require("../../shared/effectEngine");
const collectRewardEffectRefs = (...args) => require("./battleRewardRules").collectRewardEffectRefs(...args);
const buildRewardModifiers = (...args) => require("./battleRewardRules").buildRewardModifiers(...args);
const toMultiplier = (...args) => require("./battleRewardRules").toMultiplier(...args);
const getDynamicGoldPoolFloor = (...args) => require("./battleRewardRules").getDynamicGoldPoolFloor(...args);
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { normalExpPerPlayerPct, normalExpPerPlayer } = require("../monster/normalCoopScaling");
const { normalZoneExpMultiplier } = require("../../shared/normalZoneExp");
const _announceLevelMilestone = (...args) => require("./battlePresentation")._announceLevelMilestone(...args);

async function grantKillCurrencyAndExp(context) {
  const { state, discordId, zoneKey, monster, sc, displayName, totalDamage, session, rewardLines } = context;
  const liveKey=state.normalLive?.encounterKey;
  const journal=require("../realtime/normalLiveJournal");
  // 參戰名單（含本次打到尾段的玩家）
  const worldBossReward = isWorldBossZone(zoneKey) && Boolean(monster?.isBoss);
  const encounterGroup = require('../../shared/encounterGroup');
  const encounterSize = encounterGroup.encounterCount(state, monster);
  const groupExpBonusPct = worldBossReward ? 0 : encounterGroup.expBonusPct(state, monster);
  const rawDmgMap = state.damageMap || {};
  const listedParticipants = [...new Set([...(Array.isArray(state.participants) ? state.participants : []), discordId])];
  // 一般區只有實際造成傷害或有效支援的人可領獎；世界王沿用原本名單。
  const participants = worldBossReward ? listedParticipants : [...new Set([...listedParticipants, ...Object.keys(rawDmgMap)])]
    .filter((pid) => Number(rawDmgMap[pid]?.damage) > 0 || Number(rawDmgMap[pid]?.assist) > 0);

  // 世界王解鎖累計：原 hard 區拆成古城/古城深處，兩區擊殺都算
  if ((zoneKey === "ancient_city" || zoneKey === "ancient_city_deep") && !monster?.isBoss && sc.worldBossServiceFor(zoneKey)) {
    await sc.worldBossServiceFor(zoneKey).recordHardZoneKill(encounterSize).catch(() => {});
  }

  // 任務勝利判定：怪物被擊殺時，全參戰者都算 1 次勝利。
  // 這裡統一寫入，確保 Discord/Web 兩條戰鬥流程規則一致。
  const titleEligible = require("../../shared/autumnTitleRules").isPublicSeasonOpen();

  // ── 依傷害比例計算每人分配量 ──
  // Discord 與 Web 呼叫前皆已將尾段傷害寫入 damageMap，不可再加一次。
  const mergedDmg = rawDmgMap;
  const battleHpBasis = Math.max(1, Number(monster?.calc?.maxHp || session.monsterMaxHp || 1));
  const dmgRatio = (pid) => Math.min(1, Math.max(0, (mergedDmg[pid]?.damage || 0) / battleHpBasis));
  const equalShare = (pool, pid) => Math.floor(pool / Math.max(1, participants.length))
    + (participants.indexOf(pid) < pool % Math.max(1, participants.length) ? 1 : 0);

  // 各人的區域等級帶懲罰在均分後套用，不將扣除的 EXP 分給隊友。

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
  if(sc.progressRepository.findRewardProgressByPlayerIds){
    const docs=await sc.progressRepository.findRewardProgressByPlayerIds(participants);
    for(const doc of docs)progressCache[doc.playerId]=doc;
    const ids=[...new Set(docs.flatMap(doc=>Object.values(doc.equipment||{}).map(e=>e?.itemId)).filter(Boolean))];
    const library=sc.itemRepository.findByIds?await sc.itemRepository.findByIds(ids)
      : (await Promise.all(ids.map(id=>sc.itemRepository.findById(id)))).filter(Boolean);
    const items=new Map(library.map(item=>[item.id,item]));
    const itemView={findById:async id=>items.get(id)||null};
    for(const doc of docs)doc.equipment=await mergeEquippedFromLibrary(doc.equipment||{},itemView);
  }else{
    const items=new Map();
    const itemView={findById:id=>{
      if(!items.has(id))items.set(id,sc.itemRepository.findById(id));
      return items.get(id);
    }};
    await journal.forPlayers(participants,async pid=>{
      const prog=await sc.progressRepository.findByPlayerId(pid);
      if(prog){prog.equipment=await mergeEquippedFromLibrary(prog.equipment||{},itemView);progressCache[pid]=prog;}
    });
  }
  recordQuestForPlayersInBackground(sc.questService || sc.weeklyQuestService, participants, "battle_win", encounterSize, pid => ({
    ...(liveKey ? {operationId:journal.rewardId(state,pid,"battle_win")} : {}),
    autumnEvent: { eligible: titleEligible, slot: progressCache[pid]?.activeCharacterSlot || 1, seasonKey: progressCache[pid]?.seasonKey }
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
    await journal.forPlayers(participants,async pid=>{
      fatigueMultByPid[pid] = await farmFatigue.applyAndGetMultiplier(pid, _now).catch(() => 1);
    });
  }
  const fatMul = (pid) => fatigueMultByPid[pid] ?? 1;
  if (fatMul(discordId) < 1) rewardLines.push("🥱 連續耕作已滿 6 小時，經驗/金幣暫時 −80%（停打一般區域 30 分鐘即恢復）");

  // ── 金幣依比例分配 ──
  // 依玩家各自對「怪物完整血量」的傷害比例結算
  const dynamicGoldPool = getDynamicGoldPoolFloor(zoneKey, worldBossReward ? participants.length : 1);
  const effectiveGoldReward = Math.max(monster.goldReward || 0, dynamicGoldPool) * encounterSize;

  let myBaseGoldShare = 0;
  if (effectiveGoldReward > 0) {
    const plans=liveKey?await journal.planMany(sc,zoneKey,liveKey,participants.map(pid=>({pid,kind:"gold",make:()=>{
      const base=worldBossReward?Math.max(1,Math.round(effectiveGoldReward*dmgRatio(pid))):equalShare(effectiveGoldReward,pid);
      return base>0?Math.max(1,Math.round(base*(rewardModsByPid[pid]?.goldMultiplier??1)*fatMul(pid))):0;
    }}))):null;
    await journal.forPlayers(participants,async pid=>{
      const baseShare = worldBossReward ? Math.max(1, Math.round(effectiveGoldReward * dmgRatio(pid))) : equalShare(effectiveGoldReward, pid);
      if (baseShare <= 0) return;
      const mod = rewardModsByPid[pid] || { goldMultiplier: 1 };
      const calculated = Math.max(1, Math.round(baseShare * mod.goldMultiplier * fatMul(pid)));
      const share=plans ? plans[`${pid}_gold`] : calculated;
      try {
        await sc.rewardService.grantCurrency({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          currencyType: "gold", amount: share,
          ...(liveKey?{existingProgress:progressCache[pid]}:{}),
          ...(liveKey?{sourceRef:journal.rewardId(state,pid,"gold")} : {}),
          source: CURRENCY_SOURCES.MONSTER_KILL_REWARD, operator: "monster_zone",
          // 不可用以 monster.seq 為基礎的 sourceRef：seq 會隨怪物輪替重複出現，
          // 重複擊殺同一隻怪會被誤判為重複交易而「不發金幣」。
          // 一次性結算已由 claimKill(DB 原子) + killInProgress 保證，無需 sourceRef。
        });
        if (perPidRewards[pid]) perPidRewards[pid].gold = share;
      } catch (e) {
        if(liveKey)throw e;
        console.error(`[MonsterZone] grantCurrency(gold) failed for ${pid}`, e);
        if (perPidRewards[pid]) perPidRewards[pid]._goldGrantFailed = true;
      }
    });

    const myBaseShare = worldBossReward ? Math.max(1, Math.round(effectiveGoldReward * dmgRatio(discordId))) : equalShare(effectiveGoldReward, discordId);
    myBaseGoldShare = myBaseShare;
    const myMod = rewardModsByPid[discordId] || { goldMultiplier: 1, goldPct: 0 };
    const myShare = myBaseShare > 0 ? Math.max(1, Math.round(myBaseShare * myMod.goldMultiplier * fatMul(discordId))) : 0;
    const pct = `${Math.round(dmgRatio(discordId) * 100)}%`;
    const poolNote = dynamicGoldPool > (monster.goldReward || 0) ? `（動態金幣池）` : "";
    const modNote = myMod.goldPct > 0 ? `，個人加成 +${Math.round(myMod.goldPct)}%` : "";
    rewardLines.push(`你造成了 **${totalDamage}** 點傷害。`);
    rewardLines.push(`💰 金幣 +${myShare}（${worldBossReward ? `傷害佔比 ${pct}` : `${participants.length} 人均分`}，共 ${effectiveGoldReward}${poolNote}${modNote}）`);
  }

  // 群怪先乘生成隻數，再額外 +10%／+20%；共鬥基礎分配及世界王算法保留。
  const n = participants.length;
  const partyMult = worldBossReward
    ? (n <= 2 ? 1.0 : +(1 + Math.pow(n - 2, 0.7) * 0.6).toFixed(2))
    : n * normalExpPerPlayerPct(n) / 100;
  const effectiveExpReward = worldBossReward
    ? Math.round(monster.expReward * partyMult * encounterSize)
    : normalExpPerPlayer(monster.expReward * encounterSize * (100 + groupExpBonusPct) / 100, n) * n;
  const zoneExpMult = (pid) => worldBossReward ? 1 : normalZoneExpMultiplier(zoneKey, progressCache[pid]?.level);

  let myBaseExpShare = 0;
  if (effectiveExpReward > 0) {
    const myBaseShare = worldBossReward ? Math.max(1, Math.round(effectiveExpReward * dmgRatio(discordId))) : equalShare(effectiveExpReward, discordId);
    myBaseExpShare = myBaseShare;
    const myMod = rewardModsByPid[discordId] || { expMultiplier: 1, expPct: 0 };
    const myShare = myBaseShare > 0 ? Math.max(1, Math.round(myBaseShare * myMod.expMultiplier * fatMul(discordId) * zoneExpMult(discordId))) : 0;
    let killerLvLine = "";
    let killerOverflowGold = 0; // 滿等溢出經驗轉的金幣（給戰報顯示）
    const plans=liveKey?await journal.planMany(sc,zoneKey,liveKey,participants.map(pid=>({pid,kind:"exp",make:()=>{
      const base=worldBossReward?Math.max(1,Math.round(effectiveExpReward*dmgRatio(pid))):equalShare(effectiveExpReward,pid);
      return base>0?Math.max(1,Math.round(base*(rewardModsByPid[pid]?.expMultiplier??1)*fatMul(pid)*zoneExpMult(pid))):0;
    }}))):null;
    await journal.forPlayers(participants,async pid=>{
      const baseShare = worldBossReward ? Math.max(1, Math.round(effectiveExpReward * dmgRatio(pid))) : equalShare(effectiveExpReward, pid);
      if (baseShare <= 0) return;
      const mod = rewardModsByPid[pid] || { expMultiplier: 1 };
      const calculated = Math.max(1, Math.round(baseShare * mod.expMultiplier * fatMul(pid) * zoneExpMult(pid)));
      const share=plans ? plans[`${pid}_exp`] : calculated;
      try {
        const expResult = await sc.progressService.grantExp({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          amount: share, source: EXP_SOURCES.MONSTER_KILL,
          ...(liveKey?{operationId:journal.rewardId(state,pid,"exp"),rewardCharacter:{seasonKey:progressCache[pid]?.seasonKey,slot:progressCache[pid]?.activeCharacterSlot||1}} : {})
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
            ? expResult.levelUpDetails.map((lv) => `Lv.${lv.level}：隨機 ${Array.isArray(lv.attrsZh) ? lv.attrsZh.join("、") : ""} +1、自主點 +${lv.freePoints || 0}`).join("；")
            : "";
          killerLvLine = detailText
            ? ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}\n   ${detailText}`
            : ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}`;
        }
      } catch (e) {
        if(liveKey)throw e;
        console.error(`[MonsterZone] grantExp failed for ${pid}`, e?.message || e);
        // 記錄失敗原因，幫助診斷 DM 通知與實際經驗值不符的問題
        if (!perPidRewards[pid]) perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
        perPidRewards[pid]._expGrantFailed = true;
      }
    });

    const pct = `${Math.round(dmgRatio(discordId) * 100)}%`;
    const partyNote = worldBossReward
      ? (partyMult > 1 ? `　👥 ×${partyMult}（${participants.length}人）` : "")
      : `　👥 每人基礎 ${normalExpPerPlayerPct(n)}%（${n}人${encounterSize > 1 ? `・${encounterSize}隻` : ""}）`;
    const modNote = myMod.expPct > 0 ? `，個人加成 +${Math.round(myMod.expPct)}%` : "";
    const groupNote = groupExpBonusPct > 0 ? `，群怪加成 +${groupExpBonusPct}%` : "";
    const zoneNote = zoneExpMult(discordId) < 1 ? `，跨區 EXP −${Math.round((1 - zoneExpMult(discordId)) * 100)}%` : "";
    if (canSendRewardNotice(discordId)) {
      rewardLines.push(`⭐ EXP +${myShare}（${worldBossReward ? `傷害佔比 ${pct}` : `${participants.length} 人均分`}，共 ${effectiveExpReward}${partyMult > 1 ? ` 原${monster.expReward}` : ""}${groupNote}${modNote}${zoneNote}）${partyNote}${killerLvLine}`);
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
