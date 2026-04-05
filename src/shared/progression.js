const MAX_LEVEL = 15;

function expToNextLevel(level) {
  return 100 + Math.max(0, level - 1) * 25;
}

module.exports = {
  MAX_LEVEL,
  expToNextLevel
};