"use strict";

const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");

const notifyHealerBonus = (...args) => require("./battlePresentation").notifyHealerBonus(...args);
const buildMonsterDropPool = (...args) => require("./battleRewardRules").buildMonsterDropPool(...args);
const calculateFinalDropChance = (...args) => require("./battleRewardRules").calculateFinalDropChance(...args);
const toWebDrop = (...args) => require("./battleRewardView").toWebDrop(...args);
const _announceDrops = (...args) => require("./battlePresentation")._announceDrops(...args);
const getParticipationGemTiers = (...args) => require("./battleRewardRules").getParticipationGemTiers(...args);
const { ENHANCE_GEM_IDS } = require("./zoneBattleState");
const { GEM_PARTICIPATION_RATE } = require("./zoneBattleState");
const { GEM_PARTICIPATION_DOUBLE_DROP_RATE } = require("./zoneBattleState");
const tryStackGem = (...args) => require("./battleRewardRules").tryStackGem(...args);

async function grantKillDrops(context) {
  const { healerBonusPids, perPidRewards, monster, discordId, rewardLines, sc, participants, rewardModsByPid, zoneKey, displayName, mergedDmg, canSendRewardNotice, progressCache } = context;
  // ── 治療師徽章結算特別顯示 + 專屬 DM ──
  // 用實際已發出的 gold/exp 反推加成數值（10% / 1.1 = 原始base × 0.1）
  for (const hpid of healerBonusPids) {
    const r = perPidRewards[hpid];
    if (!r) continue;
    // 實際發出的是 base * 1.1，所以加成 = 實際發出 / 1.1 * 0.1 = 實際發出 / 11
    r.healerGoldBonus = r.gold > 0 ? Math.max(1, Math.round(r.gold / 11)) : 0;
    r.healerExpBonus  = r.exp  > 0 ? Math.max(1, Math.round(r.exp  / 11)) : 0;

    // 治療師專屬 DM（在這裡直接發，gold/exp 值都已確定）
    const parts = [];
    if (r.healerGoldBonus > 0) parts.push(`+${r.healerGoldBonus} 金幣`);
    if (r.healerExpBonus  > 0) parts.push(`+${r.healerExpBonus} EXP`);
    if (parts.length > 0) {
      try {
        notifyHealerBonus(hpid, monster.name, parts);
      } catch (_) {}
    }
  }
  if (healerBonusPids.has(discordId)) {
    const r = perPidRewards[discordId];
    const parts = [];
    if (r?.healerGoldBonus > 0) parts.push(`+${r.healerGoldBonus} 金幣`);
    if (r?.healerExpBonus  > 0) parts.push(`+${r.healerExpBonus} EXP`);
    if (parts.length > 0) {
      rewardLines.push(`💚 **治療師加成**：${parts.join("、")}`);
    }
  }

  const monsterDropPool = await buildMonsterDropPool(sc, monster);

  // ── 道具掉落：從所有參戰者中抽一人，再骰各道具掉落率 ──
  // 規則：1. 從 participants 隨機抽出一位幸運者
  //        2. 幸運者對每個掉落項目各自骰 chance%
  //        3. 骰中的道具進入幸運者背包
  if (monsterDropPool.length > 0 && participants.length > 0) {
    // 抽幸運者
    const luckyIdx = Math.floor(Math.random() * participants.length);
    const luckyPid = participants[luckyIdx];
    const luckyMod = rewardModsByPid[luckyPid] || { dropMultiplier: 1, rareDropMultiplier: 1 };

    if (luckyPid) {
      const droppedItems = [];
      const droppedItemObjects = [];

      for (const drop of monsterDropPool) {
        let item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
        if (item) {
          const finalChance = calculateFinalDropChance(drop.chance, luckyMod, item);
          if (Math.random() * 100 < finalChance) {
            const equipStats = item.equipStats ? { ...item.equipStats } : {};
            droppedItems.push(item.name);
            const droppedEntry = {
              uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name,
              itemEffect: item.effect || { type: "none", value: 0 },
              useEffects: item.useEffects || [],
              passiveEffects: item.passiveEffects || [],
              procEffects: item.procEffects || [],
              combatEffects: item.combatEffects || [],
              itemType: item.itemType || "consumable",
              imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
              equipSlot: item.equipSlot || null, equipStats,
              weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
              atkStat: item.atkStat || null, tier: item.tier || null, monsterCardSkill: item.monsterCardSkill || null,
              enhanceLevel: 0, source: "monster_drop", sourceRef: monster.name,
              purchasedAt: new Date().toISOString()
            };
            // 獲得瞬間骰附魔（只骰一次，寫進 droppedItemObjects 後續 retry 不會重骰）
            try { require("../../services/enchant/enchantService").rollForEntry(droppedEntry); } catch (_) { /* noop */ }
            // 屬性附魔：由「掉落這件的怪」決定屬性，等級上限＝該怪的濃度（活動區小怪＝水1）。
            // 不建新道具，只在這一件實例標 element/elementLevel；飾品與卡片不附（見 elementDropRoll）。
            try {
              // 活動限定裝自帶 item.elementDrop（100% 必中、濃度區間自訂）→ 蓋過怪物的 30% 骰
              if (item.elementDrop || monster?.element) {
                require("../../shared/elementDropRoll").rollElementForEntry(droppedEntry, {
                  element: monster?.element,
                  maxLevel: monster?.elementLevel || 1,
                  zone: zoneKey,                    // 活動區固定 30%
                  monsterLevel: monster?.level,     // 一般區依怪物等級階梯（5~25%，2026-08-09 全區開放）
                  override: item.elementDrop || null,
                });
              }
            } catch (_) { /* noop */ }
            droppedItemObjects.push(droppedEntry);
          }
        }
      }

      if (droppedItems.length > 0) {
        // 背包容量：裝備滿了就不再撿多出來的裝備（素材/寶石/蛋照收），依會員等級決定上限
        let equipCap = Infinity;
        try { equipCap = (await require("../../services/backpack/backpackService").resolveEffectiveCapacity(luckyPid)).cap; } catch (_) { /* 解析失敗不擋 */ }
        const skippedByFullBag = [];
        let savedDrop = false;
        for (let attempt = 0; attempt < 3 && !savedDrop; attempt++) {
          const latestLuckyProg = await sc.progressRepository.findByPlayerId(luckyPid);
          if (!latestLuckyProg) break;

          const nextLuckyProg = {
            ...latestLuckyProg,
            inventory: Array.isArray(latestLuckyProg.inventory)
              ? latestLuckyProg.inventory.map((entry) => ({ ...entry }))
              : []
          };
          // 依容量過濾：只有「主要穿戴裝備」佔格、超上限就跳過；卡片/錨點/徽章/稱號、素材/寶石/蛋不受限
          const countsCap = require("../../services/backpack/backpackService").countsTowardCapacity;
          let room = Math.max(0, equipCap - nextLuckyProg.inventory.filter(countsCap).length);
          const toAdd = [];
          for (const entry of droppedItemObjects) {
            if (countsCap(entry)) {
              if (room > 0) { toAdd.push(entry); room -= 1; }
              else if (attempt === 0) skippedByFullBag.push(entry.itemName);
            } else {
              toAdd.push(entry); // 卡片/收藏/素材照收，不佔容量
            }
          }
          nextLuckyProg.inventory.push(...toAdd.map((entry) => ({ ...entry })));
          nextLuckyProg.updatedAt = new Date().toISOString();

          if (typeof sc.progressRepository.saveIfUnchanged === "function") {
            savedDrop = await sc.progressRepository.saveIfUnchanged(nextLuckyProg, latestLuckyProg.updatedAt);
          } else if (typeof sc.progressRepository.save === "function") {
            await sc.progressRepository.save(nextLuckyProg);
            savedDrop = true;
          }

          if (!savedDrop && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
          }
        }

        if (savedDrop) {
          const allDropped = [...droppedItems];
          const allDroppedObjects = [...droppedItemObjects];
          if (perPidRewards[luckyPid]) perPidRewards[luckyPid].drops = [...allDropped];
          const luckyName = luckyPid === discordId ? displayName : (mergedDmg[luckyPid]?.name || luckyPid);
          const isKiller = luckyPid === discordId;
          if (canSendRewardNotice(luckyPid)) {
            if (isKiller) {
              rewardLines.push(`🎁 道具掉落：${allDropped.join("、")}`);
              if (skippedByFullBag.length > 0) {
                rewardLines.push(`⚠️ 背包已滿，未拾取裝備：${skippedByFullBag.join("、")}（整理背包或升級會員可擴充上限）`);
              }
              // 結構化掉落（給網頁版漂浮道具氣泡 + 詳細視窗用）
              rewardLines._drops = [...(rewardLines._drops || []), ...allDroppedObjects.map(toWebDrop)];
              _announceDrops(sc, luckyPid, luckyName, monster.name, allDropped, allDroppedObjects, "kill", isWorldBossZone(zoneKey) && !!monster?.isBoss, zoneKey).catch(() => {});
            } else {
              _announceDrops(sc, luckyPid, luckyName, monster.name, allDropped, allDroppedObjects, "group", isWorldBossZone(zoneKey) && !!monster?.isBoss, zoneKey).catch(() => {});
            }
          } else {
            console.warn(`[MonsterZone] skip drop DM for ${luckyPid} because EXP was not committed`);
          }
        } else {
          console.warn(`[MonsterZone] drop save failed for ${luckyPid}, item drop announcement skipped to avoid stale overwrite`);
        }
      }
    }

    // 人數加碼掉落：10/15/20 人各額外抽一位，台詞不同
    const BONUS_MILESTONES = [
      { threshold: 10, kind: "bonus_10" },
      { threshold: 15, kind: "bonus_15" },
      { threshold: 20, kind: "bonus_20" },
    ];
    const usedBonusPids = new Set([luckyPid]);
    for (const { threshold, kind } of BONUS_MILESTONES) {
      if (participants.length < threshold) break;
      const bonusPool = participants.filter(pid => !usedBonusPids.has(pid));
      const bonusPid = bonusPool.length > 0
        ? bonusPool[Math.floor(Math.random() * bonusPool.length)]
        : [...usedBonusPids][0];
      usedBonusPids.add(bonusPid);
      const bonusProg = progressCache[bonusPid];
      const bonusMod = rewardModsByPid[bonusPid] || { dropMultiplier: 1, rareDropMultiplier: 1 };
      if (!bonusProg) continue;
      if (!Array.isArray(bonusProg.inventory)) bonusProg.inventory = [];
      const bonusItems = [];
      const bonusItemObjects = [];
      for (const drop of monsterDropPool) {
        let item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
        if (item) {
          const finalChance = calculateFinalDropChance(drop.chance, bonusMod, item);
          if (Math.random() * 100 < finalChance) {
            {
              const equipStats = item.equipStats ? { ...item.equipStats } : {};
              const dropEntry = {
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
                equipStats,
                weaponType: item.weaponType || null,
                isTwoHanded: item.isTwoHanded || false,
                atkStat: item.atkStat || null,
                tier: item.tier || null,
                monsterCardSkill: item.monsterCardSkill || null,
                enhanceLevel: 0,
                source: "monster_drop_bonus",
                sourceRef: monster.name,
                purchasedAt: new Date().toISOString()
              };

              bonusProg.inventory.push({ ...dropEntry });
              bonusItems.push(item.name);
              bonusItemObjects.push(dropEntry);
            }
          }
        }
      }
      if (bonusItems.length > 0) {
        let savedBonus = false;
        for (let attempt = 0; attempt < 3 && !savedBonus; attempt++) {
          const latestBonusProg = await sc.progressRepository.findByPlayerId(bonusPid);
          if (!latestBonusProg) break;
          const nextBonusProg = {
            ...latestBonusProg,
            inventory: Array.isArray(latestBonusProg.inventory)
              ? latestBonusProg.inventory.map((entry) => ({ ...entry }))
              : []
          };
          nextBonusProg.inventory.push(...bonusItemObjects.map((entry) => ({ ...entry })));
          nextBonusProg.updatedAt = new Date().toISOString();

          if (typeof sc.progressRepository.saveIfUnchanged === "function") {
            savedBonus = await sc.progressRepository.saveIfUnchanged(nextBonusProg, latestBonusProg.updatedAt);
          } else if (typeof sc.progressRepository.save === "function") {
            await sc.progressRepository.save(nextBonusProg);
            savedBonus = true;
          }

          if (!savedBonus && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
          }
        }
        if (!savedBonus) continue;
        const allBonusDropped = [...bonusItems];
        const allBonusDroppedObjects = [...bonusItemObjects];
        if (perPidRewards[bonusPid]) perPidRewards[bonusPid].drops = [...(perPidRewards[bonusPid].drops || []), ...allBonusDropped];
        const bonusName = bonusPid === discordId ? displayName : (mergedDmg[bonusPid]?.name || bonusPid);
        if (canSendRewardNotice(bonusPid)) {
          _announceDrops(sc, bonusPid, bonusName, monster.name, allBonusDropped, allBonusDroppedObjects, kind, isWorldBossZone(zoneKey) && !!monster?.isBoss, zoneKey).catch(() => {});
        } else {
          console.warn(`[MonsterZone] skip bonus drop DM for ${bonusPid} because EXP was not committed`);
        }
      }
    }
  }

  // ── 參與獎勵：每位參戰者有機率獲得該區域強化石（DM 通知）──
  {
    const participationGemTiers = getParticipationGemTiers(zoneKey, monster);
    const participationGemConfigs = participationGemTiers
      .map((gemTier) => {
        const participationGemId = ENHANCE_GEM_IDS[gemTier];
        return participationGemId ? { gemTier, participationGemId } : null;
      })
      .filter(Boolean);

    if (participationGemConfigs.length > 0) {
      const participationGemItems = [];
      for (const cfg of participationGemConfigs) {
        const gemItem = await sc.itemRepository.findById(cfg.participationGemId).catch(() => null);
        if (!gemItem) continue;
        participationGemItems.push({
          tier: cfg.gemTier,
          item: gemItem,
          participationRate: GEM_PARTICIPATION_RATE[cfg.gemTier] ?? 0.05,
          doubleDropRate: GEM_PARTICIPATION_DOUBLE_DROP_RATE[cfg.gemTier] ?? 0
        });
      }

      for (const pid of participants) {
        const triggeredGemDrops = [];
        const pidDropPct = rewardModsByPid[pid]?.dropPct ?? 0;
        for (const cfg of participationGemItems) {
          const effectiveRate = Math.min(1, cfg.participationRate + pidDropPct / 100);
          if (Math.random() >= effectiveRate) continue;
          const dropCount = Math.random() < cfg.doubleDropRate ? 2 : 1;
          for (let i = 0; i < dropCount; i++) {
            triggeredGemDrops.push(cfg.item);
          }
        }
        if (triggeredGemDrops.length === 0) continue;

        let savedGem = false;
        for (let attempt = 0; attempt < 3 && !savedGem; attempt++) {
          const latestProg = await sc.progressRepository.findByPlayerId(pid);
          if (!latestProg) break;
          const nextProg = {
            ...latestProg,
            inventory: Array.isArray(latestProg.inventory)
              ? latestProg.inventory.map((entry) => ({ ...entry }))
              : []
          };
          for (const gemItem of triggeredGemDrops) {
            if (tryStackGem(nextProg, gemItem.id)) continue;
            nextProg.inventory.push({
              uuid: crypto.randomUUID(), itemId: gemItem.id, itemName: gemItem.name,
              itemEffect: gemItem.effect || { type: "none", value: 0 },
              useEffects: gemItem.useEffects || [],
              passiveEffects: gemItem.passiveEffects || [],
              procEffects: gemItem.procEffects || [],
              combatEffects: gemItem.combatEffects || [],
              itemType: gemItem.itemType || "consumable",
              imageUrl: gemItem.imageUrl || null, imageThumbnailUrl: gemItem.imageThumbnailUrl || null,
              equipSlot: gemItem.equipSlot || null, equipStats: gemItem.equipStats || null,
              weaponType: gemItem.weaponType || null, isTwoHanded: gemItem.isTwoHanded || false,
              atkStat: gemItem.atkStat || null, tier: gemItem.tier || null, enhanceLevel: 0,
              stackCount: 1,
              source: "monster_participation_gem", sourceRef: monster.name,
              purchasedAt: new Date().toISOString()
            });
          }
          nextProg.updatedAt = new Date().toISOString();
          if (typeof sc.progressRepository.saveIfUnchanged === "function") {
            savedGem = await sc.progressRepository.saveIfUnchanged(nextProg, latestProg.updatedAt);
          } else if (typeof sc.progressRepository.save === "function") {
            await sc.progressRepository.save(nextProg);
            savedGem = true;
          }
          if (!savedGem && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
          }
        }
        if (!savedGem) continue;
        if (perPidRewards[pid]) {
          perPidRewards[pid].drops = [...(perPidRewards[pid].drops || []), ...triggeredGemDrops.map((gemItem) => gemItem.name)];
        }
      }
    }
  }

}

module.exports = { grantKillDrops };
