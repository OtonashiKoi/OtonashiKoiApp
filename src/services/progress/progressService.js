const { AppError, ERROR_CODES } = require("../../shared/errors");
const { expToNextLevel } = require("../../shared/progression");
const { isValidExpSource } = require("../../shared/sources");

class ProgressService {
  constructor(playerService, progressRepository) {
    this.playerService = playerService;
    this.progressRepository = progressRepository;
  }

  async grantExp({ discordId, displayName, amount, source }) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "exp amount must be a positive integer", 400);
    }

    if (!isValidExpSource(source)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `unsupported exp source: ${source}`, 400);
    }

    const { player, progress } = await this.playerService.ensurePlayer(discordId, displayName);
    const next = { ...progress, updatedAt: new Date().toISOString() };
    next.exp += amount;

    let levelUps = 0;
    while (next.exp >= expToNextLevel(next.level)) {
      next.exp -= expToNextLevel(next.level);
      next.level += 1;
      levelUps += 1;
    }

    await this.progressRepository.save(next);
    return { player, progress: next, levelUps };
  }
}

module.exports = {
  ProgressService
};