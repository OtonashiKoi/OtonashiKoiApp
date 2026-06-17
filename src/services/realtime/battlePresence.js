"use strict";
/**
 * 戰鬥區域存在感:追蹤每位玩家「最近在哪個區域戰鬥」。
 * - 每次戰鬥(網頁或 DC)touch 一次,記錄該玩家當下所在區域 + 時間。
 * - 玩家只屬於「最近一次戰鬥」的區域:跑去別區戰鬥,就會從舊區的氣泡消失。
 * - 超過 windowMs(預設 3 分鐘)沒在該區戰鬥,也會消失。
 * 這讓戰鬥畫面的玩家氣泡比「當前怪物傷害名單」更持久、看起來更多人。
 */

const players = new Map(); // discordId -> { discordId, name, level, zone, hasAura, auraLines, hits, lastAt }
const MAX = 5000;
const DMG_WINDOW_MS = 10 * 60 * 1000; // 10 分鐘傷害統計窗口

function touch(discordId, { name, level, zone, hasAura, auraLines, damage } = {}) {
  const id = String(discordId || "").trim();
  if (!id || !zone) return;
  const now = Date.now();
  const z = String(zone);
  const cur = players.get(id);
  // 換區就重置傷害累計;同區則沿用(再剔除超過 10 分鐘的)
  let hits = (cur && cur.zone === z && Array.isArray(cur.hits)) ? cur.hits : [];
  const dmg = Math.max(0, Number(damage) || 0);
  if (dmg > 0) hits = [...hits, { amount: dmg, at: now }];
  const cutoff = now - DMG_WINDOW_MS;
  hits = hits.filter((h) => h.at >= cutoff);
  players.set(id, {
    discordId: id,
    name: name || id,
    level: Number(level) || 1,
    zone: z,
    hasAura: !!hasAura,
    auraLines: Array.isArray(auraLines) ? auraLines : [],
    hits,
    lastAt: now
  });
  if (players.size > MAX) {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of players) if (v.lastAt < cutoff) players.delete(k);
  }
}

/** 某區域目前在線戰鬥的玩家(最近 windowMs 內、且最後一戰在此區),依最近活動排序 */
function listByZone(zone, windowMs = 3 * 60 * 1000, limit = 20) {
  const z = String(zone || "");
  const now = Date.now();
  const cutoff = now - DMG_WINDOW_MS;
  const out = [];
  for (const v of players.values()) {
    if (v.zone === z && now - v.lastAt < windowMs) {
      const damage10m = (Array.isArray(v.hits) ? v.hits : [])
        .filter((h) => h.at >= cutoff)
        .reduce((s, h) => s + (Number(h.amount) || 0), 0);
      out.push({ ...v, damage10m });
    }
  }
  out.sort((a, b) => b.lastAt - a.lastAt);
  return out.slice(0, limit);
}

module.exports = { touch, listByZone };
