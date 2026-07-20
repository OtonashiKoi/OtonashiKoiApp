#!/usr/bin/env node
"use strict";
// 逐場模擬：前段班能否 solo 打死牙狼(團體王 4,000,000 血，無單人版)。
// 含真實機制：流派倍率(同100%/異30%)、翻面(1/3翻、一生一次、本模擬不等復原＝保守)、
// 狂亂期(剩3~2部位王迴避+40)、最終核心(剩1部位玩家傷×0.7)。
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
const { MonsterService } = require("../src/services/monster/monsterService");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const mz = require("../src/bot/handlers/monsterZoneHandlers");
const { statBonusOf } = require("../src/shared/petDex");

const ZONE = "hellfire_depths";
const ENTRY_FEE = 15000;
const MAX_ROUNDS = 15;
const PARTS_MAX = { head: 800000, upper_body: 800000, lower_body: 800000, tail: 600000, legs: 1000000 };
const TOTAL_HP = Object.values(PARTS_MAX).reduce((a, b) => a + b, 0);
const FIGHT_CAP = 2000;
const TOP_N = 15;

function prettyName(dn, id) {
  const s = String(dn || "").trim();
  if (!s || s === String(id) || /^\d{15,}$/.test(s)) return id ? `玩家#${String(id).slice(-4)}` : "玩家";
  return s;
}
const NOW = 1000000000000; // 固定 now：翻面 flipUntil 皆未來→本模擬不復原(保守估)

