const config = require("../config");
const { JsonAccessControlRepository } = require("../adapters/json/accessControlRepository");
const { JsonAdminActionLogRepository } = require("../adapters/json/adminActionLogRepository");
const { JsonChannelLayoutRepository } = require("../adapters/json/channelLayoutRepository");
const { JsonPlayerRepository } = require("../adapters/json/playerRepository");
const { JsonProgressRepository } = require("../adapters/json/progressRepository");
const { JsonWalletRepository } = require("../adapters/json/walletRepository");
const { JsonTransactionRepository } = require("../adapters/json/transactionRepository");
const { JsonCheckinRepository } = require("../adapters/json/checkinRepository");
const { createMongoRepositories } = require("../adapters/mongo/createMongoRepositories");

function createRepositories() {
  if (config.storage.driver === "mongo") {
    return createMongoRepositories();
  }

  return {
    accessControlRepository: new JsonAccessControlRepository(),
    adminActionLogRepository: new JsonAdminActionLogRepository(),
    channelLayoutRepository: new JsonChannelLayoutRepository(),
    playerRepository: new JsonPlayerRepository(),
    progressRepository: new JsonProgressRepository(),
    walletRepository: new JsonWalletRepository(),
    transactionRepository: new JsonTransactionRepository()
    , checkinRepository: new JsonCheckinRepository()
  };
}

module.exports = {
  createRepositories
};