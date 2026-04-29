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
const { MonsterEventService } = require("./monster/monsterEventService");
const { WeeklyQuestService } = require("./weeklyQuest/weeklyQuestService");
const { BattleConfigService } = require("./battle/battleConfigService");
const { EffectDefinitionService } = require("./effect/effectDefinitionService");
const { EnhanceService } = require("./enhance/enhanceService");
const { AuctionService } = require("./auction/auctionService");
const { IdleService } = require("./idle/idleService");
const { WorldBossService } = require("./worldBoss/worldBossService");

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
  const monsterEventService = new MonsterEventService(repositories.monsterEventRepository);
  const questService = new WeeklyQuestService(repositories.weeklyQuestRepository, playerService);
  const weeklyQuestService = questService; // backward-compatible alias
  const battleConfigService = new BattleConfigService(repositories.battleConfigRepository);
  const effectDefinitionService = new EffectDefinitionService(repositories.effectDefinitionRepository);
  const enhanceService = new EnhanceService(
    repositories.progressRepository,
    repositories.itemRepository,
    repositories.walletRepository,
    rewardService,
    questService
  );
  const auctionService = new AuctionService(
    repositories.progressRepository,
    repositories.walletRepository,
    playerTierService,
    repositories.transactionRepository
  );
  const idleService = new IdleService({
    idleRepository: repositories.idleRepository,
    playerService,
    progressRepository: repositories.progressRepository,
    playerTierService,
    rewardService,
    progressService,
    itemRepository: repositories.itemRepository,
    channelLayoutRepository: repositories.channelLayoutRepository,
    monsterService
  });
  const worldBossService = new WorldBossService(repositories.worldBossRepository);
  const shopService = new ShopService(
    repositories.shopRepository,
    playerService,
    rewardService,
    repositories.progressRepository,
    progressService,
    repositories.itemRepository,
    playerTierService,
    questService,
    repositories.shopClaimRepository,
    repositories.streamAccountBindingRepository
  );
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
    repositories.checkinRepository,
    worldBossService
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
    monsterEventService,
    questService,
    weeklyQuestService,
    battleConfigService,
    effectDefinitionService,
    enhanceService,
    auctionService,
    idleService,
    worldBossService
  };
}

module.exports = {
  createServiceContext
};
