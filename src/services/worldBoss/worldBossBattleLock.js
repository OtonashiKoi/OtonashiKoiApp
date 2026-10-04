"use strict";
// 同一王的 Web/DC 結算串行，避免兩位玩家覆寫彼此的累積血量與機制狀態。
// 正式 runtime lease 保證單一戰鬥執行者；此鎖不占用玩家的動畫等待時間。
const queues = new Map();
async function acquireWorldBossBattleLock(zone) {
  const previous = queues.get(zone) || Promise.resolve();
  let resolve;
  const current = new Promise(r => { resolve = r; });
  queues.set(zone, current);
  await previous;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (queues.get(zone) === current) queues.delete(zone);
    resolve();
  };
}
module.exports = { acquireWorldBossBattleLock };
