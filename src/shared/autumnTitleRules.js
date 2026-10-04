"use strict";

const SEASON_KEY = "s20261001";
const COUNT_FROM = Date.parse("2026-10-04T13:00:00.000Z");
const TITLES = [
  { key: "traveler", name: "初楓旅人", type: "battle_win", target: 100 },
  { key: "veteran", name: "楓紅百戰", type: "battle_win", target: 3000, questId: "autumn-202610-season-battle_win" },
  { key: "attendance", name: "秋日常在", type: "autumn_checkin_days", target: 15 },
  { key: "forge", name: "紅葉煉成", type: "autumn_unique_a5", target: 3 },
  { key: "companions", name: "共登秋塔", type: "party_floor_clear", target: 100, questId: "autumn-202610-season-party_floor_clear", unlockLevel: 30 },
  { key: "summit", name: "高塔摘楓", type: "autumn_challenge_clear", target: 1, unlockLevel: 40 },
  { key: "maple", name: "楓紅漸漸", type: "autumn_title_count", target: 4 },
].map(t => ({ ...t, itemId: `title-autumn-202610-${t.key}`, questId: t.questId || `autumn-202610-season-title-${t.key}` }));

function isPublicSeasonOpen() {
  const maintenance = require("../services/access/maintenanceStore");
  return Date.now() >= COUNT_FROM && !maintenance.isActive() && !maintenance.getRawState().enabled;
}
function slotOf(p) { return String(Number(p?.activeCharacterSlot) || 1); }
function characterState(p, slot = slotOf(p)) {
  return p?.seasonKey === SEASON_KEY && p?.autumnTitleProgress?.seasonKey === SEASON_KEY
    ? p.autumnTitleProgress.slots?.[slot] || {} : {};
}
function currentFor(title, state) {
  if (title.key === "traveler" || title.key === "veteran") return Number(state.wins || 0);
  if (title.key === "companions") return Number(state.floors || 0);
  if (title.key === "attendance") return (state.days || []).length;
  if (title.key === "forge") return (state.enhancedUuids || []).length;
  if (title.key === "summit") return (state.challengeRuns || []).length;
  return TITLES.filter(t => t.key !== "maple" && state.claimed?.[t.key]).length;
}
function titleForQuest(q) { return TITLES.find(t => t.questId === q?.id && t.key === q?.autumnTitleKey); }
function view(q, p) {
  const t = titleForQuest(q);
  if (!t) return null;
  const s = characterState(p);
  return { current: Math.min(t.target, currentFor(t, s)), claimed: Boolean(s.claimed?.[t.key]) };
}

// Called only with server-produced events. The progress write also persists the deduplication data.
function recordEvent(p, event, publicOpen = isPublicSeasonOpen()) {
  if (!publicOpen || !event || p?.seasonKey !== SEASON_KEY || event.seasonKey && event.seasonKey !== SEASON_KEY) return false;
  const slot = String(event.slot || slotOf(p));
  if (slot !== slotOf(p)) throw new Error("人物已切換，稱號進度等待原人物恢復");
  if (event.eligible === false || event.at && Date.parse(event.at) < COUNT_FROM) return false;
  const root = p.autumnTitleProgress?.seasonKey === SEASON_KEY
    ? p.autumnTitleProgress : { seasonKey: SEASON_KEY, slots: {} };
  root.slots ||= {};
  const s = root.slots[slot] ||= {};
  if (event.id && (s.events || []).includes(event.id)) return false;
  const before = JSON.stringify(s);
  const amount = n => Number.isInteger(n) && n > 0 ? n : 0;
  if (event.type === "battle") {
    s.wins = Math.min(3000, Number(s.wins || 0) + amount(event.wins));
    s.floors = Math.min(100, Number(s.floors || 0) + amount(event.floors));
  } else if (event.type === "checkin" && Number.isFinite(Date.parse(event.at))) {
    const day = new Date(Date.parse(event.at) + 8 * 3600_000).toISOString().slice(0, 10);
    s.days = [...new Set([...(s.days || []), day])].slice(0, 15);
  } else if (event.type === "enhance" && event.tier === "A" && event.level === 5 && event.uuid) {
    s.enhancedUuids = [...new Set([...(s.enhancedUuids || []), event.uuid])].slice(0, 3);
  } else if (event.type === "challenge" && event.difficulty === "challenge" && event.floor === 50 && event.runId) {
    s.challengeRuns = [...new Set([...(s.challengeRuns || []), event.runId])].slice(0, 1);
  }
  if (before === JSON.stringify(s)) return false;
  if (event.id) s.events = [...(s.events || []), event.id];
  p.autumnTitleProgress = root;
  return true;
}

function idleBonuses(p) {
  return (p?.equipment?.title_eq?.itemId || p?.equipment?.title_eq?.id) === TITLES.at(-1).itemId
    ? { expPct: 3, goldPct: 2 } : { expPct: 0, goldPct: 0 };
}
module.exports = { SEASON_KEY, COUNT_FROM, TITLES, slotOf, characterState, currentFor, titleForQuest, view, recordEvent, isPublicSeasonOpen, idleBonuses };
