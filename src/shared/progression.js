const MAX_LEVEL = 50;

// 目標節奏：一般玩家每天約 6 小時、5 天左右可由 Lv.1 滿到 Lv.50。
// 這裡配合真實戰鬥流程（高等怪常需多場擊殺）設定，而不是只看單次擊殺數。
function expToNextLevel(level) {
  // 1-10 前期升快一點，讓新手更容易感受到成長
  if (level <= 10) {
    return Math.round(290 * Math.pow(level, 1.55));
  }
  // 11-20 中期明顯拉長，讓一般玩家需要更多天數推進
  if (level <= 20) {
    return Math.round(410 * Math.pow(level, 1.62));
  }
  // 21-40 後期再拉長
  if (level <= 40) {
    return Math.round(600 * Math.pow(level, 1.68));
  }
  // 41-50 終局：龍族之領，再放寬一點點，但配合 A 階裝備掉落仍要花時間
  return Math.round(745 * Math.pow(level, 1.72));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};
