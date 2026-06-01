const MAX_LEVEL = 50;

// 目標節奏：1→50 約需 40 小時實際戰鬥時間（以每場約 35 秒、含偶爾失敗估算）。
// 配合真實戰鬥流程（高等怪常需多場擊殺）設定，而不是只看單次擊殺數。
// 係數較最初版放大約 2.8×，把滿等拉長到 40 小時帶。
function expToNextLevel(level) {
  // 1-10 前期升快一點，讓新手更容易感受到成長
  if (level <= 10) {
    return Math.round(810 * Math.pow(level, 1.55));
  }
  // 11-20 中期明顯拉長，讓一般玩家需要更多天數推進
  if (level <= 20) {
    return Math.round(1150 * Math.pow(level, 1.62));
  }
  // 21-40 後期再拉長
  if (level <= 40) {
    return Math.round(1680 * Math.pow(level, 1.68));
  }
  // 41-50 終局：龍族之領，再放寬一點點，但配合 A 階裝備掉落仍要花時間
  return Math.round(2090 * Math.pow(level, 1.72));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};
