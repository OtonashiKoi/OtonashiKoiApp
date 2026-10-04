'use strict';
// Isolated adapters for real game services. No network or production writes.
const assert = require('node:assert/strict');
const { loadBson } = require('../verify-normal-progression');
const NativeDate = Date;
let current;
global.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [current?.now ?? NativeDate.now()])); }
  static now() { return current?.now ?? NativeDate.now(); }
};
function valueAt(row, key) { return key.split('.').reduce((p, k) => p?.[k], row); }
function setAt(row, key, value) {
  const ks = key.split('.'); let p = row;
  for (const k of ks.slice(0, -1)) p = p[k] ||= {};
  p[ks.at(-1)] = value;
}
function matches(row, query) {
  return Object.entries(query).every(([key, val]) => {
    if (key === '$and') return val.every(q => matches(row, q));
    if (key === '$or') return val.some(q => matches(row, q));
    const actual = valueAt(row, key);
    if (val && typeof val === 'object') return Object.entries(val).every(([op, n]) => {
      if (op === '$lte') return actual <= n;
      if (op === '$gte') return actual >= n;
      if (op === '$lt') return actual < n;
      if (op === '$exists') return (actual !== undefined) === n;
      throw Error('Unsupported isolated query ' + op);
    });
    return val === null ? actual == null : actual === val;
  });
}
function collection(name) {
  assert.ok(current, 'isolated runtime not initialized');
  if (!['farmFatigue', 'zoneSanctumGauge', 'enchantConfig', 'maintenanceState', 'gameSeasonState'].includes(name)) {
    current.forbidden.push(name); throw Error('Blocked unmodeled database access: ' + name);
  }
  const rows = current.collections[name] ||= new Map();
  const find = q => [...rows.values()].find(r => matches(r, q));
  const update = (q, ops, options = {}) => {
    assert.ok(!['maintenanceState','gameSeasonState'].includes(name),'cannot mutate season fixtures');
    let row = find(q), inserted = false;
    if (!row && options.upsert) { row = { ...q }; rows.set(q._id || q.discordId, row); inserted = true; }
    if (!row) return null;
    if (inserted) for (const [k, v] of Object.entries(ops.$setOnInsert || {})) setAt(row, k, structuredClone(v));
    const stage = Array.isArray(ops) ? ops[0] : ops;
    const original = structuredClone(row);
    for (const [k, v] of Object.entries(stage.$set || {})) setAt(row, k, typeof v === 'string' && v.startsWith('$') ? structuredClone(valueAt(original,v.slice(1))) : structuredClone(v));
    for (const [k, v] of Object.entries(ops.$inc || {})) setAt(row, k, (valueAt(row, k) || 0) + v);
    return row;
  };
  return {
    findOne: async q => structuredClone(find(q) || null),
    updateOne: async (q, ops, options) => ({ modifiedCount: update(q, ops, options) ? 1 : 0 }),
    findOneAndUpdate: async (q, ops, options) => structuredClone(update(q, ops, options)),
  };
}
require('../../src/adapters/mongo/createMongoClient').getMongoDb = async () => ({ collection });
const buff = require('../../src/services/stream/globalBuffService');
buff.getActiveModifiers = () => ({ expPct: 0, goldPct: 0, dropPct: 0 });
buff.isShortTermBuffActive = () => false;
const presentation = require('../../src/services/battle/battlePresentation');
for (const k of ['notifyHealerBonus', '_announceDrops', '_announceLevelMilestone']) presentation[k] = async () => {};
const backpack = require('../../src/services/backpack/backpackService');
backpack.resolveEffectiveCapacity = async () => ({ cap: backpack.capForTier(null) });
const { createGameProgress } = require('../../src/domain/progress/createGameProgress');
const { createWallet } = require('../../src/domain/wallet/createWallet');
const { ProgressService } = require('../../src/services/progress/progressService');
const { JobBadgeService } = require('../../src/services/job/jobBadgeService');
const { WeeklyQuestService } = require('../../src/services/weeklyQuest/weeklyQuestService');
const { EnhanceService } = require('../../src/services/enhance/enhanceService');
const { ShopService } = require('../../src/services/shop/shopService');
const { isUnavailableEquipment } = require('../../src/shared/equipmentAvailability');
const fs = require('node:fs');
function entry(item, source = 'quest') {
  assert.ok(item, 'missing item prototype');
  return { ...structuredClone(item), itemId: item.id, itemName: item.name,
    itemEffect: item.effect || { type: 'none', value: 0 }, uuid: 'sim-' + (++current.uuid),
    enhanceLevel: 0, jobExp: 0, source };
}
async function initialize(snapshot, route, seed, log = () => {}) {
  current = { now: NativeDate.parse('2026-10-02T14:00:00Z'), uuid: 0, forbidden: [], collections: {},
    log, currency: {}, expBySource: {}, seed, route, questRewards: [], purchases: [] };
  const r = current;
  r.items = loadBson(snapshot + '/items.bson');
  r.monsters = loadBson(snapshot + '/monsters.bson');
  r.definitions = loadBson(snapshot + '/weeklyQuests.bson');
  r.shopItems = loadBson(snapshot + '/shopItems.bson');
  const enchants = JSON.parse(fs.readFileSync(snapshot + '/enchantConfig.json'));
  r.collections.enchantConfig = new Map(enchants.map(x => [x._id, x]));
  r.collections.maintenanceState = new Map(loadBson(snapshot+'/maintenanceState.bson').map(x=>[x._id,x]));
  r.collections.gameSeasonState = new Map(JSON.parse(fs.readFileSync(snapshot+'/gameSeasonState.json')).map(x=>[x._id,x]));
  r.id = 'isolated-' + route.baseKey + '-' + seed;
  r.progress = createGameProgress(r.id); r.wallet = createWallet(r.id);
  const lib = new Map(r.items.map(i => [i.id, i]));
  r.itemRepository = { findById: async id => structuredClone(lib.get(id) || null), findAll: async () => structuredClone(r.items) };
  r.progressRepository = {
    findByPlayerId: async () => r.progress,
    save: async p => { r.progress = p; return p; },
    saveIfUnchanged: async p => { r.progress = p; return true; },
  };
  r.walletRepository = { findByPlayerId: async () => r.wallet, save: async w => { r.wallet = w; } };
  const player = { discordId: r.id, displayName: 'isolated', externalIds: { youtube: 'isolated-linked' } };
  r.playerService = { ensurePlayer: async () => ({ player, progress: r.progress }),
    getProfile: async () => ({ player, progress: r.progress, wallet: r.wallet }) };
  r.rewardService = { grantCurrency: async p => {
    const currency = p.currencyType || 'gold'; assert.ok(r.wallet[currency] + p.amount >= 0, 'insufficient isolated currency');
    r.wallet[currency] += p.amount; r.currency[p.source] = (r.currency[p.source] || 0) + p.amount;
    return { wallet: r.wallet };
  } };
  const prog = new ProgressService(r.playerService, r.progressRepository, r.rewardService);
  r.progressService = prog;
  const grant = prog.grantExp.bind(prog);
  prog.grantExp = async p => {
    const result = await grant(p); r.expBySource[p.source] = (r.expBySource[p.source] || 0) + p.amount;
    for (const d of result.levelUpDetails) {
      const self = route.primary; // 70% primary / 20% VIT / 10% AGI, repeating ten-level schedule.
      const phase = (d.level - 2) % 10;
      await prog.allocateAttribute({ discordId: r.id, attribute: phase < 7 ? self : phase < 9 ? 'vit' : 'agi', amount: 1 });
      r.log('level', { level: d.level, random: d.attrs, chosen: phase < 7 ? self : phase < 9 ? 'vit' : 'agi', gold: r.wallet.gold });
    }
    return result;
  };
  r.jobBadgeService = new JobBadgeService(r.progressRepository, r.itemRepository, r.walletRepository, r.rewardService);
  const periods = new Map();
  const questRepo = { listQuests: async () => r.definitions,
    getPlayerProgress: async (id, pk, cadence) => periods.get(cadence + ':' + pk) || {},
    savePlayerProgress: async (id, pk, data, cadence) => periods.set(cadence + ':' + pk, data) };
  r.questService = new WeeklyQuestService(questRepo, r.playerService, { itemRepository: r.itemRepository, jobBadgeService: r.jobBadgeService });
  const definitions = await r.questService.listDefinitions('all');
  // Cache immutable definitions only; eligibility/progress are still evaluated by real services.
  r.questService.listDefinitions = async cadence => cadence === 'all' ? definitions : definitions.filter(q => q.cadence === cadence);
  r.definitions = definitions;
  r.enhanceService = new EnhanceService(r.progressRepository, r.itemRepository, r.walletRepository, r.rewardService, r.questService);
  const shopRepo = { findById: async id => r.shopItems.find(i => i.id === id), findAll: async () => r.shopItems,
    save: async row => { const i = r.shopItems.findIndex(x => x.id === row.id); r.shopItems[i] = row; return row; } };
  r.shopService = new ShopService(shopRepo, r.playerService, r.rewardService, r.progressRepository, prog, r.itemRepository, null, r.questService);
  await require('../../src/services/enchant/enchantService').init();
  r.claim = async q => r.questService.claimReward(r.id, q.id, async reward => {
    if (reward.gold) await r.rewardService.grantCurrency({ amount: reward.gold, currencyType: 'gold', source: 'quest:' + q.cadence });
    if (reward.exp) await prog.grantExp({ discordId: r.id, amount: reward.exp, source: 'quest:reward-exp' });
    for (const gift of [...(reward.rewardItemId ? [{ itemId: reward.rewardItemId, count: 1 }] : []), ...(reward.rewardItems || [])]) {
      const item = lib.get(gift.itemId); if (!item || isUnavailableEquipment(item)) continue;
      for (let n = 0; n < (gift.qty || gift.quantity || gift.count || 1); n++) {
        const e=entry(item);r.progress.inventory.push(e);
        if(q.id===route.t1Quest)await require('../../src/shared/jobBadgeBonus').pushBonusWeaponToInventory({progress:r.progress,itemRepository:r.itemRepository,badge:e});
      }
    }
    r.questRewards.push(q.id); r.log('quest', { id: q.id, title: q.title, reward });
  });
  r.sc = { progressRepository: r.progressRepository, itemRepository: r.itemRepository, progressService: prog,
    rewardService: r.rewardService, worldBossServiceFor: () => null };
  return r;
}
module.exports = { initialize, entry, matches, collection, NativeDate, getCurrent: () => current };
