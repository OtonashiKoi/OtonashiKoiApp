"use strict";
const { withPlayerProgressLock } = require("../progress/progressLocks");
const definitions = () => require("../../bot/handlers/towerHandlers").TOWER_POTION_IDS;
const quantity = e => Math.max(1, Math.floor(Number(e.stackCount) || 1));
const fail = (message, status = 400) => Object.assign(new Error(message), { status, statusCode: status });
function validate(plan, inventory, { allowShortage = false } = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw fail("請設定攜帶藥水");
  const pouch = []; let total = 0;
  for (const [itemId, amount] of Object.entries(plan)) {
    if (!Object.hasOwn(definitions(), itemId) || !Number.isInteger(amount) || amount < 0) throw fail("藥水種類或數量不正確");
    let left = amount; total += amount;
    for (const entry of inventory.filter(e => e.itemId === itemId && e.uuid)) {
      const n = Math.min(left, quantity(entry));
      if (n) pouch.push({ itemId, uuid: entry.uuid, remaining: n });
      left -= n;
    }
    if (left && !allowShortage) throw fail("背包藥水數量不足");
  }
  if (total > 10) throw fail("最多攜帶10罐藥水");
  return pouch;
}
function items(progress) {
  return Object.entries(definitions()).map(([itemId, item]) => ({ itemId, name: item.name,
    effectType: item.effect.type, value: item.effect.value, kind: item.effect.type === "tower_revive_pct" ? "revive" : "heal",
    count: (progress?.inventory || []).filter(e => e.itemId === itemId).reduce((n, e) => n + quantity(e), 0) }));
}
async function configure(sc, id, plan, engine) {
  return withPlayerProgressLock(id, async () => {
    if (engine.players.has(id)) throw fail("請在戰鬥前設定攜帶藥水", 409);
    const p = await sc.progressRepository.findByPlayerId(id);
    // Saved amounts are refill targets; entry carries only currently owned stacks.
    validate(plan, p?.inventory || [], { allowShortage: true });
    await sc.progressRepository.updateFields(id, { combatPotionPlan: plan });
    return { plan, items: items(p), limit: 10 };
  });
}
async function recover(room, engine, state, rejectCancelled = false) {
  const op = state.pendingLivePotion;
  if (!op) return state;
  try { await withPlayerProgressLock(op.ownerId, async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = await room.sc.progressRepository.findByPlayerId(op.ownerId);
      if ((p?.livePotionReceipts || []).includes(op.receipt)) return;
      if (p?.seasonKey !== op.seasonKey || Number(p?.activeCharacterSlot || 1) !== op.slot) throw fail("人物或賽季已變更", 409);
      const inventory = structuredClone(p.inventory || []), index = inventory.findIndex(e => e.uuid === op.uuid && e.itemId === op.itemId);
      if (index < 0) throw fail("帶入藥水已不在背包", 409);
      if (quantity(inventory[index]) === 1) inventory.splice(index, 1);
      else inventory[index].stackCount = quantity(inventory[index]) - 1;
      const next = { ...p, inventory, livePotionReceipts: [...(p.livePotionReceipts || []).slice(-99), op.receipt], updatedAt: new Date(engine.now()).toISOString() };
      if (await room.sc.progressRepository.saveIfUnchanged(next, p.updatedAt)) return;
    }
    throw fail("藥水儲存忙碌，請重試", 503);
  }); } catch (error) {
    // Definite rejection before consumption must not block every future room tick.
    // A committed receipt is always recovered, never cancelled.
    const p = await room.sc.progressRepository.findByPlayerId(op.ownerId);
    if (Number(error.statusCode || error.status) < 500 && !(p?.livePotionReceipts || []).includes(op.receipt)) {
      const cancelled = structuredClone(state); cancelled.pendingLivePotion = null;
      if (!await room.sc.monsterService.saveStateIfActiveMonster(cancelled, room.zone, room.seq, state.currentHp)) throw fail("用藥取消等待存檔，請重試", 503);
      if (!rejectCancelled) return cancelled;
      error.livePotionCancelled = true;
    }
    throw error;
  }
  const candidate = structuredClone(state), owner = candidate.normalLive.actors[op.ownerId], target = candidate.normalLive.actors[op.targetId];
  target.hp = op.hpAfter; target.active = true; target.recoverAt = 0;
  if (op.revive && candidate.normalLiveDeath) delete candidate.normalLiveDeath[op.targetId];
  owner.potionUseUntil = op.cooldownUntil; target.potionTargetUntil = op.cooldownUntil;
  owner.potionPouch.find(e => e.uuid === op.uuid && e.itemId === op.itemId).remaining--;
  candidate.livePotionReceipts = [...(candidate.livePotionReceipts || []), op];
  candidate.pendingLivePotion = null;
  if (!await room.sc.monsterService.saveStateIfActiveMonster(candidate, room.zone, room.seq, state.currentHp)) throw fail("用藥結果等待存檔，請重試", 503);
  const actor = room.members.get(op.targetId);
  if (actor) { actor.hp = target.hp; actor.recoverAt = 0; if (op.revive) actor.attackAt = engine.now() + 300; }
  require("../../adapters/mongo/requestCache").clearCurrentCache();
  require("./playerEventBus").playerEventBus.invalidateInventory(op.ownerId);
  return candidate;
}
async function use(engine, room, ownerId, request) {
  let state = await recover(room, engine, await room.sc.monsterService.getState(room.zone));
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(String(request.operationId || ""))) throw fail("用藥操作識別碼不正確");
  const previous = (state.livePotionReceipts || []).find(o => o.ownerId === ownerId && o.operationId === request.operationId);
  if (previous) {
    if (previous.itemId !== request.itemId || previous.targetId !== request.targetId || previous.battleId !== request.battleId) throw fail("不能重複用於不同用藥操作", 409);
    return state;
  }
  const owner = state.normalLive?.actors?.[ownerId], target = state.normalLive?.actors?.[request.targetId];
  const member = room.members.get(request.targetId), item = definitions()[request.itemId];
  if (room.closed || state.currentHp <= 0 || owner?.id !== request.battleId || !owner.active || owner.hp <= 0) throw fail("本場已結束或你已倒地", 409);
  if (!target || !member || member.done || !item) throw fail("藥水或隊友不存在");
  const revive = item.effect.type === "tower_revive_pct";
  if (revive ? target.hp > 0 : target.hp <= 0) throw fail(revive ? "隊友尚未倒地" : "倒地者需要復活藥");
  if (!revive && target.hp >= target.maxHp) throw fail("隊友血量已滿");
  if (engine.now() < Math.max(owner.potionUseUntil || 0, target.potionTargetUntil || 0)) throw fail("用藥冷卻10秒", 409);
  const p = await room.sc.progressRepository.findByPlayerId(ownerId);
  const source = (owner.potionPouch || []).find(e => e.itemId === request.itemId && e.remaining > 0 && p?.inventory?.some(i => i.uuid === e.uuid && i.itemId === e.itemId));
  if (!source) throw fail("帶入藥水已用完，途中不能補帶");
  const value = item.effect.type === "tower_heal_flat" ? item.effect.value : Math.round(target.maxHp * item.effect.value / 100);
  state.pendingLivePotion = { receipt: `${owner.id}:${ownerId}:${request.operationId}`, ...request, ownerId,
    uuid: source.uuid, revive, slot: Number(p.activeCharacterSlot || 1), seasonKey: p.seasonKey,
    cooldownUntil: engine.now() + 10000, hpAfter: revive ? Math.max(1, value) : Math.min(target.maxHp, target.hp + value) };
  if (!await room.sc.monsterService.saveStateIfActiveMonster(state, room.zone, room.seq, state.currentHp)) throw fail("共鬥狀態更新中", 409);
  return recover(room, engine, state, true);
}
function view(room, state, id, now) {
  const a = state.normalLive?.actors?.[id];
  return { battleId: a?.id, zone: room.zone, limit: 10, cooldownUntil: a?.potionUseUntil || 0,
    items: Object.entries(definitions()).map(([itemId, item]) => ({ itemId, name: item.name, kind: item.effect.type === "tower_revive_pct" ? "revive" : "heal",
      remaining: (a?.potionPouch || []).filter(e => e.itemId === itemId).reduce((n, e) => n + e.remaining, 0) })),
    members: [...room.members.values()].filter(m => !m.done).map(m => ({ id: m.actorId, name: m.actorName, avatarUrl: require("./avatarCache").get(m.actorId) || null,
      hp: state.normalLive.actors[m.actorId].hp, maxHp: m.maxHp, targetUntil: state.normalLive.actors[m.actorId].potionTargetUntil || 0 })), serverNow: now };
}
module.exports = { validate, items, configure, recover, use, view };
