#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { createRepositories } = require("../src/repositories/createRepositories");
const { PlayerService } = require("../src/services/player/playerService");
const { WeeklyQuestService, resolvePeriodKey } = require("../src/services/weeklyQuest/weeklyQuestService");

function hasEnhancedEquipment(progress) {
  const inventory = Array.isArray(progress?.inventory) ? progress.inventory : [];
  const equipped = Object.values(progress?.equipment || {});
  return [...inventory, ...equipped].some((entry) => Number(entry?.enhanceLevel || 0) > 0);
}

async function run() {
  const repositories = createRepositories();
  const playerService = new PlayerService(
    repositories.playerRepository,
    repositories.walletRepository,
    repositories.progressRepository
  );
  const questService = new WeeklyQuestService(repositories.weeklyQuestRepository, playerService);

  const progresses = await repositories.progressRepository.listAll();
  let scanned = 0;
  let eligible = 0;
  let fixedRows = 0;

  const enhanceQuests = (await questService.listDefinitions("all"))
    .filter((quest) => quest.enabled && quest.type === "enhance_count");

  for (const progress of progresses) {
    scanned += 1;
    if (!hasEnhancedEquipment(progress)) continue;
    eligible += 1;

    const discordId = progress.playerId;
    for (const quest of enhanceQuests) {
      const resolvedPeriodKey = resolvePeriodKey(quest.cadence);
      const playerPeriod = await repositories.weeklyQuestRepository.getPlayerProgress(discordId, resolvedPeriodKey, quest.cadence);
      const row = playerPeriod[quest.id] || { current: 0, claimed: false };
      if (Number(row.current || 0) >= 1) continue;
      row.current = 1;
      playerPeriod[quest.id] = row;
      await repositories.weeklyQuestRepository.savePlayerProgress(discordId, resolvedPeriodKey, playerPeriod, quest.cadence);
      fixedRows += 1;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    scanned,
    eligiblePlayers: eligible,
    fixedRows
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
