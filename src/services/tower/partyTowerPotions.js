"use strict";
const LIMIT = 10, REVIVE_LIMIT = 2, COOLDOWN_MS = 10_000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const definitions = () => require("../../bot/handlers/towerHandlers").TOWER_POTION_IDS;
const count = entry => Math.max(1, Math.floor(Number(entry.stackCount) || 1));
const isRevive = item => item.effect.type === "tower_revive_pct";

function validatePlan(plan, inventory) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw fail("請選擇攜帶藥水數量");
  let total = 0, revives = 0;
  const selected = {};
  for (const [id, n] of Object.entries(plan)) {
    const item = definitions()[id];
    if (!item || !Number.isInteger(n) || n < 0) throw fail("藥水種類或數量不正確");
    const available = inventory.filter(e => e.itemId === id && e.uuid).reduce((s, e) => s + count(e), 0);
    if (n > available) throw fail(`${item.name}數量不足`);
    selected[id] = n; total += n; if (isRevive(item)) revives += n;
  }
  if (total > LIMIT || revives > REVIVE_LIMIT) throw fail("每人最多10瓶，其中復活藥最多2瓶");
  return selected;
}
function freezePouch(member) {
  const plan = validatePlan(member.potionPlan || {}, member.inventory || []);
  member.potionPouch = [];
  for (const [itemId, n] of Object.entries(plan)) {
    let left = n;
    for (const entry of member.inventory || []) {
      if (!left || entry.itemId !== itemId || !entry.uuid) continue;
      const remaining = Math.min(left, count(entry));
      member.potionPouch.push({ itemId, uuid: entry.uuid, remaining }); left -= remaining;
    }
  }
}
function listItems(member, inventory, lobby) {
  return Object.entries(definitions()).map(([itemId, item]) => {
    const sources = (member.potionPouch || []).filter(e => e.itemId === itemId);
    return { itemId, name: item.name, kind: isRevive(item) ? "revive" : "heal", effectType: item.effect.type, value: item.effect.value,
      count: lobby ? inventory.filter(e => e.itemId === itemId && e.uuid).reduce((s, e) => s + count(e), 0)
        : sources.reduce((s, e) => s + Math.min(e.remaining, inventory.filter(x => x.uuid === e.uuid && x.itemId === itemId).reduce((a, x) => a + count(x), 0)), 0),
      selected: member.potionPlan?.[itemId] || 0,
      remaining: sources.reduce((s, e) => s + e.remaining, 0) };
  });
}
// Floor clears preserve current HP; recovery comes from skills, cards or manual potions.
// Keep the result field for clients and persisted room compatibility.
function systemRecovery() { return []; }
function viewFields(room, viewer) {
  const member = room.members.find(m => m.discordId === viewer);
  return { potionLimits: { total: LIMIT, revive: REVIVE_LIMIT }, potionPlan: member?.potionPlan || {},
    potionPouch: member?.potionPouch || [], lastPotion: room.potionReceipts?.at(-1) || null,
    potionUseUntil: member?.potionUseUntil || 0, potionCooldownMs: COOLDOWN_MS,
    potionTargetUntil: Object.fromEntries(room.members.map(m => [m.discordId, m.potionTargetUntil || 0])) };
}
function createPotionActions({ sc, now, save, onRevive }) {
  async function configure(room, id, plan) {
    if (room.status !== "lobby") throw fail("請在出發前選擇藥水，途中不能補帶");
    const p = await sc.progressRepository.findByPlayerId(id);
    const m = room.members.find(m => m.discordId === id);
    m.potionPlan = validatePlan(plan, p?.inventory || []); m.ready = false;
    await save(room);
  }
  async function recover(room) {
    const op = room.pendingPotion;
    if (!op) return;
    const { withPlayerProgressLock } = require("../progress/progressLocks");
    try {
      await withPlayerProgressLock(op.ownerId, async () => {
        for (let attempt = 0; attempt < 8; attempt++) {
          const p = await sc.progressRepository.findByPlayerId(op.ownerId);
          if (!p) throw fail("找不到人物資料", 404);
          if ((p.partyPotionReceipts || []).includes(op.receipt)) return;
          if (Number(p.activeCharacterSlot || 1) !== op.slot) throw fail("人物已切換，無法使用原角色藥水", 409);
          if (p.seasonKey !== op.seasonKey) throw fail("賽季已變更，藥水使用已停止", 409);
          const index = (p.inventory || []).findIndex(e => e.uuid === op.uuid && e.itemId === op.itemId);
          if (index < 0) throw fail("帶入的藥水已不在背包，途中不能補帶", 409);
          const inventory = structuredClone(p.inventory);
          if (count(inventory[index]) === 1) inventory.splice(index, 1);
          else inventory[index].stackCount = count(inventory[index]) - 1;
          const next = { ...p, inventory, partyPotionReceipts: [...(p.partyPotionReceipts || []), op.receipt], updatedAt: new Date(now()).toISOString() };
          if (await sc.progressRepository.saveIfUnchanged(next, p.updatedAt)) return;
        }
        throw fail("藥水儲存忙碌，請重試", 503);
      });
    } catch (e) {
      // Only definite pre-consumption validation failures can cancel the persisted intent.
      if ([400, 404, 409].includes(e.status)) { room.pendingPotion = null; await save(room); }
      throw e;
    }
    const owner = room.members.find(m => m.discordId === op.ownerId);
    const target = room.members.find(m => m.discordId === op.targetId);
    target.currentHp = op.hpAfter;
    owner.potionUseUntil = op.cooldownUntil; target.potionTargetUntil = op.cooldownUntil;
    owner.potionPouch.find(e => e.uuid === op.uuid && e.itemId === op.itemId).remaining--;
    if (op.revive) { target.strategyReady = false; onRevive(target); }
    room.potionReceipts ||= [];
    room.potionReceipts.push(op); room.pendingPotion = null;
    await save(room);
    require("../../adapters/mongo/requestCache").clearCurrentCache();
    require("../realtime/playerEventBus").playerEventBus.invalidateInventory(op.ownerId);
  }
  async function use(room, ownerId, itemId, targetId, request) {
    await recover(room);
    const owner = room.members.find(m => m.discordId === ownerId), target = room.members.find(m => m.discordId === targetId);
    if (typeof request.operationId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(request.operationId)) throw fail("藥水操作識別碼不正確");
    const previous = (room.potionReceipts || []).find(o => o.ownerId === ownerId && o.operationId === request.operationId);
    if (previous) {
      if (previous.itemId !== itemId || previous.targetId !== targetId) throw fail("操作識別碼不可重複用於不同藥水", 409);
      return;
    }
    if (room.status !== "climbing" || room.terminal || request.runId !== room.runId) throw fail("本次副本已結束或變更，無法用藥", 409);
    if (!owner || owner.currentHp <= 0) throw fail("倒地者不能用藥，請存活隊友協助復活");
    const item = definitions()[itemId];
    if (!item || !target) throw fail("藥水或隊員不存在");
    if (now() < (owner.potionUseUntil || 0)) throw fail("用藥冷卻中，請稍候10秒", 409);
    if (now() < (target.potionTargetUntil || 0)) throw fail("目標剛接受用藥，10秒內不能重複給藥", 409);
    if (isRevive(item) ? target.currentHp > 0 : target.currentHp <= 0) throw fail(isRevive(item) ? "目標尚未倒地" : "倒地者必須使用復活藥");
    if (!isRevive(item) && target.currentHp >= target.maxHp) throw fail("目標血量已滿，無須用藥");
    const p = await sc.progressRepository.findByPlayerId(ownerId);
    const source = (owner.potionPouch || []).find(e => e.itemId === itemId && e.remaining > 0 && p?.inventory?.some(x => x.uuid === e.uuid && x.itemId === itemId));
    if (!source) throw fail("帶入藥水已用完或不在背包，途中不能補帶");
    const value = item.effect.type === "tower_heal_flat" ? item.effect.value : Math.round(target.maxHp * item.effect.value / 100);
    room.pendingPotion = { receipt: `${room.runId}:${ownerId}:${request.operationId}`, operationId: request.operationId, ownerId, targetId,
      uuid: source.uuid, itemId, name: item.name, revive: isRevive(item), slot: Number(owner.progressSnapshot?.activeCharacterSlot || 1),
      seasonKey: owner.progressSnapshot?.seasonKey, cooldownUntil: now() + COOLDOWN_MS, hpAfter: isRevive(item) ? Math.max(1, value) : Math.min(target.maxHp, target.currentHp + value) };
    await save(room); await recover(room);
  }
  return { recover, use, configure };
}
module.exports = { LIMIT, REVIVE_LIMIT, COOLDOWN_MS, validatePlan, freezePouch, listItems, systemRecovery, viewFields, createPotionActions };