(async () => {
  const repos = createMongoRepositories();
  const db = await getMongoDb();
  const players = await db.collection("players").find({}).toArray();
  const monsterSvc = new MonsterService(repos.monsterRepository, repos.itemRepository);
  const boss = await monsterSvc.getMonster ? await monsterSvc.getMonster(ZONE, { isBoss: true }).catch(() => null) : null;
  // getMonster 介面不定，改用 listMonsters 取 boss
  const list = await monsterSvc.listMonsters({ zone: ZONE, includeDisabled: false });
  const bossMon = list.find((m) => m.isBoss) || boss;
  const bossCalc = bossMon.calc;
  const monsterEquipped = (typeof mz.buildMonsterEquipped === "function") ? mz.buildMonsterEquipped(bossMon) : {};

  // 一場：玩家打某部位，回傳(本場對該部位造成的傷害, 承傷)
  function simFight(pStats, part, state) {
    const dm = mz.hellfangDamageMult(state, part, pStats.weaponType, NOW); // {mult}
    const phase = mz.hellfangBossPhaseMods(state); // {dodgeBonus,dmgMult}
    const bossAdj = { ...bossCalc, dodge: Math.min(95, (Number(bossCalc.dodge) || 0) + phase.dodgeBonus), finalDamageMultiplier: (Number(bossCalc.finalDamageMultiplier) || 1) * phase.dmgMult };
    let bp = pStats, bm = bossAdj, bmEq = monsterEquipped;
    try { bp = mz.applyWorldBossTargetToPlayerStats(pStats, part, ZONE).stats || pStats; } catch (_) {}
    try { const a = mz.applyWorldBossTargetToMonster(bossAdj, monsterEquipped, part, ZONE); bm = a.monsterStats || bossAdj; bmEq = a.monsterEquipped || monsterEquipped; } catch (_) {}
    const partHp = Math.max(1, state.worldBossPartsHp[part]);
    const r = runCombatLoop(bp, bm, bossMon.name, partHp, MAX_ROUNDS, { monsterEquipped: bmEq, monsterIsBoss: true, isWorldBoss: true, zone: ZONE, bossVulnMult: dm.mult });
    return { dmg: Math.min(partHp, Math.max(0, Number(r.totalDamage) || 0)), taken: Math.max(0, (pStats.maxHp || 0) - (Number(r.finalPlayerHp) || 0)) };
  }

  // 一位玩家 solo 打死牙狼：貪心選「當下倍率最高、血最少」的存活部位
  function soloKill(pStats) {
    const state = {
      worldBossPartsHp: { ...PARTS_MAX }, worldBossPartsMaxHp: { ...PARTS_MAX },
      hellfangDmgPhys: {}, hellfangDmgMagic: {}, hellfangFlipUntil: {}, hellfangFlipWeak: {}, hellfangFlipped: {},
    };
    let fights = 0, maxTaken = 0;
    const alive = () => Object.keys(state.worldBossPartsHp).filter((k) => state.worldBossPartsHp[k] > 0);
    while (alive().length > 0 && fights < FIGHT_CAP) {
      // 選部位：倍率高優先，其次血少
      const cand = alive().map((k) => ({ k, mult: mz.hellfangDamageMult(state, k, pStats.weaponType, NOW).mult, hp: state.worldBossPartsHp[k] }));
      cand.sort((a, b) => b.mult - a.mult || a.hp - b.hp);
      const part = cand[0].k;
      const res = simFight(pStats, part, state);
      maxTaken = Math.max(maxTaken, res.taken);
      state.worldBossPartsHp[part] = Math.max(0, state.worldBossPartsHp[part] - res.dmg);
      try { mz.hellfangPartAccrue(state, part, PARTS_MAX[part], mz.hellfangPlayerSchool(pStats.weaponType), res.dmg, NOW); } catch (_) {}
      fights++;
      if (res.dmg <= 0) break; // 完全打不動→跳出避免死迴圈
    }
    return { fights: alive().length === 0 ? fights : Infinity, maxTaken, cleared: alive().length === 0 };
  }

  const rows = [];
  for (const p of players) {
    if (p.status === "disabled") continue;
    const id = p.discordId;
    let progress;
    try { progress = await repos.progressRepository.findByPlayerId(id); } catch (_) { continue; }
    if (!progress || (progress.level || 1) < 30) continue; // 牙狼是S區,取 Lv30+
    const attrs = progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    let pStats;
    try { pStats = calcPlayerStats(attrs, progress.equipment || {}, progress.activeEffects || [], progress.inventory || [], { pkRating: progress.pkRating, zone: ZONE, petStat: statBonusOf(progress.petDex) }); } catch (_) { continue; }
    const school = mz.hellfangPlayerSchool(pStats.weaponType);
    const r = soloKill(pStats);
    if (!Number.isFinite(r.fights)) continue;
    rows.push({
      name: prettyName(p.displayName, id), level: progress.level || 1,
      job: progress.equipment?.job_eq?.itemName || "-", school: school === "magic" ? "法" : "物",
      wpn: pStats.weaponType || "-", fights: r.fights, goldCost: r.fights * ENTRY_FEE, maxTaken: r.maxTaken,
      survive: r.maxTaken < (pStats.maxHp || 1)
    });
  }

  rows.sort((a, b) => a.fights - b.fights);
  const top = rows.slice(0, TOP_N);
  console.log(`\n=== 牙狼 solo 戰力規劃表 (團體王 ${TOTAL_HP.toLocaleString()} 血 5部位3物2法, 入場費 ${ENTRY_FEE}, 每場 ${MAX_ROUNDS} 回合) ===`);
  console.log(`※ 無單人版牙狼；含流派30%/翻面/狂亂閃避/最終核心×0.7；模擬不等翻面復原(保守估)\n`);
  console.log(`共 ${rows.length} 位 Lv30+ 能清場玩家，最強前 ${top.length} 名(依需場數):\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const padS = (s, n) => String(s).padStart(n);
  console.log(pad("#", 3) + pad("玩家", 15) + padS("Lv", 3) + " " + pad("職業", 9) + pad("流派", 4) + padS("solo場數", 10) + padS("入場費合計", 12) + " 存活");
  top.forEach((r, i) => console.log(pad(i + 1, 3) + pad(r.name, 15) + padS(r.level, 3) + " " + pad(r.job, 9) + pad(r.school, 4) + padS(r.fights + "場", 10) + padS(r.goldCost.toLocaleString(), 12) + " " + (r.survive ? "✅" : "⚠️")));
  const b = (lo, hi) => rows.filter(r => r.fights > lo && r.fights <= hi).length;
  console.log(`\n分層(需場數)：≤30 ${rows.filter(r => r.fights <= 30).length} | 31~60 ${b(30, 60)} | 61~120 ${b(60, 120)} | 121~250 ${b(120, 250)} | >250 ${rows.filter(r => r.fights > 250).length}`);
  if (top[0]) console.log(`\n最強玩家 ${top[0].name}: solo 需 ${top[0].fights} 場 = ${top[0].goldCost.toLocaleString()} 金幣入場費`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
