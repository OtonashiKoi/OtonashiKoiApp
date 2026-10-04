"use strict";
const bard = require("../../shared/bardSong");
function issue(member, opensAt) {
  member.bardChallenge = bard.newChallenge(member.bardLevel || 0, opensAt);
  member.bardAvailableAt = opensAt;
  member.bardExpiresAt = opensAt + bard.TIME_LIMIT_MS;
}
function finish(member, input, time, expired = false) {
  const token = member.bardChallenge.token;
  const result = bard.scorePerformance(member.bardChallenge, expired ? null : input, member.bardStreak || 0);
  if (expired) result.note = null;
  member.strategy = { ...member.strategy, bardResult: result, bardPerformanceId: token };
  member.bardStreak = result.streak;
  member.bardLevel = result.perfect ? Math.max(member.bardLevel || 0, bard.levelFromStreak(result.streak)) : Math.max(0, (member.bardLevel || 0) - 1);
  const pause = result.perfect ? bard.TIME_LIMIT_MS : 400;
  member.bardFeedback = { success: result.perfect, expired, at: time, until: time + pause, sequence: [...member.bardChallenge.seq],
    message: expired ? "演奏失敗（逾時）" : result.perfect ? "完美演奏" : "演奏失敗" };
  issue(member, time + pause);
  return result;
}
function expire(room, time) {
  if (room.status !== "climbing" || room.terminal) return false;
  let changed = false;
  for (const member of room.members) {
    if (member.currentHp <= 0 || !member.bardChallenge) continue;
    if (!member.bardExpiresAt) { issue(member, time); changed = true; }
    else if (time >= member.bardExpiresAt) { finish(member, null, time, true); changed = true; }
  }
  return changed;
}
module.exports = { issue, finish, expire };
