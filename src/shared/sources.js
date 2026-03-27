const CURRENCY_SOURCES = {
  DISCORD_TEST_REWARD: "discord:test-reward",
  ADMIN_MANUAL_GRANT: "admin:manual-grant",
  ADMIN_MANUAL_DEDUCT: "admin:manual-deduct"
};

const EXP_SOURCES = {
  DISCORD_TEST_EXP: "discord:test-exp",
  ADMIN_MANUAL_GRANT_EXP: "admin:manual-grant-exp"
};

function isValidCurrencySource(source) {
  return Object.values(CURRENCY_SOURCES).includes(source);
}

function isValidExpSource(source) {
  return Object.values(EXP_SOURCES).includes(source);
}

module.exports = {
  CURRENCY_SOURCES,
  EXP_SOURCES,
  isValidCurrencySource,
  isValidExpSource
};