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
const { MerchService } = require("./merch/merchService");
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
const { HutaoEventService } = require("./worldBoss/hutaoEventService");
const { InviteService } = require("./invite/inviteService");
const { CreatorTokenService } = require("./creatorAuth/creatorTokenService");
const { CasinoService } = require("./casino/casinoService");
const { PetService } = require("./pet/petService");
const { CraftingService } = require("./crafting/craftingService");

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
  const progressService = new ProgressService(playerService, repositories.progressRepository, rewardService);
  const itemService = new ItemService(repositories.itemRepository, repositories.progressRepository);
  const playerTierService = new PlayerTierService(repositories.playerTierRepository);
  const monsterService = new MonsterService(repositories.monsterRepository, repositories.itemRepository);
  const monsterEventService = new MonsterEventService(repositories.monsterEventRepository);
  // 職業徽章熟練度＋轉職（二轉任務要用它檢查資格與執行轉職）
  const { JobBadgeService } = require("./job/jobBadgeService");
  const jobBadgeService = new JobBadgeService(
    repositories.progressRepository, repositories.itemRepository,
    repositories.walletRepository, rewardService
  );
  const questService = new WeeklyQuestService(repositories.weeklyQuestRepository, playerService, {
    streamAccountBindingRepository: repositories.streamAccountBindingRepository,
    checkinRepository: repositories.checkinRepository,
    itemRepository: repositories.itemRepository,
    jobBadgeService
  });
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
  const worldBossService = new WorldBossService(repositories.worldBossRepository); // 大史王 (default)
  // 龍王(B)：終局世界王，需先擊敗本週大史王才解鎖
  const dragonKingBossService = new WorldBossService(repositories.worldBossRepository, {
    bossKey: "dragon_king",
    unlockRequiresBossKey: "default",
    unlockServiceGetter: (key) => (key === "default" ? worldBossService : null),
  });
  // 地獄狼牙王：新終局世界王，需先擊敗本週古龍王才解鎖
  const hellfangKingBossService = new WorldBossService(repositories.worldBossRepository, {
    bossKey: "hellfang_king",
    unlockRequiresBossKey: "dragon_king",
    unlockServiceGetter: (key) => (key === "dragon_king" ? dragonKingBossService : null),
  });
  // 島島龜王：期間限定活動世界王。**不設前置王**（活動內容自成一條線，
  // 不要求玩家先打完大史王→古龍王那串終局鏈），難度全由潮汐/海嘯機制承擔。
  const islandTurtleBossService = new WorldBossService(repositories.worldBossRepository, {
    bossKey: "island_turtle",
  });
  const northwindHutaoBossService = new WorldBossService(repositories.worldBossRepository, {
    bossKey: "northwind_hutao",
  });
  const hutaoEventService = new HutaoEventService(repositories.worldBossEventRepository);
  // zone → 對應世界王 service（handler 用 zoneKey 取得正確 boss）
  const { bossKeyForZone } = require("./worldBoss/worldBossService");
  function worldBossServiceFor(zoneKey) {
    const bk = bossKeyForZone(zoneKey);
    if (bk === "hellfang_king") return hellfangKingBossService;
    if (bk === "dragon_king") return dragonKingBossService;
    if (bk === "island_turtle") return islandTurtleBossService;
    if (bk === "northwind_hutao") return northwindHutaoBossService;
    if (bk === "default") return worldBossService;
    return null;
  }
  const inviteService = new InviteService({
    inviteCodeRepository: repositories.inviteCodeRepository,
    playerRepository: repositories.playerRepository,
    progressRepository: repositories.progressRepository,
    walletRepository: repositories.walletRepository,
    itemRepository: repositories.itemRepository,
    transactionRepository: repositories.transactionRepository
  });
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
  const merchService = new MerchService(
    repositories.merchItemRepository,
    repositories.merchOrderRepository,
    walletService,
    rewardService,
    playerService
  );
  const transactionService = new TransactionService(playerService, repositories.transactionRepository);
  const adminService = new AdminService(
    playerService,
    rewardService,
    transactionService,
    progressService,
    repositories.adminActionLogRepository
  );
  const creatorTokenService = new CreatorTokenService({
    creatorTokenRepository: repositories.creatorTokenRepository
  });
  const casinoService = new CasinoService({
    casinoRepository: repositories.casinoRepository,
    itemRepository: {
      // 適配既有 itemRepository（findAll → listAll 別名）
      listAll: () => repositories.itemRepository.findAll(),
      findAll: () => repositories.itemRepository.findAll(),
    },
    walletRepository: repositories.walletRepository,
    progressRepository: repositories.progressRepository,
    rewardService,
    playerService,
    getBotClient: () => {
      try { return require("../bot/runtimeContext").getBotClient(); } catch (_) { return null; }
    },
    channelLayoutRepository: repositories.channelLayoutRepository,
  });
  const petService = new PetService({
    progressRepository: repositories.progressRepository,
    itemRepository: repositories.itemRepository,
    petRepository: repositories.petRepository,
  });
  const craftingService = new CraftingService({
    craftingRepository: repositories.craftingRepository,
    progressRepository: repositories.progressRepository,
    walletRepository: repositories.walletRepository,
    itemRepository: repositories.itemRepository
  });
  const { PassService } = require("./pass/passService");
  const passService = new PassService({
    progressRepository: repositories.progressRepository,
    walletService,
    rewardService,
    itemRepository: repositories.itemRepository,
  });
  const { StoryService } = require("./story/storyService");
  const storyService = new StoryService(
    repositories.storyRepository, repositories.progressRepository, monsterService, repositories.itemRepository,
    repositories.walletRepository, rewardService   // ⚔️ 轉職節點要扣金幣（走台帳留紀錄）
  );
  const adminConsoleService = new AdminConsoleService(
    repositories.channelLayoutRepository,
    repositories.playerRepository,
    adminService,
    repositories.walletRepository,
    repositories.progressRepository,
    repositories.checkinRepository,
    worldBossService,
    worldBossServiceFor   // 依 zone 取對應世界王 service（龍王巢穴用 dragon_king）
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
    merchService,
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
    worldBossService,
    dragonKingBossService,
    worldBossServiceFor,
    hutaoEventService,
    inviteService,
    creatorTokenService,
    casinoService,
    petService,
    craftingService,
    passService,
    storyService,
    jobBadgeService
  };
}

module.exports = {
  createServiceContext
};
