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
      // 升級獎勵屬性點 (RO 風格，通常隨等級增加，這裡簡單給予每級 5 點)
      next.statusPoints = (next.statusPoints || 0) + 5;
    }

    await this.progressRepository.save(next);
    return { player, progress: next, levelUps };
  }

  async allocateAttribute({ discordId, attribute, amount = 1 }) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) {
      throw new AppError(ERROR_CODES.NOT_FOUND, `progress not found for player: ${discordId}`, 404);
    }

    if (!progress.attributes) {
      progress.attributes = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    }

    if (!(attribute in progress.attributes)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `invalid attribute: ${attribute}`, 400);
    }

    if ((progress.statusPoints || 0) < amount) {
      throw new AppError(ERROR_CODES.PRECONDITION_FAILED, "insufficient status points", 400);
    }

    progress.statusPoints -= amount;
    progress.attributes[attribute] += amount;
    progress.updatedAt = new Date().toISOString();

    await this.progressRepository.save(progress);
    return progress;
  }
}

module.exports = {
  ProgressService
};