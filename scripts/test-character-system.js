"use strict";

const assert = require("node:assert/strict");
const { CharacterService } = require("../src/services/character/characterService");
const { summarizeCharacterLevels } = require("../src/shared/characterLevelSummary");

const MEMBER_ID = "character-member-test";
const PUBLIC_PLAYER_ID = "character-public-test";

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

async function main() {
  let stored = {
    playerId: MEMBER_ID,
    seasonKey: "test-season",
    playerTier: "SS",
    level: 50,
    exp: 123,
    job: "Tactician",
    equipment: {
      weapon: { uuid: "main-weapon", itemName: "主角色武器" },
      job_eq: { uuid: "main-job", itemName: "兵聖徽章" },
      title_eq: { uuid: "main-title", itemName: "測試稱號" },
    },
    inventory: [{ uuid: "shared-item", itemId: "potion", itemName: "共用藥水" }],
    activeEffects: [],
    flags: { claimedStarter: true },
  };
  const savedStates = [];
  const progressRepository = {
    async findByPlayerId() { return copy(stored); },
    async save(next) { stored = copy(next); return copy(stored); },
  };
  const monsterService = {
    async getState(zone) {
      if (zone !== "beginner") return null;
      return {
        activeHealerAuras: [
          { discordId: MEMBER_ID, displayName: "會員玩家" },
          { discordId: "other", displayName: "其他玩家" },
        ],
      };
    },
    async saveState(state, zone) { savedStates.push({ zone, state: copy(state) }); },
  };
  const service = new CharacterService({
    progressRepository,
    streamAccountBindingRepository: { async listByDiscordId() { return []; } },
    monsterService,
  });

  const before = await service.getState(PUBLIC_PLAYER_ID);
  assert.equal(before.enabled, true);
  assert.equal(before.testOnly, false);
  assert.equal(before.activeSlot, 1);
  assert.equal(before.slots[0].level, 50);
  assert.equal(before.slots[0].job, "兵聖徽章");
  assert.equal(before.slots[0].title, "測試稱號");
  assert.equal(before.slots[1].created, false);

  const created = await service.switchCharacter(MEMBER_ID, 2);
  assert.equal(created.created, true);
  assert.equal(created.activeSlot, 2);
  assert.equal(stored.level, 1);
  assert.equal(stored.equipment.weapon.itemName, "木劍");
  assert.equal(stored.inventory[0].uuid, "shared-item", "切換後必須沿用同一個背包");
  assert.equal(stored.characterSlots["1"].equipment.weapon.uuid, "main-weapon");
  assert.equal(savedStates[0].state.activeHealerAuras.length, 1);
  assert.equal(savedStates[0].state.activeHealerAuras[0].discordId, "other");
  const afterCreateLevels = summarizeCharacterLevels(stored);
  assert.equal(afterCreateLevels.highestLevel, 50, "切到低等分身後，最高角色榜仍應保留主角色等級");
  assert.equal(afterCreateLevels.totalLevel, 51, "總養成榜應加總已建立的兩個人物");
  assert.deepEqual(afterCreateLevels.characterLevels, [{ slot: 1, level: 50 }, { slot: 2, level: 1 }]);

  stored.level = 8;
  stored.equipment.weapon = { uuid: "alt-weapon", itemName: "分身武器" };
  await service.switchCharacter(MEMBER_ID, 1);
  const inactiveAltLevels = summarizeCharacterLevels(stored);
  assert.equal(inactiveAltLevels.highestLevel, 50);
  assert.equal(inactiveAltLevels.totalLevel, 58, "非目前使用的人物也必須計入總養成等級");
  assert.equal(stored.level, 50);
  assert.equal(stored.equipment.weapon.uuid, "main-weapon");
  assert.equal(stored.inventory[0].uuid, "shared-item");
  await service.switchCharacter(MEMBER_ID, 2);
  assert.equal(stored.level, 8);
  assert.equal(stored.equipment.weapon.uuid, "alt-weapon");

  stored.playerTier = null;
  await assert.rejects(
    () => service.switchCharacter(PUBLIC_PLAYER_ID, 3),
    (error) => error?.status === 403 && /只有會員/.test(error.message),
  );

  console.log("✅ 多角色系統：公開存取、角色 1 保留、會員角色 2 建立、背包共用、裝備獨立、光環清除、非會員限制皆通過");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
