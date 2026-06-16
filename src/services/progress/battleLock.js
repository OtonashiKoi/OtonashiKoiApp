"use strict";

// 網頁側「戰鬥進行中」登記表。
// 目的：讓同一玩家在 DC / 網頁 / 其他裝置之間，同一時間只能有一場戰鬥。
//   - DC 端的戰鬥占用是用 shared/battlePresence 的 monsterBattlePlayers（由 activeSessions 同步）。
//   - 網頁端的戰鬥占用就記在這裡；DC 端會反查 isWebBattleActive 來互斥。
// 單一 PM2 程序（src/index.js 同時跑 bot 與 web）→ 記憶體登記即可覆蓋兩邊。
//
// 帶逾時保護（HARD_TTL）：萬一某場網頁戰鬥沒正常釋放（例外/連線中斷），
// 超過 TTL 後自動失效，不會把玩家永久鎖死。
const webBattles = new Map(); // discordId -> { surface, startedAt, expiresAt }

const HARD_TTL_MS = 120 * 1000; // 一場網頁戰鬥（含動畫）最長保護時間，保守抓 120s

function _live(id) {
  const e = webBattles.get(id);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    webBattles.delete(id);
    return null;
  }
  return e;
}

// 是否有進行中的網頁戰鬥（給 DC 端反查互斥用）
function isWebBattleActive(discordId) {
  return Boolean(_live(String(discordId || "")));
}

function getWebBattle(discordId) {
  return _live(String(discordId || ""));
}

// 嘗試登記一場網頁戰鬥。已在戰鬥中 → { ok:false, active }；成功 → { ok:true, hold, release }。
//   hold(ms): 戰鬥結算後把占用延續到動畫結束才自動失效（讓 DC 端在動畫期間仍視為忙碌）。
//   release(): 立即解除占用（例外 / 提早結束時用）。
function acquireWebBattle(discordId, surface = "web", ttlMs = HARD_TTL_MS) {
  const id = String(discordId || "");
  const busy = _live(id);
  if (busy) return { ok: false, active: busy };
  const entry = { surface, startedAt: Date.now(), expiresAt: Date.now() + ttlMs };
  webBattles.set(id, entry);
  let done = false;
  return {
    ok: true,
    active: entry,
    hold(ms) {
      if (webBattles.get(id) === entry) entry.expiresAt = Date.now() + Math.max(0, Number(ms) || 0);
    },
    release() {
      if (done) return;
      done = true;
      if (webBattles.get(id) === entry) webBattles.delete(id);
    },
  };
}

module.exports = {
  acquireWebBattle,
  isWebBattleActive,
  getWebBattle,
};
