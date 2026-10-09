"use strict";
const { shouldBroadcastZoneActivity } = require("../../shared/zones");
const { isWorldBossZone } = require("../worldBoss/worldBossService");
const CHANNEL_ID = "1498608950671839263";

// Saved with admission CAS: failed/duplicate joins never claim an announcement.
// normalLive is reset by encounterKey when this boss respawns.
function claim(state, zone, monster, actorId, actorName, now) {
  if (!isWorldBossZone(zone) || !monster.isBoss || !shouldBroadcastZoneActivity(zone)
      || state.normalLive.worldBossStartAnnouncement) return null;
  const announcement = { monsterName: monster.name, starterId: actorId, starterName: actorName, at: now };
  state.normalLive.worldBossStartAnnouncement = announcement;
  return announcement;
}

async function deliver(sc, announcement, {
  client = require("../../bot/runtimeContext").getBotClient(),
  alarmRoleId = require("../../config").discord?.worldBossAlarmRoleId,
} = {}) {
  const { monsterName, starterName, starterId } = announcement;
  try { await sc._broadcastWorldBossStart?.(monsterName, starterName, starterId); }
  catch (error) { console.warn("[LiveWorldBossStart] web", error.message); }
  if (!client?.isReady?.()) return;
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel?.isTextBased?.()) throw new Error("World boss announcement channel unavailable");
  const alarmTag = alarmRoleId ? `\n<@&${alarmRoleId}> 世界王鬧鐘響囉！` : "";
  await channel.send({
    content: `⚔️ **世界BOSS 挑戰開始！**\n**${starterName || "有玩家"}** 率先向 **${monsterName}** 發起挑戰！\n前往期間限定活動加入戰鬥！${alarmTag}`,
    components: require("../../bot/announcementInteractions").hutaoNoticeComponents(monsterName),
    allowedMentions: alarmRoleId ? { roles: [alarmRoleId] } : { parse: [] },
  });
}
module.exports = { claim, deliver };
