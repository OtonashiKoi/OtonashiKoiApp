/**
 * 日麻排隊系統 — 純記憶體狀態
 * server 重啟後清空（直播期間用，合理）
 */

// 等待佇列：[{ name, userId, platform, joinedAt }]
let queue = [];

// 已組成的隊伍：[{ id, members: [...], formedAt }]
let teams = [];

// SSE 訂閱者（mahjong.html 監聽用）
const subscribers = new Set();

let teamCounter = 1;

function broadcast() {
  const data = getState();
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  subscribers.forEach(res => {
    try { res.write(payload); } catch (_) { subscribers.delete(res); }
  });
}

function getState() {
  return { queue, teams, teamSize: 0, updatedAt: new Date().toISOString() };
}

/**
 * 玩家喊 ++ 加入排隊
 * @returns {{ joined: bool, alreadyIn: bool, newTeam: object|null }}
 */
function joinQueue(name, userId, platform) {
  // 已在排隊或已在某隊伍中
  const inQueue = queue.some(p => p.userId === userId && p.platform === platform);
  const inTeam  = teams.some(t => t.members.some(m => m.userId === userId && m.platform === platform));
  if (inQueue || inTeam) return { joined: false, alreadyIn: true, newTeam: null };

  queue.push({ name, userId, platform, joinedAt: new Date().toISOString() });

  broadcast();
  return { joined: true, alreadyIn: false, newTeam: null };
}

/** 手動移除排隊（主持人操作） */
function removeFromQueue(userId, platform) {
  const before = queue.length;
  queue = queue.filter(p => !(p.userId === userId && p.platform === platform));
  if (queue.length !== before) broadcast();
  return queue.length !== before;
}

/** 調整排隊順序 */
function moveQueueEntry(userId, platform, direction) {
  const index = queue.findIndex((p) => p.userId === userId && p.platform === platform);
  if (index === -1) return false;

  let targetIndex = index;
  if (direction === "up") targetIndex = Math.max(0, index - 1);
  if (direction === "down") targetIndex = Math.min(queue.length - 1, index + 1);
  if (direction === "top") targetIndex = 0;
  if (direction === "bottom") targetIndex = queue.length - 1;

  if (targetIndex === index) return false;

  const [entry] = queue.splice(index, 1);
  queue.splice(targetIndex, 0, entry);
  broadcast();
  return true;
}

/** 直接移動到指定 index（拖曳排序用） */
function moveQueueEntryToIndex(userId, platform, targetIndex) {
  const index = queue.findIndex((p) => p.userId === userId && p.platform === platform);
  if (index === -1) return false;

  const safeIndex = Math.max(0, Math.min(queue.length - 1, Number(targetIndex)));
  if (safeIndex === index || Number.isNaN(safeIndex)) return false;

  const [entry] = queue.splice(index, 1);
  queue.splice(safeIndex, 0, entry);
  broadcast();
  return true;
}

/** 解散指定隊伍 */
function dismissTeam(teamId) {
  const before = teams.length;
  teams = teams.filter(t => t.id !== teamId);
  if (teams.length !== before) broadcast();
  return teams.length !== before;
}

/** 清空所有狀態 */
function resetAll() {
  queue = [];
  teams = [];
  teamCounter = 1;
  broadcast();
}

module.exports = { getState, joinQueue, removeFromQueue, moveQueueEntry, moveQueueEntryToIndex, dismissTeam, resetAll, subscribers };
