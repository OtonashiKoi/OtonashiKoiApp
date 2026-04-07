const MAX_LEVEL = 15;

function expToNextLevel(level) {
  // 指數成長：早期約 100，後期約 4500（約 10x 幅度）
  return Math.round(100 * Math.pow(level, 1.45));
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};