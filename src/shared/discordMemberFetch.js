// Discord 成員抓取的「超時保護」包裝。
// 問題：guild.members.fetch 遇到 Discord 限流(rate limit)時，discord.js 會「排隊等 retryAfter」
//       （可能長達數百秒），而 .catch 只擋錯誤、擋不了這種「卡住」→ 整個 HTTP 請求(登入/背包)
//       會一路卡到前端 15 秒 timeout。
// 解法：用 Promise.race 加一個短超時；超時就回 null（視為抓不到 → 降級成非會員/用快取），
//       請求立刻完成，不再被 Discord 限流拖垮。
async function fetchGuildMemberSafe(guild, userId, { force = false, timeoutMs = 2500 } = {}) {
  if (!guild || !userId) return null;
  let timer = null;
  try {
    const fetchP = guild.members.fetch({ user: userId, force }).catch(() => null);
    const timeoutP = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    return await Promise.race([fetchP, timeoutP]);
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { fetchGuildMemberSafe };
