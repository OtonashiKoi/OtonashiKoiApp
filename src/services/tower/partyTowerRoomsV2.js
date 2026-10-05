"use strict";
const { randomUUID, createHash, scryptSync, timingSafeEqual } = require("crypto");
const rules = require("../../shared/partyTowerRules");
const { normalizeTowerRole } = require("../../shared/towerRoles");
const { calcPlayerStats } = require("../../shared/combatStats");
const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");
const rewardRules = require("../battle/battleRewardRules");
const { normalExpMultiplier } = require("../monster/normalCoopScaling");
const { normalZoneExpMultiplier } = require("../../shared/normalZoneExp");
const presence = require("../../shared/battlePresence");
const { isWebBattleActive } = require("../progress/battleLock");
const { isUnavailableEquipment } = require("../../shared/equipmentAvailability");
const seasonState = require("../access/seasonStateStore");
const clone = value => structuredClone(value);
const telemetry = require("./partyTowerTelemetry");
const bard = require("../../shared/bardSong");
const partyBard = require("./partyTowerBard");
const jobs = require("../../shared/jobAdvancement");
const potions = require("./partyTowerPotions");
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const fingerprint = p => createHash("sha256").update(JSON.stringify([p.level, p.attributes, p.equipment, p.activeCharacterSlot || 1])).digest("hex");
function createPartyTowerRooms(sc, options = {}) {
  const repo = sc.partyTowerRepository;
  const now = options.now || Date.now;
  const fight = options.fightFloor || ((...args) => require("../../bot/handlers/towerHandlers").fightFloor(...args));
  let queue = Promise.resolve();
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  const bus = () => require("../realtime/playerEventBus").playerEventBus;
  let timer = null;
  const live = require("./partyTowerLiveCombat").createLiveCombat();
  const potionActions = potions.createPotionActions({ sc, now, save: room => save(room),
    onRevive: m => { if (bard.hasSong(m.equipped?.job_eq)) { partyBard.issue(m, now()); m.bardFeedback = null; } else m.bardChallenge = null; } });

  function view(room, viewer) {
    if (!room || !room.active) return null;
    const d = rules.difficulty(room.difficulty);
    return {
      roomId: room._id, leaderId: room.leaderId, isLeader: viewer === room.leaderId,
      status: room.status, difficulty: d.key, difficultyLabel: d.label, minLevel: d.minLevel,
      floor: room.liveCombat?.floor || room.lastFloorResult?.floor || Math.min(d.totalFloors, room.clearedFloor + 1),
      clearedFloor: room.clearedFloor, totalFloors: d.totalFloors, hasPassword: Boolean(room.passwordHash),
      members: room.members.map(m => ({ discordId: m.discordId, name: m.name, level: m.level, job: m.job?.name || null,
        avatarUrl: m.avatarUrl || null, jobBadgeImage: m.job?.imageUrl || null, jobEmoji: m.job?.emoji || "🏅", weaponType: m.stats?.weaponType || null,
        towerRole: m.towerRole, roleLabel: rules.ROLES[m.towerRole].label, roleEmoji: rules.ROLES[m.towerRole].emoji,
        roleModifiers: rules.ROLES[m.towerRole], ready: Boolean(m.ready), isSelf: m.discordId === viewer,
        hp: m.currentHp, maxHp: m.maxHp, alive: m.currentHp > 0, preview: rules.roleStats(m.stats, m.towerRole),
      })),
      monster: room.monsterPreview || null, lastFloorResult: room.lastFloorResult || null,
      reward: room.rewards?.[viewer] ? Object.fromEntries(Object.entries(room.rewards[viewer]).filter(([key]) => key !== "progressKills")) : null, failReason: room.failReason || null,
      playbackStartedAt: room.playbackStartedAt || null, nextAt: room.nextAt || null,
      selectionEndsAt: room.selectionEndsAt || null, selectionId: room.selectionId || null,
      strategy: room.members.find(m => m.discordId === viewer)?.strategy || null,
      strategyControls: (() => { const m = room.members.find(m => m.discordId === viewer); return m ? {
        stances: jobs.getStances(m.equipped?.job_eq), sacrifice: jobs.getSacrifice(m.equipped?.job_eq),
        bardChallenge: bard.viewChallenge(m.bardChallenge), bardAvailableAt: m.bardAvailableAt || 0, bardExpiresAt: room.status === "climbing" ? m.bardExpiresAt || null : null,
        bardFeedback: m.bardFeedback || null, confirmed: !!m.strategyReady,
      } : null; })(),
      strategyReadyIds: room.members.filter(m => m.strategyReady).map(m => m.discordId),
      runId: room.runId || null, settled: Boolean(room.settled), ...require("./partyTowerPresentation").roomAuras(room),
      ...potions.viewFields(room, viewer),
    };
  }
  function emit(room, type = "tower_room_update") {
    for (const m of room.members) bus().emit(m.discordId, { type, data: view(room, m.discordId) });
  }
  const save = async room => { await repo.save(room, room.version); emit(room); };
  async function roomFor(id, leader = false) {
    const room = await repo.findForPlayer(id);
    if (!room) throw error("你不在組隊房間內", 404);
    if (leader && room.leaderId !== id) throw error("只有隊長可以操作", 403);
    return room;
  }
  async function member(id, name, role, difficulty = "normal") {
    role = normalizeTowerRole(role);
    if (!role) throw error("請選擇坦克、輔助或輸出");
    const p = await sc.progressRepository.findByPlayerId(id);
    if (!p) throw error("找不到人物資料", 404);
    const equipped = await mergeEquippedFromLibrary(p.equipment || {}, sc.itemRepository);
    const stats = calcPlayerStats(p.attributes, equipped, p.activeEffects || [], p.inventory || [], {
      pkRating: p.pkRating, petStat: require("../../shared/petDex").statBonusOf(p.petDex),
    });
    const jobEq = equipped.job_eq;
    let avatarUrl = p.avatarUrl || null;
    if (options.resolveAvatar) avatarUrl = await options.resolveAvatar(id);
    else if (/^\d{15,22}$/.test(id)) {
      const client = require("../../bot/runtimeContext").getBotClient();
      if (client?.users) {
        try { avatarUrl = (await client.users.fetch(id, { force: false })).displayAvatarURL({ size: 256, extension: "png" }); } catch (_) {}
      }
    }
    const area = `party:${difficulty}`;
    const bardLevel = bard.readLevel(p, area, now());
    const m = { partyArea: area, discordId: id, name: name || "冒險者", level: p.level || 1, towerRole: role,
      avatarUrl,
      stats, equipped, inventory: p.inventory || [], activeEffects: p.activeEffects || [], progressSnapshot: p,
      job: { name: jobEq?.itemName || jobEq?.name || "新手", key: p.job || null, imageUrl: jobEq?.imageUrl || jobEq?.image || null, emoji: jobEq?.emoji || "🏅" },
      ready: false, fingerprint: fingerprint(p), partyV2: true,
      strategy: { stance: require("../../shared/battleStance").resolveRequestedStance(equipped), sacrifice: false },
      bardChallenge: bard.hasSong(jobEq) ? bard.newChallenge(bardLevel, now()) : null,
      bardStreak: bard.readStreak(p, area, now()), bardLevel, strategyReady: false,
    };
    m.maxHp = rules.roleStats(stats, role).maxHp; m.currentHp = m.maxHp;
    return m;
  }
  function checkLevel(m, key) {
    if (m.level < rules.difficulty(key).minLevel) throw error(`此難度需要 Lv.${rules.difficulty(key).minLevel} 以上`);
  }
  function resetReady(room) { for (const m of room.members) m.ready = false; }
  async function newRoom(id, name, password, role, key = "normal") {
    const seasonKey = await seasonState.ensureLoaded();
    rules.difficulty(key);
    if (await repo.findForPlayer(id)) throw error("你已在隊伍內，請先離開");
    const m = await member(id, name, role, key); checkLevel(m, key);
    const salt = randomUUID();
    const room = { _id: randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(), active: true,
      leaderId: id, seasonKey, difficulty: key, status: "lobby", members: [m], clearedFloor: 0,
      passwordSalt: salt, passwordHash: password ? scryptSync(String(password).trim().slice(0, 20), salt, 32).toString("hex") : null,
      createdAt: now(), version: null,
    };
    await save(room); return view(room, id);
  }
  async function join(id, name, code, password, role) {
    if (await repo.findForPlayer(id)) throw error("你已在隊伍內，請先離開");
    const room = await repo.find(String(code || "").trim().toUpperCase());
    if (!room?.active || room.status !== "lobby") throw error("房間不存在或已出發", 404);
    if (room.passwordHash && !timingSafeEqual(Buffer.from(room.passwordHash, "hex"), scryptSync(String(password || "").trim().slice(0, 20), room.passwordSalt, 32))) throw error("房間密碼錯誤", 403);
    if (room.members.length >= 5) throw error("隊伍已滿，最多五人");
    const m = await member(id, name, role, room.difficulty); checkLevel(m, room.difficulty);
    room.members.push(m); resetReady(room); await save(room); return view(room, id);
  }
  async function prepare(id, ready = true) {
    const room = await roomFor(id);
    if (room.status !== "lobby") throw error("請先回到組隊框");
    const old = room.members.find(m => m.discordId === id);
    const fresh = await member(id, old.name, old.towerRole, room.difficulty); checkLevel(fresh, room.difficulty);
    if (fresh.fingerprint !== old.fingerprint) resetReady(room);
    const strategy = Object.fromEntries(Object.entries({ strategy: old.strategy, bardChallenge: old.bardChallenge, bardStreak: old.bardStreak, bardLevel: old.bardLevel }).filter(([, value]) => value !== undefined));
    const potionPlan = fresh.fingerprint === old.fingerprint ? old.potionPlan : {};
    Object.assign(old, fresh, fresh.fingerprint === old.fingerprint ? strategy : {}, { ready: Boolean(ready), potionPlan });
    await save(room); return view(room, id);
  }
  async function setRole(id, role) {
    const room = await roomFor(id);
    if (room.status !== "lobby") throw error("戰鬥中不能換站位");
    const old = room.members.find(m => m.discordId === id);
    Object.assign(old, await member(id, old.name, role, room.difficulty), { potionPlan: old.potionPlan || {} }); resetReady(room);
    await save(room); return view(room, id);
  }
  async function setStrategy(id, request = {}) {
    const room = await roomFor(id);
    if (!["lobby", "climbing"].includes(room.status) || room.terminal) throw error("目前無法調整策略", 409);
    if (room.status === "climbing" && request.runId !== room.runId) throw error("副本已變更，請重新整理", 409);
    const m = room.members.find(member => member.discordId === id);
    if (m.currentHp <= 0) throw error("倒地隊員不能操作技能");
    const stance = require("../../shared/battleStance").resolveRequestedStance(m.equipped, request.stance ?? m.strategy?.stance);
    const sacrifice = request.sacrifice == null ? !!m.strategy?.sacrifice : request.sacrifice === true;
    if (sacrifice && !jobs.getSacrifice(m.equipped?.job_eq)) throw error("此職業無法使用血祭");
    const next = { ...m.strategy, stance, sacrifice };
    if (sacrifice && !m.strategy?.sacrifice) next.sacrificeActivationId = randomUUID();
    if (request.bardInput) {
      if (!bard.hasSong(m.equipped?.job_eq) || !m.bardChallenge || request.bardInput.token !== m.bardChallenge.token) throw error("演奏題目已失效", 409);
      if (now() < (m.bardAvailableAt || 0)) throw error("演奏尚在冷卻中", 409);
      const expired = request.bardInput.timedOut === true || (room.status === "climbing" && now() >= (m.bardExpiresAt || Infinity));
      const result = partyBard.finish(m, request.bardInput, now(), expired);
      next.bardResult = result; next.bardPerformanceId = m.strategy.bardPerformanceId;
    }
    m.strategy = next; m.strategyReady = request.confirm !== false;
    if (room.status === "lobby") m.ready = false;
    await save(room); return view(room, id);
  }
  async function setPotions(id, plan) {
    const room = await roomFor(id);
    await potionActions.configure(room, id, plan); return view(room, id);
  }
  async function chooseMonster(room) {
    const floor = room.clearedFloor + 1;
    const all = await sc.monsterService.listMonsters();
    const selected = require("../../shared/partyTowerEncounters").pickMonster(all, room.difficulty, floor);
    return { ...selected, encounterCount: selected.isBoss ? 1 : require('../../shared/encounterGroup').randomCount(5, options.encounterRandom || Math.random) };
  }
  async function addRewards(room, monster) {
    const n = room.members.length;
    const size = monster.isBoss ? 1 : require('../../shared/encounterGroup').count(monster.encounterCount);
    const goldPool = Math.max(monster.goldReward || 0, rewardRules.getDynamicGoldPoolFloor(monster.zone, n)) * size;
    const expPool = Math.round(Number(monster.expReward || 0) * normalExpMultiplier(n) * size);
    const singleDropPool = await rewardRules.buildMonsterDropPool(sc, monster);
    const dropPool = Array.from({ length: size }, () => singleDropPool).flat();
    const partyEffects = room.members.flatMap(m => rewardRules.collectRewardEffectRefs({ ...m.progressSnapshot, equipment: m.equipped }).filter(e => e.target === "party"));
    for (let i = 0; i < n; i++) {
      const m = room.members[i];
      const p = { ...m.progressSnapshot, equipment: m.equipped };
      const mod = rewardRules.buildRewardModifiers(p, partyEffects);
      // Match the normal-area support profession reward bonus.
      if (/healer|tactician|bard|barrier_mage|治療|軍師|詩人|結界/i.test(String(m.equipped.job_eq?.itemId || "") + m.job.name)) {
        mod.expMultiplier *= 1.1; mod.goldMultiplier *= 1.1; mod.dropPct += 5;
      }
      const r = room.rewards[m.discordId];
      const record = require('./partyTowerProgress').killRecord(room, m, monster, room.lastFloorResult, now());
      for (let k = 0; k < size; k++) (r.progressKills ||= []).push(k === 0 ? record : { ...record, metrics: { battle_win: 1 } });
      const share = pool => Math.floor(pool / n) + (i < pool % n ? 1 : 0);
      r.gold += Math.round(share(goldPool) * mod.goldMultiplier);
      r.exp += Math.round(share(expPool) * mod.expMultiplier * normalZoneExpMultiplier(monster.zone, m.level) * 1.5);
      for (const drop of dropPool) {
        const item = await sc.itemRepository.findById(drop.itemId);
        if (!item || isUnavailableEquipment(item)) continue;
        const chance = Math.min(100, rewardRules.calculateFinalDropChance(drop.chance, mod, item) * 1.5);
        if (Math.random() * 100 >= chance) continue;
        const entry = { ...item, uuid: randomUUID(), itemId: item.id, itemName: item.name, itemEffect: item.effect,
          equipStats: clone(item.equipStats || {}), enhanceLevel: 0, source: "party_tower_drop", sourceRef: room.runId,
          purchasedAt: new Date(now()).toISOString(), monsterName: monster.name, floor: room.clearedFloor,
        };
        delete entry._id;
        require("../enchant/enchantService").rollForEntry(entry);
        if (item.elementDrop || monster.element) require("../../shared/elementDropRoll").rollElementForEntry(entry, {
          element: monster.element, maxLevel: monster.elementLevel || 1,
          zone: monster.zone, monsterLevel: monster.level, override: item.elementDrop || null });
        r.drops.push(require("../../shared/inventoryStorage").slimInventoryEntry(entry));
      }
    }
  }
  async function settle(room) {
    if (room.settled) return;
    if (room.seasonKey !== await seasonState.ensureLoaded()) throw error("賽季已變更，舊副本不可結算到新存檔", 409);
    for (const m of room.members) {
      const r = room.rewards?.[m.discordId]; if (!r) continue;
      const key = `${room.runId}:${m.discordId}`;
      await require("./partyTowerProgress").settleProgress(sc, room, m, r, now());
      if (r.gold > 0) await sc.rewardService.grantCurrency({ discordId: m.discordId, displayName: m.name, currencyType: "gold", amount: r.gold,
        source: "tower:reward", sourceRef: key, operator: "party-tower" });
      if (r.exp > 0) await sc.progressService.grantExp({ discordId: m.discordId, displayName: m.name, amount: r.exp,
        source: "tower:reward-exp", operationId: key });
      if (r.drops.length) {
        const p = await sc.progressRepository.findByPlayerId(m.discordId);
        const bp = require("../backpack/backpackService");
        const capacity = options.capacity ? await options.capacity(m.discordId) : (await bp.resolveEffectiveCapacity(m.discordId)).cap;
        const pending = (p.inventory || []).filter(bp.countsTowardCapacity).length + r.drops.filter(bp.countsTowardCapacity).length > capacity;
        await repo.grantItems(m.discordId, r.drops, key, pending); r.pending = pending;
      }
    }
    for (const m of room.members) {
      const fields = require("../../shared/partyCombatState").persistedState(m, now());
      if (!Object.keys(fields).length) continue;
      const receipt = `${room.runId}:${m.discordId}`;
      await require("../progress/progressLocks").withPlayerProgressLock(m.discordId, async () => {
        for (let retry = 0; retry < 8; retry++) {
          const p = await sc.progressRepository.findByPlayerId(m.discordId);
          if (!p) throw error("找不到人物資料", 404);
          if (p.partyJobStateReceipt === receipt) return;
          if (Number(p.activeCharacterSlot || 1) !== Number(m.progressSnapshot?.activeCharacterSlot || 1)) throw error("人物已切換，職業狀態等待恢復", 409);
          const next = { ...p, ...fields, partyJobStateReceipt: receipt, updatedAt: new Date(now()).toISOString() };
          if (await sc.progressRepository.saveIfUnchanged(next, p.updatedAt)) return;
        }
        throw error("職業狀態儲存忙碌，請重試", 409);
      });
    }
    room.settled = true; await save(room);
    presence.setTowerPresence(room.members.map(m => m.discordId), false);
  }
  async function finish(room, reason = null) {
    telemetry.finishRun(room, reason, now());
    room.status = "ended"; room.failReason = reason; room.nextAt = null; room.liveCombat = null; live.forget(room);
    await save(room); await settle(room); emit(room, "tower_room_ended");
  }
  async function completeFloor(room, monster, scaled, floor, result) {
    if (result.interrupted) throw error("戰鬥無法正常結束，已停止並保留先前獎勵", 503);
    const playback = room.lastFloorResult?.memberLogs || [];
    room.lastFloorResult = { ...room.lastFloorResult, ...result, memberLogs: playback,
      members: room.members.map(m => ({ name: m.name, hp: m.currentHp, maxHp: m.maxHp, alive: m.currentHp > 0 })) };
    if (result.monsterKilled && result.survived) {
      room.clearedFloor = floor; await addRewards(room, monster);
      room.lastFloorResult.metalRecovery = room.members.map(m => {
        let healed = 0;
        for (let k = 0; k < require("../../shared/encounterGroup").count(monster.encounterCount); k++)
          healed += require("../../shared/metalCards").applyMetalPartyRecovery(m, `${room.runId}:${floor}:${k}`);
        return { discordId: m.discordId, name: m.name, healed };
      }).filter(r => r.healed > 0);
      room.lastFloorResult.systemRecovery = potions.systemRecovery(room.members, floor);
      room.lastFloorResult.members = room.members.map(m => ({ name: m.name, hp: m.currentHp, maxHp: m.maxHp, alive: m.currentHp > 0 }));
      require("../../shared/partyCombatState").knockEnvironment(room, monster.zone, now());
      if (floor === rules.difficulty(room.difficulty).totalFloors) room.terminal = "win";
    } else {
      const analysis = require("./partyTowerFailure").analyzePartyFailure(room, room.lastFloorResult, scaled.calc.maxHp);
      room.lastFloorResult.failureAnalysis = analysis.evidence;
      room.terminal = analysis.reason;
    }
    telemetry.completeFloor(room, result, now());
    room.liveCombat = null;
    room.nextAt = Math.max(now(), room.nextAt || now()) + (options.playbackMs ?? 450);
  }
  async function step(room) {
    if (room.status !== "climbing") return;
    if (room.terminal) { await finish(room, room.terminal === "win" ? null : room.terminal); return; }
    if (!room.liveCombat) {
      const floor = room.clearedFloor + 1, monster = await chooseMonster(room), scaled = rules.scaleMonster(monster, room.difficulty);
      scaled.calc.maxHp *= monster.encounterCount;
      const environment = require("../../shared/partyCombatState").zoneEnvironment(room, monster.zone, now());
      for (const m of room.members) m.partyEnvironment = { freezeOn: environment.freezeOn, sanctumOn: environment.sanctumOn };
      require("../../bot/handlers/towerHandlers").refreshTowerMemberMaxHp({ members: room.members }, floor, { zone: monster.zone });
      const hpBefore = room.members.map(m => ({ discordId: m.discordId, name: m.name, hp: m.currentHp, maxHp: m.maxHp }));
      room.monsterPreview = { encounterCount: monster.encounterCount, name: monster.name, level: monster.level, imageUrl: monster.imageUrl || null, zone: monster.zone, element: monster.element || null, elementLevel: monster.elementLevel || 0, isBoss: Boolean(monster.isBoss), isFloorBoss: floor % 5 === 0, hp: scaled.calc.maxHp, atk: scaled.calc.atk };
      telemetry.beginFloor(room, floor, now(), monster);
      room.playbackStartedAt = now();
      room.lastFloorResult = { floor, monsterName: monster.name, hpBefore, memberLogs: [], survived: true, monsterKilled: false, streaming: true, members: [] };
      if (options.fightFloor) {
        const result = await fight({ partyV2: true, currentFloor: floor, members: room.members }, scaled, scaled.calc.maxHp, scaled.calc.atk);
        room.lastFloorResult.memberLogs = (result.memberLogs || []).map(a => ({ ...a, actionMs: 0 }));
        for (const action of result.memberLogs || []) telemetry.recordAction(room, action, now());
        room.nextAt = now(); await completeFloor(room, monster, scaled, floor, result);
        await save(room); return;
      }
      live.initialize(room, scaled, floor, now());
    }
    const environment = require("../../shared/partyCombatState").zoneEnvironment(room, room.monsterPreview.zone, now());
    for (const m of room.members) m.partyEnvironment = { freezeOn: environment.freezeOn, sanctumOn: environment.sanctumOn };
    const { monster, floor } = room.liveCombat;
    const { action, result } = live.advance(room, now());
    if (action) {
      telemetry.recordAction(room, action, now());
      action.startedAt = now();
      action.actionMs = Math.round(require("../../shared/battleTiming").calculateBattleTickMs(action.agi || 1) / 2);
      room.lastFloorResult.memberLogs.push(action);
      room.lastFloorResult.members = room.members.map(m => ({ name: m.name, hp: m.currentHp, maxHp: m.maxHp, alive: m.currentHp > 0 }));
      room.nextAt = now() + action.actionMs;
    }
    for (const m of room.members) if (m.currentHp <= 0) { m.bardChallenge = null; m.bardExpiresAt = null; m.bardFeedback = null; m.bardStreak = 0; m.bardLevel = 0; if (m.strategy) m.strategy.bardResult = null; }
    if (result) await completeFloor(room, monster, monster, floor, result);
    await save(room); emit(room, "tower_floor_result");
  }
  async function start(id) {
    const room = await roomFor(id, true);
    if (repo.syncTelemetry) await repo.syncTelemetry(room);
    if (room.status !== "lobby") throw error("已出發，無須重複按戰鬥");
    rules.assertParty(room.members, room.difficulty);
    for (const m of room.members) {
      if (presence.isMonsterBattleActive(m.discordId) || presence.isPkBattleActive(m.discordId) || presence.isTowerBattleActive(m.discordId) || isWebBattleActive(m.discordId)) throw error(`${m.name} 正在其他戰鬥中`, 409);
      const fresh = await member(m.discordId, m.name, m.towerRole, room.difficulty);
      if (fresh.fingerprint !== m.fingerprint) { resetReady(room); await save(room); throw error("人物或裝備已變更，請全員重新準備", 409); }
      const chosen = Object.fromEntries(Object.entries({ potionPlan: m.potionPlan, strategy: m.strategy, bardChallenge: m.bardChallenge, bardStreak: m.bardStreak, bardLevel: m.bardLevel }).filter(([, value]) => value !== undefined));
      Object.assign(m, fresh, chosen, { ready: true });
      potions.freezePouch(m);
    }
    room.status = "climbing"; room.runId = randomUUID(); room.clearedFloor = 0; room.terminal = null; room.settled = false;
    telemetry.startRun(room, now());
    room.rewards = Object.fromEntries(room.members.map(m => [m.discordId, { gold: 0, exp: 0, drops: [] }]));
    room.zoneEnvironments = {}; room.selectionEndsAt = null; room.selectionId = null;
    room.potionReceipts = []; room.pendingPotion = null; room.liveCombat = null;
    for (const m of room.members) { m.potionUseUntil = 0; m.potionTargetUntil = 0; m.bardFeedback = null; if (bard.hasSong(m.equipped?.job_eq)) partyBard.issue(m, now()); }
    room.lastFloorResult = null; room.monsterPreview = null; room.playbackStartedAt = null; room.failReason = null;
    room.nextAt = now(); await save(room);
    presence.setTowerPresence(room.members.map(m => m.discordId), true);
    return view(room, id);
  }
  async function stopForChange(room) {
    await potionActions.recover(room);
    if (["climbing", "selecting"].includes(room.status)) await finish(room, "隊伍成員變動，戰鬥已停止；已擊敗樓層獎勵保留");
    if (room.status === "ended" && !room.settled) await settle(room);
  }
  async function remove(id, target = id, disband = false) {
    const room = await roomFor(id, target !== id || disband);
    if (target !== id && target === room.leaderId) throw error("不能踢掉隊長");
    if (!room.members.some(m => m.discordId === target)) throw error("該玩家不在隊伍內", 404);
    await stopForChange(room);
    const removed = disband ? room.members.map(m => m.discordId) : [target];
    room.members = disband ? [] : room.members.filter(m => m.discordId !== target);
    if (!room.members.length) room.active = false;
    else if (room.leaderId === target) room.leaderId = room.members[0].discordId;
    resetReady(room); await save(room); presence.setTowerPresence(removed, false);
    for (const pid of removed) bus().emit(pid, { type: "tower_room_update", data: null });
    return removed.includes(id) ? null : view(room, id);
  }
  async function returnLobby(id) {
    const room = await roomFor(id);
    if (room.status !== "ended") throw error("戰鬥尚未結束");
    await settle(room); room.status = "lobby"; resetReady(room); room.terminal = null;
    for (const m of room.members) Object.assign(m, await member(m.discordId, m.name, m.towerRole, room.difficulty));
    await save(room); return view(room, id);
  }
  async function tick() {
    const seasonKey = await seasonState.ensureLoaded();
    for (const room of await repo.list()) {
      if (repo.syncTelemetry) { try { await repo.syncTelemetry(room); } catch (e) { console.error("[PartyTelemetry] retry pending", e.message); } }
      if (room.pendingPotion) {
        try { await potionActions.recover(room); } catch (e) { console.error("[PartyPotion]", e.message); continue; }
      }
      if (room.seasonKey !== seasonKey) {
        telemetry.finishRun(room, "換季後舊隊伍已停止", now());
        room.active = false; room.status = "ended"; room.failReason = "換季後舊隊伍已停止";
        await save(room); presence.setTowerPresence(room.members.map(m => m.discordId), false); continue;
      }
      if (["climbing", "selecting"].includes(room.status)) {
        presence.setTowerPresence(room.members.map(m => m.discordId), true);
        // Upgrade old selection rooms without another rest; old precomputed fights
        // finish their already committed animation before starting the next monster.
        if (room.status === "selecting") { room.status = "climbing"; room.selectionEndsAt = null; room.selectionId = null; room.nextAt = now(); }
        if (partyBard.expire(room, now())) await save(room);
        if ((room.nextAt || 0) > now()) continue;
        try { await step(room); } catch (e) {
          if (e.status === 409) continue;
          // Do not convert infrastructure failures into a player wipe; retain the last committed floor.
          const latest = await repo.find(room._id);
          if (latest && ["climbing", "selecting"].includes(latest.status)) await finish(latest, `異常停止：${e.message}`);
        }
      } else if (room.status === "ended" && !room.settled) await settle(room);
    }
  }
  if (options.auto !== false) {
    let pendingTick = false;
    timer = setInterval(() => { if (pendingTick) return; pendingTick = true; serial(tick).catch(e => console.error("[PartyTower]", e.message)).finally(() => { pendingTick = false; }); }, 250); timer.unref();
  }
  return {
    createRoom: (...args) => serial(() => newRoom(...args)), joinRoom: (...args) => serial(() => join(...args)),
    getState: async id => view(await repo.findForPlayer(id), id),
    listOpenRooms: async () => (await repo.list()).filter(r => r.status === "lobby" && !r.passwordHash && r.members.length < 5).map(r => ({ roomId: r._id,
      leaderName: r.members.find(m => m.discordId === r.leaderId)?.name, memberCount: r.members.length, maxMembers: 5,
      difficulty: r.difficulty, minLevel: rules.difficulty(r.difficulty).minLevel, totalFloors: rules.difficulty(r.difficulty).totalFloors,
      roles: r.members.map(m => rules.ROLES[m.towerRole].emoji), jobs: [] })),
    setRole: (...args) => serial(() => setRole(...args)), setReady: (...args) => serial(() => prepare(...args)),
    setStrategy: (...args) => serial(() => setStrategy(...args)),
    setPotions: (...args) => serial(() => setPotions(...args)),
    startRoom: id => serial(() => start(id)), kickMember: (id, target) => serial(() => remove(id, target)),
    leaveRoom: id => serial(() => remove(id)), disband: id => serial(() => remove(id, id, true)),
    returnLobby: id => serial(() => returnLobby(id)), retreat: id => serial(async () => { const room = await roomFor(id, true); await stopForChange(room); return view(room, id); }),
    advanceFloor: id => serial(async () => { const room = await roomFor(id, true); if (room.status !== "climbing") throw error("請先準備並出發"); return view(room, id); }),
    listMyItems: async id => { const room = await roomFor(id), p = await sc.progressRepository.findByPlayerId(id);
      return potions.listItems(room.members.find(m => m.discordId === id), p?.inventory || [], room.status === "lobby"); },
    usePartyItem: (id, itemId, targetId = id, request = {}) => serial(async () => {
      const room = await roomFor(id); await potionActions.use(room, id, itemId, targetId, request); return view(room, id);
    }),
    claimPending: id => serial(() => require("./partyTowerClaims").claimPending({ sc, options, now, id })),
    tick: () => serial(tick), close: () => { if (timer) clearInterval(timer); },
  };
}
module.exports = { createPartyTowerRooms };
