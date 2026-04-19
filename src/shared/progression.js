const MAX_LEVEL = 40;

function expToNextLevel(level) {
  // 1-15 保持原公式
  if (level <= 15) {
    return Math.round(300 * Math.pow(level, 1.6));
  }
  // 16-40 平滑延伸，確保每級需求值持續遞增
  return Math.round(340 * Math.pow(level, 1.58));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};