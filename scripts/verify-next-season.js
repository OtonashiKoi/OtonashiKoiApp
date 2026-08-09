"use strict";
/**
 * 下季改版・全功能驗收。
 * 把這輪做的每一項都實際跑一次，而不是看程式碼推論。
 *
 * 用法：node scripts/verify-next-season.js
 */

require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const pass = [], fail = [], warn = [];
const ok = (name, detail = "") => pass.push(`${name}${detail ? "　" + detail : ""}`);
const no = (name, detail = "") => fail.push(`${name}${detail ? "　" + detail : ""}`);
const wr = (name, detail = "") => warn.push(`${name}${detail ? "　" + detail : ""}`);

(async () => {
  const db = await getMongoDb();
  const I = db.collection("items");
  const M = db.collection("monsters");

  console.log("═══ 下季改版・全功能驗收 ═══\n");

  // ── 1. 屬性石 ──────────────────────────
  console.log("【1】屬性石");
  const { ELEMENT_STONE_RATE_BY_TIER, getElementStoneRate } = require("../src/services/shop/shopService");
  const rates = ["D", "C", "B", "A", "S"].map((t) => `${t}${Math.round(getElementStoneRate(t) * 100)}%`).join(" ");
  (getElementStoneRate("D") === 0.25 && getElementStoneRate("S") === 0.85)
    ? ok("分解機率依階級", rates) : no("分解機率依階級", rates);

  const es = require("../src/shared/elementSystem");
  es.ELEMENT_SOCKET_SLOTS.includes("armor") && es.ELEMENT_SOCKET_SLOTS.includes("weapon")
    ? ok("防具屬性洞解禁", `可鑲 ${es.ELEMENT_SOCKET_SLOTS.length} 槽`) : no("防具屬性洞解禁");

  const { rollElementForEntry } = require("../src/shared/elementDropRoll");
  const t1 = { itemType: "equipment", equipSlot: "armor" };
  rollElementForEntry(t1, { override: { element: "water", chancePct: 100, minLevel: 2, maxLevel: 2 } });
  const t2 = { itemType: "equipment", equipSlot: "armor" };
  rollElementForEntry(t2, { element: "fire", maxLevel: 3, chancePct: 100, zone: "hellfire" });
  (t1.element === "water" && !t2.element)
    ? ok("限定裝 override 附屬性／非活動區不附") : no("限定裝 override", JSON.stringify({ t1: t1.element, t2: t2.element }));

  const stones = await I.countDocuments({ id: /^element-stone-/ });
  stones === 7 ? ok("屬性石道具", "7 種") : no("屬性石道具", `${stones} 種`);

  // ── 2. 夏日活動 ────────────────────────
  console.log("【2】夏日活動");
  const ev1 = await M.countDocuments({ zone: "event_1", enabled: true });
  const evBoss = await M.findOne({ id: "event-island-turtle" });
  ev1 === 7 ? ok("活動區小怪", "7/7 開啟") : no("活動區小怪", `${ev1}/7`);
  evBoss?.enabled ? ok("島島龜王", `開啟｜HP ${evBoss.maxHp.toLocaleString()}｜掉落 ${(evBoss.drops || []).length} 項`) : no("島島龜王未開啟");

  const beach = await I.countDocuments({ _eventBeach: true });
  const beachA = await I.countDocuments({ _eventBeach: true, tier: "A" });
  const beachS = await I.countDocuments({ _eventBeach: true, tier: "S" });
  beach === 20 ? ok("海灘限定裝", `${beach} 件（A${beachA} S${beachS}）`) : no("海灘限定裝", `${beach} 件`);

  const withEl = await I.countDocuments({ _eventBeach: true, "elementDrop.chancePct": 100 });
  withEl === 20 ? ok("限定裝自帶屬性", "20/20 必中") : no("限定裝自帶屬性", `${withEl}/20`);

  const { bossKeyForZone } = require("../src/services/worldBoss/worldBossService");
  bossKeyForZone("event_boss") === "island_turtle" ? ok("龜王 zone 註冊") : no("龜王 zone 註冊");
  const wbCfg = await db.collection("worldBossConfig").findOne({ _id: "island_turtle" });
  wbCfg?.value?.phaseConfig?.length === 3
    ? ok("龜王設定檔格式", `三階段｜${wbCfg.value.battleTimeLimitMinutes}分時限`) : no("龜王設定檔格式");

  const mzh = require("../src/bot/handlers/monsterZoneHandlers");
  mzh.getWorldBossPartKeys("event_boss").length === 4 ? ok("龜王四部位") : no("龜王四部位");
  const chest = await I.findOne({ id: "chest-island-turtle" });
  chest?.effect?.monsterId === "event-island-turtle" ? ok("島島寶箱接線") : no("島島寶箱接線");

  // ── 3. 徽章 JOB 化 ─────────────────────
  console.log("【3】徽章 JOB 化");
  const J = require("../src/shared/jobBadgeLevel");
  J.totalExpForLevel(20) === 228 ? ok("升級曲線", "練滿 228 場") : no("升級曲線", `${J.totalExpForLevel(20)} 場`);
  const sc = [1, 10, 20].map((l) => `Lv${l}=${J.statScaleForLevel(l) * 100}%`).join(" ");
  (J.statScaleForLevel(1) === 0.5 && J.statScaleForLevel(20) === 1.5)
    ? ok("屬性縮放（Lv20 超越）", sc) : no("屬性縮放", sc);

  const swBadge = await I.findOne({ id: "job_swordsman_v1" });
  const s1 = J.effectiveStatsForEntry({ ...swBadge, itemType: "job_badge", jobExp: 0 });
  const s20 = J.effectiveStatsForEntry({ ...swBadge, itemType: "job_badge", jobExp: J.totalExpForLevel(20) });
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  sum(s20) > sum(swBadge.equipStats) && sum(s1) < sum(swBadge.equipStats)
    ? ok("徽章屬性實際縮放", `Lv1 ${sum(s1)} → 帳面 ${sum(swBadge.equipStats)} → Lv20 ${sum(s20)}`)
    : no("徽章屬性縮放", `${sum(s1)}/${sum(s20)}`);

  // 效果不該被縮（用矮人戰士徽章：它有無條件的 proc_stun 與帶 mace 條件的效果，這裡配對應武器）
  const { collectEquipmentEffects } = require("../src/shared/effectEngine");
  const dw = await I.findOne({ id: "job_dwarf_warrior_v1" });
  const mace = await I.findOne({ weaponType: "mace_2h", tier: "A", itemType: "equipment" });
  const mkEq = (exp) => ({
    job_eq: { ...dw, itemType: "job_badge", equipSlot: "job_eq", jobExp: exp },
    weapon: { ...mace, itemId: mace.id },
  });
  const pick = (eq) => {
    const list = collectEquipmentEffects(eq, null, { equipped: eq }).filter((e) => e.srcItem === dw.name && e.params?.value != null);
    return list.map((e) => `${e.key}=${e.params.value}`).sort().join(",");
  };
  const fxLv1 = pick(mkEq(0));
  const fxLv20 = pick(mkEq(J.totalExpForLevel(20)));
  (fxLv1 && fxLv1 === fxLv20)
    ? ok("效果不隨等級縮放", `Lv1 與 Lv20 皆 ${fxLv1}`)
    : no("效果被誤縮", `Lv1[${fxLv1}] vs Lv20[${fxLv20}]`);

  const sctx = require("../src/services/createServiceContext");
  typeof require("../src/services/job/jobBadgeService").JobBadgeService === "function"
    ? ok("熟練度 service") : no("熟練度 service");
  // 2026-08-04：練滿 Lv20 不再廣播（只解鎖任務）；轉職成功才廣播
  typeof mzh._announceJobBadgeMastery === "undefined" ? ok("Lv20 不廣播（已移除）") : no("Lv20 廣播函式應已移除");

  // ── 4. 轉職 ────────────────────────────
  console.log("【4】轉職");
  const ja = require("../src/shared/jobAdvancement");
  ja.T2_MAX_OWNED === Infinity ? ok("持有數上限已取消") : no("持有數上限", String(ja.T2_MAX_OWNED));
  const costs = [0, 1, 2, 5].map((n) => ja.transferCostFor(n) / 10000 + "萬").join(" / ");
  ja.transferCostFor(0) === 250000 && ja.transferCostFor(5) === 3000000
    ? ok("轉職費用階梯", costs) : no("轉職費用階梯", costs);

  const storySvc = require("../src/services/story/storyService");
  typeof storySvc.StoryService.prototype.transferJobAtNode === "function"
    ? ok("轉職節點方法") : no("轉職節點方法");
  const adminJs = require("fs").readFileSync(require("path").join(__dirname, "..", "src/web/public/admin.story.js"), "utf8");
  adminJs.includes('"transfer"') && adminJs.includes("t2BadgeId")
    ? ok("後台轉職節點編輯器") : no("後台轉職節點編輯器");

  // ── 5. 平衡 ────────────────────────────
  console.log("【5】平衡");
  const badges = await I.find({ itemType: "job_badge" }).toArray();
  const allFx = (b) => [...(b.passiveEffects || []), ...(b.procEffects || []), ...(b.combatEffects || [])];
  const atkMul = badges.filter((b) => allFx(b).some((e) => e.key === "atk_multiplier_up"));
  atkMul.length === 0 ? ok("徽章攻擊乘數已全移除", `${badges.length} 個徽章`) : no("仍有攻擊乘數", atkMul.map((b) => b.name).join(","));

  const dot = badges.filter((b) => ["job_rogue_v1", "job_mage_v1"].includes(b.id))
    .filter((b) => allFx(b).some((e) => /^(proc_)?(poison|burn)$/.test(e.key)));
  dot.length === 0 ? ok("一轉毒/燃燒已移除") : no("仍有毒/燃燒", dot.map((b) => b.name).join(","));

  const tac = badges.find((b) => b.id === "job_tactician_v1");
  allFx(tac).every((e) => !e.condition) ? ok("軍師解綁武器") : no("軍師仍綁武器");
  const tacQ = await db.collection("weeklyQuests").findOne({ title: "軍師試煉" });
  (tacQ?.type === "battle_count" && !tacQ.unlockAttribute) ? ok("軍師試煉只看等級") : no("軍師試煉門檻");

  const berserker = badges.find((b) => b.id === "job_berserker_t2_v1");
  const dwarflord = badges.find((b) => b.id === "job_dwarflord_t2_v1");
  allFx(berserker).some((e) => e.key === "final_damage_up") ? ok("狂戰士漏建已補") : no("狂戰士仍缺 final_damage_up");
  allFx(dwarflord).some((e) => e.key === "stun_chance_up") ? ok("矮人戰士長漏建已補") : no("矮人戰士長仍缺 stun_chance_up");

  const csSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "src/shared/combatStats.js"), "utf8");
  // 匕首 mult 3→2→3：2026-08-07 使用者定案改回 3（理由見 combatStats.js 該行註解——
  // B37 影舞者下修疊上 mult 2 會把匕首系砍到頂輸出的 50%，矯枉過正）。comboBonus 維持 10。
  /dagger:\s*\{\s*mult:\s*3[^}]*comboBonus:\s*10/.test(csSrc) ? ok("匕首 mult3／comboBonus10") : no("匕首數值");
  // 斧＝命中低（附錄A 唯一定案列）：破防已整個移除，只剩重擊與揮空
  /axe_1h:\s*\{[^}]*hitPenalty:\s*10/.test(csSrc) && !/axe_1h:\s*\{[^}]*armorBreak/.test(csSrc)
    ? ok("單手斧 命中−10／破防已移除") : no("單手斧數值");
  /axe_2h:\s*\{[^}]*hitPenalty:\s*20/.test(csSrc) && !/axe_2h:\s*\{[^}]*armorBreak/.test(csSrc)
    ? ok("雙手斧 命中−20／破防已移除") : no("雙手斧數值");
  /combo:\s*Math\.min\(100,/.test(csSrc) ? ok("連擊全職業封頂 100%") : no("連擊上限");

  // 單屬性裝備
  const eqAll = await I.find({ itemType: "equipment", equipSlot: { $nin: ["weapon", "anchor", "title_eq", "job_eq", "special"] } }).toArray();
  const single = eqAll.filter((it) => {
    if (it.monsterCardOf || it.monsterCardSkill) return false;
    const st = Object.entries(it.equipStats || {}).filter(([, v]) => Number(v) > 0);
    return st.length === 1 && Number(st[0][1]) > 1;
  });
  single.length === 0 ? ok("單屬性裝備已轉多屬性", `檢查 ${eqAll.length} 件`) : no("仍有單屬性", single.map((x) => x.name).slice(0, 5).join(","));

  const acc = await I.countDocuments({ itemType: "equipment", equipSlot: { $in: ["accessory_l", "accessory_r"] } });
  acc >= 90 ? ok("飾品已還原", `${acc} 件`) : wr("飾品數量偏低", `${acc} 件`);

  // ── 5b. 吸血與錨點 ─────────────────────
  console.log("【5b】吸血與錨點");
  const clSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "src/shared/combatLoop.js"), "utf8");
  /LIFESTEAL_CAP_PCT = 25/.test(clSrc) ? ok("吸血總量上限 25%") : no("吸血上限");
  /_settleLifestealForRound\(\)/.test(clSrc) ? ok("吸血改每回合結算一次") : no("吸血每回合結算");
  const bes = require("../src/shared/bestiary");
  bes.MAX_BONUS_PCT === 15 ? ok("怪物圖鑑增傷", "15%") : no("怪物圖鑑增傷", `${bes.MAX_BONUS_PCT}%`);

  const anchors = await I.find({ equipSlot: "anchor" }).toArray();
  anchors.length === 9 ? ok("錨點數量", "9 件（鏡裝/逆鱗已移除）") : wr("錨點數量", `${anchors.length} 件`);
  const endure = anchors.find((a) => a.id === "s-legend-endure");
  endure && (endure.passiveEffects || []).some((e) => e.key === "endure_burst" && e.params?.everyRounds === 3)
    ? ok("沒苦硬吃", "每 3 回合反彈") : no("沒苦硬吃效果");
  const thirst = anchors.find((a) => a.id === "s-legend-thirst");
  (thirst?.passiveEffects || []).some((e) => e.key === "lifesteal" && e.params?.value === 15)
    ? ok("對鮮血的渴望", "吸血 15%") : no("對鮮血吸血值");
  const ls = await I.find({ $or: [{ "passiveEffects.key": "lifesteal" }, { "combatEffects.key": "lifesteal" }] }).toArray();
  const over = ls.filter((it) => [...(it.passiveEffects || []), ...(it.combatEffects || [])]
    .some((e) => e.key === "lifesteal" && Number(e.params?.value) > 15));
  over.length === 0 ? ok("單件吸血上限", "無超過 15% 的來源") : no("仍有高吸血", over.map((x) => x.name).join(","));

  const hidden = await db.collection("weeklyQuests").find({ rewardItemId: /^s-legend-/ }).toArray();
  const badHidden = hidden.filter((q) => {
    if (Number(q.unlockCheckinStreak) > 0) return Number(q.unlockCheckinStreak) !== Number(q.target);
    return Number(q.unlockProgressAtLeast) !== Number(q.target);
  });
  badHidden.length === 0 ? ok("隱藏任務", `${hidden.length} 個都是「解完才出現、出現即可領」`)
    : no("隱藏任務門檻不一致", badHidden.map((q) => q.title).join(","));

  const casino = require("fs").readFileSync(require("path").join(__dirname, "..", "src/services/casino/casinoService.js"), "utf8");
  /DICE_JACKPOT_CHANCE = 0\.03/.test(casino) ? ok("命運之輪轉盤", "3%") : no("轉盤機率");

  // ── 6. 外幣斗內 ────────────────────────
  console.log("【6】外幣斗內");
  const shSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "src/bot/handlers/streamHandlers.js"), "utf8");
  /JPY|日幣|÷\s*5|\/\s*5/.test(shSrc) && /RATE|rate/i.test(shSrc)
    ? ok("外幣換算已接") : wr("外幣換算", "需人工確認 streamHandlers 的換算邏輯");

  // ── 7. 劇情 ────────────────────────────
  console.log("【7】劇情");
  const npc = await db.collection("storyNpcs").countDocuments({ id: /^npc-master-/ });
  const mst = await M.countDocuments({ _jobMaster: { $exists: true } });
  npc === 11 ? ok("引路人 NPC", "11 位") : no("引路人 NPC", `${npc} 位`);
  mst === 11 ? ok("試煉對手", "11 隻（enabled:false）") : no("試煉對手", `${mst} 隻`);
  const summer = await db.collection("storyChapters").findOne({ zoneKey: "event_1" });
  summer && !summer.enabled && !(summer.nodes || []).some((n) => n.type === "battle")
    ? ok("夏日劇情", "已去戰鬥、未開放") : wr("夏日劇情狀態");

  // ── 總結 ───────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log(`✅ 通過 ${pass.length}　❌ 失敗 ${fail.length}　⚠️ 注意 ${warn.length}\n`);
  pass.forEach((p) => console.log("  ✅ " + p));
  if (warn.length) { console.log(); warn.forEach((w) => console.log("  ⚠️ " + w)); }
  if (fail.length) { console.log(); fail.forEach((f) => console.log("  ❌ " + f)); }
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error("驗收腳本失敗：", e); process.exit(1); });
