const MAX_LEVEL = 40;

function expToNextLevel(level) {
  // 1-10 前期升快一點，讓新手更容易感受到成長
  if (level <= 10) {
    return Math.round(240 * Math.pow(level, 1.55));
  }
  // 11-20 中期明顯拉長，讓一般玩家需要更多天數推進
  if (level <= 20) {
    return Math.round(340 * Math.pow(level, 1.62));
  }
  // 21-40 後期再拉長，避免狂點太快畢業
  return Math.round(430 * Math.pow(level, 1.62));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};
