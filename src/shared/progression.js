const MAX_LEVEL = 20;

function expToNextLevel(level) {
  // 指數成長（原設定）
  // 為了把等級上限延展到 20 等，我們對 16~20 做較溫和的延伸：
  // - level <= 15: 保持原公式
  // - level 16..20: 使用較小係數與指數，避免跳躍過大
  if (level <= 15) {
    return Math.round(300 * Math.pow(level, 1.6));
  }
  // 16~20 的平滑延伸（係數與指數略降）
  // 這樣可以讓 16~20 的需求值延續原曲線趨勢，但避免過高門檻
  return Math.round(260 * Math.pow(level, 1.55));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};