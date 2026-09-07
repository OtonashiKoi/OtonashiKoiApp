"use strict";

// Optional delivery adapters never own game rules or persistence.
let presentation = {};
function configureBattlePresentation(ports) { presentation = { ...presentation, ...ports }; }
module.exports = { configureBattlePresentation,
  _republishPanel: (...args) => presentation._republishPanel ? presentation._republishPanel(...args) : Promise.resolve(),
  _republishPanelWithRankingDebounce: (...args) => presentation._republishPanelWithRankingDebounce ? presentation._republishPanelWithRankingDebounce(...args) : Promise.resolve(),
  _announceLevelMilestone: (...args) => presentation._announceLevelMilestone ? presentation._announceLevelMilestone(...args) : Promise.resolve(),
  _announceDrops: (...args) => presentation._announceDrops ? presentation._announceDrops(...args) : Promise.resolve(),
  _notifyKillRewards: (...args) => presentation._notifyKillRewards ? presentation._notifyKillRewards(...args) : Promise.resolve(),
  clearQueuedEliteWorldBossSessions: (...args) => presentation.clearQueuedEliteWorldBossSessions ? presentation.clearQueuedEliteWorldBossSessions(...args) : 0,
  _broadcastBossSpawn: (...args) => presentation._broadcastBossSpawn ? presentation._broadcastBossSpawn(...args) : Promise.resolve(),
  notifyHealerBonus: (...args) => presentation.notifyHealerBonus ? presentation.notifyHealerBonus(...args) : Promise.resolve(),
  announceChestRanking: (...args) => presentation.announceChestRanking ? presentation.announceChestRanking(...args) : Promise.resolve(),
  announceIdleRotate: (...args) => presentation.announceIdleRotate ? presentation.announceIdleRotate(...args) : Promise.resolve()
};
