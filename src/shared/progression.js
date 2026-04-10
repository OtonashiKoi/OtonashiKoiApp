const MAX_LEVEL = 15;

function expToNextLevel(level) {
  // 指數成長：早期約 300，中期數千，後期數萬（每天打10~20隻，數天升一級）
  return Math.round(300 * Math.pow(level, 1.6));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};