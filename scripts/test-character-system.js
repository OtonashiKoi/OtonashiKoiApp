"use strict";

const assert = require("node:assert/strict");
const { CharacterService } = require("../src/services/character/characterService");
const { ShopService } = require("../src/services/shop/shopService");
const { summarizeCharacterLevels } = require("../src/shared/characterLevelSummary");
const {
  CHARACTER_SLOTS,
  EQUIP_PRESET_KEYS,
  resolveMembershipEntitlements,
} = require("../src/shared/membershipEntitlements");

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
  assert.equal(before.maxCharacterSlots, 5);
  assert.equal(before.maxPresetSlots, 5);
  assert.deepEqual(before.slots.map((slot) => slot.slot), CHARACTER_SLOTS);
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
  stored.activePreset = "C";
  stored.equipPresets = { A: { weapon: { uuid: "preset-a", itemName: "方案 A 武器" } } };
  stored.equipPresetNames = { C: "分身採集裝" };
  await service.switchCharacter(MEMBER_ID, 1);
  const inactiveAltLevels = summarizeCharacterLevels(stored);
  assert.equal(inactiveAltLevels.highestLevel, 50);
  assert.equal(inactiveAltLevels.totalLevel, 58, "非目前使用的人物也必須計入總養成等級");
  assert.equal(stored.level, 50);
  assert.equal(stored.equipment.weapon.uuid, "main-weapon");
  assert.equal(stored.inventory[0].uuid, "shared-item");
  assert.equal(stored.characterSlots["2"].activePreset, "C", "裝備方案索引必須跟人物快照一起保存");
  assert.equal(stored.characterSlots["2"].equipPresetNames.C, "分身採集裝", "方案名稱也必須是人物各自保存");
  await service.switchCharacter(MEMBER_ID, 2);
  assert.equal(stored.level, 8);
  assert.equal(stored.equipment.weapon.uuid, "alt-weapon");
  assert.equal(stored.activePreset, "C");
  assert.equal(stored.equipPresetNames.C, "分身採集裝");

  stored.playerTier = "B";
  const koiLeaderState = await service.getState(MEMBER_ID);
  assert.equal(koiLeaderState.maxCharacterSlots, 3);
  assert.equal(koiLeaderState.maxPresetSlots, 5);
  assert.equal(koiLeaderState.slots[3].locked, true);
  assert.match(koiLeaderState.slots[3].lockReason, /鯉市長/);
  await assert.rejects(
    () => service.switchCharacter(MEMBER_ID, 4),
    (error) => error?.status === 403 && /鯉市長/.test(error.message),
  );

  stored.playerTier = "A";
  const fourth = await service.switchCharacter(MEMBER_ID, 4);
  assert.equal(fourth.created, true);
  assert.equal(fourth.activeSlot, 4);
  const fifth = await service.switchCharacter(MEMBER_ID, 5);
  assert.equal(fifth.created, true);
  assert.equal(fifth.activeSlot, 5);
  assert.equal(summarizeCharacterLevels(stored).characterCount, 4);

  stored.playerTier = null;
  await assert.rejects(
    () => service.switchCharacter(PUBLIC_PLAYER_ID, 3),
    (error) => error?.status === 403 && /鯉民/.test(error.message),
  );

  assert.deepEqual(EQUIP_PRESET_KEYS, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(
    resolveMembershipEntitlements({ playerTier: "C" }, []),
    { tier: "C", label: "鯉民", isMember: true, maxCharacterSlots: 3, maxPresetSlots: 3 },
  );
  assert.deepEqual(
    resolveMembershipEntitlements({ playerTier: "B" }, []),
    { tier: "B", label: "鯉長", isMember: true, maxCharacterSlots: 3, maxPresetSlots: 5 },
  );
  assert.deepEqual(
    resolveMembershipEntitlements({ playerTier: "A" }, []),
    { tier: "A", label: "鯉市長", isMember: true, maxCharacterSlots: 5, maxPresetSlots: 5 },
  );
  assert.equal(
    resolveMembershipEntitlements({ playerTier: null }, [{ linkedSupportAtLink: true }]).tier,
    "C",
    "只有會員快照但沒有明確位階時，至少視為鯉民",
  );

  let presetProgress = {
    playerId: MEMBER_ID,
    activePreset: "A",
    equipPresets: {},
    equipment: { weapon: { uuid: "preset-test", itemId: "sword", itemName: "測試劍", equipSlot: "weapon" } },
    inventory: [],
  };
  const presetRepository = {
    async findByPlayerId() { return presetProgress; },
    async save(next) { presetProgress = next; return next; },
  };
  const shopService = new ShopService(null, null, null, presetRepository);
  await shopService.saveEquipPreset(MEMBER_ID, "D");
  assert.equal(presetProgress.equipPresets.D.weapon.uuid, "preset-test");
  await shopService.switchEquipPreset(MEMBER_ID, "E");
  assert.equal(presetProgress.activePreset, "E", "底層換裝服務必須接受新增的 D / E 方案");

  console.log("✅ 多角色系統：五人物欄、會員分級、每人物五方案、背包共用、裝備獨立、光環清除與鎖定提示皆通過");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
