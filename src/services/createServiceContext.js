const { createRepositories } = require("../repositories/createRepositories");
const { AccessControlService } = require("./admin/accessControlService");
const { AdminService } = require("./admin/adminService");
const { AdminConsoleService } = require("./admin/adminConsoleService");
const { PlayerService } = require("./player/playerService");
const { ProgressService } = require("./progress/progressService");
const { TransactionService } = require("./transaction/transactionService");
const { WalletService } = require("./wallet/walletService");
const { RewardService } = require("./reward/rewardService");

function createServiceContext() {
  const repositories = createRepositories();
  const accessControlService = new AccessControlService(repositories.accessControlRepository);
  const playerService = new PlayerService(
    repositories.playerRepository,
    repositories.walletRepository,
    repositories.progressRepository
  );
  const walletService = new WalletService(playerService, repositories.walletRepository);
  const rewardService = new RewardService(
    playerService,
    repositories.walletRepository,
    repositories.transactionRepository
  );
  const progressService = new ProgressService(playerService, repositories.progressRepository);
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
    adminService
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
    walletService
  };
}

module.exports = {
  createServiceContext
};