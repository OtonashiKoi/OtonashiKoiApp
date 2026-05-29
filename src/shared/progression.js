const MAX_LEVEL = 50;

function expToNextLevel(level) {
  // 1-10 前期升快一點，讓新手更容易感受到成長
  if (level <= 10) {
    return Math.round(240 * Math.pow(level, 1.55));
  }
  // 11-20 中期明顯拉長，讓一般玩家需要更多天數推進
  if (level <= 20) {
    return Math.round(340 * Math.pow(level, 1.62));
  }
  // 21-40 後期再拉長
  if (level <= 40) {
    return Math.round(500 * Math.pow(level, 1.68));
  }
  // 41-50 終局：龍族之領，再放寬一點點，但配合 A 階裝備掉落仍要花時間
  return Math.round(620 * Math.pow(level, 1.72));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};
