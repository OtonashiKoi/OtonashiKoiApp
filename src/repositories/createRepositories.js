const config = require("../config");
const { JsonAccessControlRepository } = require("../adapters/json/accessControlRepository");
const { JsonAdminActionLogRepository } = require("../adapters/json/adminActionLogRepository");
const { JsonChannelLayoutRepository } = require("../adapters/json/channelLayoutRepository");
const { JsonPlayerRepository } = require("../adapters/json/playerRepository");
const { JsonProgressRepository } = require("../adapters/json/progressRepository");
const { JsonWalletRepository } = require("../adapters/json/walletRepository");
const { JsonTransactionRepository } = require("../adapters/json/transactionRepository");
const { JsonCheckinRepository } = require("../adapters/json/checkinRepository");
const { JsonShopRepository } = require("../adapters/json/shopRepository");
const { JsonItemRepository } = require("../adapters/json/itemRepository");
const { JsonPlayerTierRepository } = require("../adapters/json/playerTierRepository");
const { JsonMonsterRepository } = require("../adapters/json/monsterRepository");
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
    transactionRepository: new JsonTransactionRepository(),
    checkinRepository: new JsonCheckinRepository(),
    shopRepository: new JsonShopRepository(),
    itemRepository: new JsonItemRepository(),
    playerTierRepository: new JsonPlayerTierRepository(),
    monsterRepository: new JsonMonsterRepository()
  };
}

module.exports = {
  createRepositories
};