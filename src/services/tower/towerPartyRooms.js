"use strict";
// 網頁組隊爬塔・房間服務(Stage 1 後端)
// 房間/大廳/逐層推進。戰鬥核心「重用」DC towerHandlers 的:
//   loadMemberData(備成員) / refreshTowerMemberMaxHp(每層重算血) / pickFloorMonster(抽怪) / fightFloor(多人結算)
// 即時同步走現有 playerEventBus(SSE),前端用 /api/me/stream 收 tower_room_* 事件。
// 房間目前存記憶體(單一 PM2 instance);重啟會掉房——持久化列為後續增強。
const TW = require("../../shared/towerConfig");
const { AppError, ERROR_CODES } = require("../../shared/errors");

function genRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混淆 I/O/0/1
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function createTowerPartyRooms(serviceContext) {
  const rooms = new Map();      // roomId -> room
  const playerRoom = new Map(); // discordId -> roomId

  const tower = () => require("../../bot/handlers/towerHandlers");
  const bus = () => require("../realtime/playerEventBus").playerEventBus;

  function emitRoom(room, type, data) {
    const b = bus();
    for (const m of room.members) { try { b.emit(m.discordId, { type, data }); } catch (_) {} }
  }

  // 對外快照(給 state / SSE 用):不外洩 baseStats 等內部欄位
  function roomView(room, viewerId = null) {
    return {
      roomId: room.roomId,
      leaderId: room.leaderId,
      status: room.status,                  // lobby / climbing / ended
      floor: room.clearedFloor + 1,
      clearedFloor: room.clearedFloor,
      totalFloors: TW.TOWER_TOTAL_FLOORS,
      isLeader: viewerId === room.leaderId,
      hasPassword: Boolean(room.password),
      members: room.members.map((m) => ({
        discordId: m.discordId, name: m.name, level: m.level,
        job: m.job?.name || m.job || null, jobEmoji: m.job?.emoji || null,
        hp: Math.max(0, Math.round(m.currentHp || 0)), maxHp: Math.max(0, Math.round(m.maxHp || 0)),
        alive: (m.currentHp || 0) > 0,
      })),
      monster: room._upcomingPreview || null,
      ...floorInfo(room.clearedFloor + 1),
      lastFloorResult: room.lastFloorResult || null,
      reward: room.reward || null,
      failReason: room.failReason || null,
    };
  }

  function floorInfo(floor) {
    const buff = TW.getTowerFloorBuff(floor);
    const bonus = TW.getCumulativePartyBonus(floor);
    const BOSS = [10, 20, 30, 40, 50, 51, 52];
    const nextBossFloor = BOSS.find((f) => f >= floor) || null;
    return {
      segmentLabel: buff?.label || null, segmentEmoji: buff?.emoji || null,
      partyBonus: { atkPct: bonus.atkPct, hpPct: bonus.hpPct },
      nextBossFloor, nextBossName: nextBossFloor ? TW.getTowerFloorBossName(nextBossFloor) : null,
    };
  }

  async function monsterPreview(room) {
    // 預抽當層怪(供面板顯示「本層敵人」),fight 時用同一隻
    const floor = room.clearedFloor + 1;
    const m = await tower().pickFloorMonster(floor).catch(() => null);
    room._upcoming = m;
    room._upcomingPreview = m ? {
      name: m.name, imageUrl: m.imageUrl || m.imageThumbnailUrl || null,
      isBoss: Boolean(m.isBoss), isFloorBoss: Boolean(TW.getTowerFloorBossName(floor)),
      hp: TW.scaleTowerMonsterHp(m.calc?.maxHp || m.maxHp || 0, floor),
      atk: TW.scaleTowerMonsterAtk(m.calc?.atk || 0, floor),
    } : null;
  }

  async function buildMember(discordId, displayName) {
    const p = await tower().loadMemberData(discordId);
    if (!p) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到玩家資料", 404);
    return {
      discordId, name: displayName || p.name || "冒險者", level: p.level,
      stats: p.stats, equipped: p.equipped, inventory: p.inventory,
      activeEffects: p.activeEffects, towerRecord: p.towerRecord, job: p.job,
      currentHp: 0, maxHp: 0,
    };
  }

  function assertLevel(member) {
    if ((member.level || 1) < TW.TOWER_MIN_LEVEL) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `組隊爬塔需要 Lv.${TW.TOWER_MIN_LEVEL} 以上`, 400);
    }
  }

  const normPw = (pw) => String(pw || "").trim().slice(0, 20);

  // ── 大廳 ───────────────────────────────────────────
  async function createRoom(discordId, displayName, password) {
    if (playerRoom.has(discordId)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "你已在一個爬塔房內,請先離開", 400);
    const member = await buildMember(discordId, displayName);
    assertLevel(member);
    let roomId; do { roomId = genRoomId(); } while (rooms.has(roomId));
    const room = {
      roomId, leaderId: discordId, status: "lobby",
      password: normPw(password) || null, // 有密碼=私約房(不進公開列表)
      members: [member], clearedFloor: 0, used: new Set(),
      createdAt: Date.now(), lastActiveAt: Date.now(), _resolving: false,
    };
    rooms.set(roomId, room); playerRoom.set(discordId, roomId);
    return roomView(room, discordId);
  }

  async function joinRoom(discordId, displayName, roomId, password) {
    const room = rooms.get(String(roomId || "").toUpperCase().trim());
    if (!room) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該房間(房號是否正確?)", 404);
    if (room.status !== "lobby") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "該隊伍已經開始攻塔,無法加入", 400);
    if (room.password && room.password !== normPw(password)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "房間密碼錯誤", 403);
    if (room.members.length >= TW.TOWER_MAX_MEMBERS) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `隊伍已滿(最多 ${TW.TOWER_MAX_MEMBERS} 人)`, 400);
    if (playerRoom.has(discordId)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "你已在一個爬塔房內,請先離開", 400);
    const member = await buildMember(discordId, displayName);
    assertLevel(member);
    room.members.push(member); playerRoom.set(discordId, roomId);
    room.lastActiveAt = Date.now();
    emitRoom(room, "tower_room_update", roomView(room));
    return roomView(room, discordId);
  }

  // 公開隊伍列表:大廳中、無密碼、未滿的房(私約房有密碼→不列出,只能用房號+密碼進)
  function listOpenRooms() {
    const out = [];
    for (const room of rooms.values()) {
      if (room.status !== "lobby" || room.password || room.members.length >= TW.TOWER_MAX_MEMBERS) continue;
      const leader = room.members.find((m) => m.discordId === room.leaderId) || room.members[0];
      out.push({
        roomId: room.roomId,
        leaderName: leader?.name || "?",
        memberCount: room.members.length,
        maxMembers: TW.TOWER_MAX_MEMBERS,
        jobs: room.members.map((m) => m.job?.emoji || "❔"),
      });
    }
    return out.sort((a, b) => b.memberCount - a.memberCount).slice(0, 30);
  }

  // 隊長踢人
  function kickMember(leaderId, targetId) {
    const room = requireLeaderRoom(leaderId);
    if (room.status !== "lobby") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "攻塔開始後無法踢人", 400);
    if (targetId === leaderId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "不能踢自己", 400);
    if (!room.members.some((m) => m.discordId === targetId)) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "該成員不在隊伍中", 404);
    room.members = room.members.filter((m) => m.discordId !== targetId);
    playerRoom.delete(targetId);
    room.lastActiveAt = Date.now();
    emitRoom(room, "tower_room_update", roomView(room));       // 通知剩餘成員
    try { bus().emit(targetId, { type: "tower_room_update", data: null }); } catch (_) {} // 通知被踢者→其 state 變 null 退回單人
    return roomView(room, leaderId);
  }

  function leaveRoom(discordId) {
    const roomId = playerRoom.get(discordId);
    if (!roomId) return null;
    const room = rooms.get(roomId);
    playerRoom.delete(discordId);
    if (!room) return null;
    room.members = room.members.filter((m) => m.discordId !== discordId);
    if (room.members.length === 0) { rooms.delete(roomId); return null; }
    if (room.leaderId === discordId) room.leaderId = room.members[0].discordId; // 隊長離開→移交
    emitRoom(room, "tower_room_update", roomView(room));
    return roomView(room);
  }

  function getState(discordId) {
    const roomId = playerRoom.get(discordId);
    const room = roomId ? rooms.get(roomId) : null;
    return room ? roomView(room, discordId) : null;
  }

  async function startRoom(discordId) {
    const room = requireLeaderRoom(discordId);
    if (room.status !== "lobby") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "已經開始了", 400);
    room.status = "climbing";
    room.clearedFloor = 0;
    // 設好每位成員第 1 層的 MaxHP/HP(重用 DC 邏輯)
    tower().refreshTowerMemberMaxHp({ members: room.members }, 1);
    for (const m of room.members) m.currentHp = m.maxHp;
    await monsterPreview(room);
    room.lastActiveAt = Date.now();
    emitRoom(room, "tower_room_update", roomView(room));
    return roomView(room, discordId);
  }

  // ── 逐層推進(隊長按進攻)──────────────────────────
  async function advanceFloor(discordId) {
    const room = requireLeaderRoom(discordId);
    if (room.status !== "climbing") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "尚未開始攻塔", 400);
    if (room._resolving) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "結算中,請稍候", 409);
    room._resolving = true;
    try {
      const floor = room.clearedFloor + 1;
      // 重用 DC 核心:每層前重算血 → 抽怪(用預抽的)→ 縮放 → 多人結算
      tower().refreshTowerMemberMaxHp({ members: room.members, currentFloor: floor }, floor);
      const monster = room._upcoming || await tower().pickFloorMonster(floor);
      if (!monster) { room.failReason = `第 ${floor} 層找不到怪物`; return await finish(room, false); }
      const scaledHp = TW.scaleTowerMonsterHp(monster.calc?.maxHp || monster.maxHp || 200, floor);
      const scaledAtk = TW.scaleTowerMonsterAtk(monster.calc?.atk || 20, floor);
      const session = { currentFloor: floor, clearedFloor: room.clearedFloor, members: room.members };
      const fr = await tower().fightFloor(session, monster, scaledHp, scaledAtk);

      room.lastFloorResult = {
        floor, monsterName: monster.name, survived: fr.survived, monsterKilled: fr.monsterKilled,
        members: room.members.map((m) => ({ name: m.name, hp: Math.max(0, Math.round(m.currentHp || 0)), maxHp: Math.round(m.maxHp || 0), alive: (m.currentHp || 0) > 0 })),
      };

      if (fr.monsterKilled) {
        room.clearedFloor = floor;
        if (room.clearedFloor >= TW.TOWER_TOTAL_FLOORS) return await finish(room, true);
        await monsterPreview(room); // 預抽下一層
        room.lastActiveAt = Date.now();
        const view = roomView(room);
        emitRoom(room, "tower_floor_result", view);
        return roomView(room, discordId);
      }
      // 沒打死(全員陣亡或回合耗盡)→ 結束
      room.failReason = room.members.every((m) => (m.currentHp || 0) <= 0) ? "全隊陣亡" : "回合耗盡未擊殺";
      return await finish(room, false);
    } finally {
      room._resolving = false;
    }
  }

  async function finish(room, success) {
    room.status = "ended";
    const reward = TW.calcTowerReward(room.clearedFloor);
    // 每位在場成員發獎(金幣/EXP)+ 更新個人最高層(沿用單人 web 塔的發法)
    for (const m of room.members) {
      try {
        if (reward.gold > 0) await serviceContext.rewardService.grantCurrency({ discordId: m.discordId, displayName: m.name, currencyType: "gold", amount: reward.gold, source: require("../../shared/sources").CURRENCY_SOURCES.TOWER_REWARD, operator: "tower:party" }).catch(() => {});
        if (reward.exp > 0 && serviceContext.progressService?.grantExp) await serviceContext.progressService.grantExp({ discordId: m.discordId, displayName: m.name, amount: reward.exp, source: "tower:reward-exp" }).catch(() => {});
        const prog = await serviceContext.progressRepository.findByPlayerId(m.discordId).catch(() => null);
        if (prog) {
          const rec = prog.towerRecord || { bestFloor: 0, totalRuns: 0 };
          rec.totalRuns = (rec.totalRuns || 0) + 1;
          if (room.clearedFloor > (rec.bestFloor || 0)) { rec.bestFloor = room.clearedFloor; rec.bestAt = new Date().toISOString(); }
          prog.towerRecord = rec; prog.updatedAt = new Date().toISOString();
          await serviceContext.progressRepository.save(prog).catch(() => {});
        }
      } catch (_) {}
    }
    room.reward = { ...reward, clearedFloor: room.clearedFloor };
    emitRoom(room, "tower_room_ended", roomView(room));
    // 清房
    for (const m of room.members) playerRoom.delete(m.discordId);
    setTimeout(() => rooms.delete(room.roomId), 60_000); // 留 60 秒讓前端讀結算
    return roomView(room);
  }

  async function retreat(discordId) {
    const room = requireLeaderRoom(discordId);
    if (room.status !== "climbing") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "尚未開始", 400);
    room.failReason = "隊長撤退";
    return await finish(room, true);
  }

  function requireLeaderRoom(discordId) {
    const roomId = playerRoom.get(discordId);
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "你不在任何爬塔房內", 404);
    if (room.leaderId !== discordId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只有隊長能操作", 403);
    return room;
  }

  return { createRoom, joinRoom, leaveRoom, getState, startRoom, advanceFloor, retreat, listOpenRooms, kickMember, _rooms: rooms };
}

module.exports = { createTowerPartyRooms };
