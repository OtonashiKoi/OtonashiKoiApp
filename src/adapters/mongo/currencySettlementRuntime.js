"use strict";
const { getMongoDb, withMongoTransaction, supportsMongoTransactions } = require("./createMongoClient");
const maintenance = require("../../services/access/maintenanceStore");
const options = {
  assertOwned: () => require("../../services/runtime/runtimeOwnership").assertRuntimeOwnership(),
  getDb: getMongoDb, withTransaction: withMongoTransaction, isStrict: () => maintenance.isStrict(),
  onCommitted(playerId) {
    require("./requestCache").clearCurrentCache();
    require("../../services/realtime/playerEventBus").playerEventBus.invalidateProfile(playerId, "wallet_changed");
  }
};
const transactional = require("./currencySettlement").createCurrencySettlement(options);
const standalone = require("./standaloneCurrencySettlement").createStandaloneCurrencySettlement(options);
module.exports = {
  async grantCurrencyAtomic(input) {
    await maintenance.ensureLoaded();
    return await supportsMongoTransactions() ? transactional(input) : standalone.grantCurrencyAtomic(input);
  },
  recoverPending: standalone.recoverPending
};
