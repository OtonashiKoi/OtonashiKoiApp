const { createRepositories } = require("../repositories/createRepositories");
const { AccessControlService } = require("./admin/accessControlService");
const { AdminService } = require("./admin/adminService");
const { AdminConsoleService } = require("./admin/adminConsoleService");
const { PlayerService } = require("./player/playerService");
const { ProgressService } = require("./progress/progressService");
const { TransactionService } = require("./transaction/transactionService");
const { WalletService } = require("./wallet/walletService");
const { RewardService } = require("./reward/rewardService");
const { CheckinService } = require("./checkin/checkinService");
const { ShopService } = require("./shop/shopService");
const { ItemService } = require("./item/itemService");
const { PlayerTierService } = require("./playerTier/playerTierService");
const { MonsterService } = require("./monster/monsterService");
const { WeeklyQuestService } = require("./weeklyQuest/weeklyQuestService");
const { BattleConfigService } = require("./battle/battleConfigService");

function createServiceContext() {
  const repositories = createRepositories();
  const playerService = new PlayerService(
    repositories.playerRepository,
    repositories.walletRepository,
    repositories.progressRepository
  );
  const accessControlService = new AccessControlService(repositories.accessControlRepository, playerService);
  const walletService = new WalletService(playerService, repositories.walletRepository);
  const rewardService = new RewardService(
    playerService,
    repositories.walletRepository,
    repositories.transactionRepository
  );
  const checkinService = new CheckinService(playerService, repositories.checkinRepository, rewardService, repositories.progressRepository);
  const progressService = new ProgressService(playerService, repositories.progressRepository);
  const itemService = new ItemService(repositories.itemRepository, repositories.progressRepository);
  const playerTierService = new PlayerTierService(repositories.playerTierRepository);
  const monsterService = new MonsterService(repositories.monsterRepository, repositories.itemRepository);
  const weeklyQuestService = new WeeklyQuestService(repositories.weeklyQuestRepository);
  const battleConfigService = new BattleConfigService(repositories.battleConfigRepository);
  const shopService = new ShopService(repositories.shopRepository, playerService, rewardService, repositories.progressRepository, progressService, repositories.itemRepository, playerTierService);
  const transactionService = new TransactionService(playerService, repositories.transactionRepository);
  const adminService = new AdminService(
    playerService,
    rewardService,
    transactionService,
    progressService,
    repositories.adminActionLogRepository
  );
  const adminConsoleService = new AdminConsoleService(
    repositories.channelLayoutRepository,
    repositories.playerRepository,
    adminService,
    repositories.walletRepository,
    repositories.progressRepository,
    repositories.checkinRepository
  );

  return {
    ...repositories,
    accessControlService,
    adminConsoleService,
    adminService,
    playerService,
    progressService,
    rewardService,
    transactionService,
    walletService,
    checkinService,
    shopService,
    itemService,
    playerTierService,
    monsterService,
    weeklyQuestService,
    battleConfigService
  };
}

module.exports = {
  createServiceContext
};
