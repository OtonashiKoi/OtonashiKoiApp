// 把卡片（怪物卡）效果翻成白話文，照怪物分區（zone）分組，輸出 Markdown 供人工編輯
// 卡片：itemType='equipment' 且 equipSlot='special'，zone 取自 monsterCardMeta.zone
// 用法：
//   node scripts/dump-card-effects.js                 -> 全部分區，輸出 docs/CARD_EFFECTS_EDIT.md
//   node scripts/dump-card-effects.js dragon_realm    -> 只輸出龍區，輸出 docs/CARD_EFFECTS_dragon_realm.md
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { ZONE_DEFS, ZONE_BY_KEY } = require("../src/shared/zones");

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/equipmentGame";
const dbName = process.env.MONGODB_DB_NAME || "equipmentGame";
const onlyZone = process.argv[2] || null;

const EFFECT_NAME = {
  atk_up: "攻擊力提升", atk_down: "攻擊力降低",
  def_up: "防禦提升", def_down: "防禦降低",
  agi_up: "敏捷提升", agi_down: "敏捷降低",
  hit_up: "命中提升", hit_down: "命中降低",
  dodge_up: "迴避提升", crit_rate_up: "爆擊率提升",
  crit_damage_up: "爆擊傷害提升",
  final_damage_up: "最終傷害提升", damage_reduction: "受到傷害降低",
  def_ignore: "無視防禦", def_break: "破防",
  lifesteal: "生命偷取", heal_over_time: "持續回復",
  counter: "反擊", invincible_short: "短暫無敵",
  poison: "中毒", burn: "燃燒", bleed: "流血",
  stun: "暈眩", silence: "沉默", charm: "魅惑",
  lightning: "雷擊", bonus_vs_poisoned: "對中毒目標加傷"
};
const effName = (k) => EFFECT_NAME[k] || k;

function durText(d) {
  if (!d) return "";
  if (d.mode === "turns") return `${d.value}回合`;
  if (d.mode === "permanent") return "永久";
  return `${d.value}${d.mode || ""}`;
}

function procLine(pe) {
  const who = pe.target === "enemy" ? "敵方" : pe.target === "self" ? "自身" : (pe.target || "");
  const p = pe.params || {};
  let val = "";
  if (p.value != null) val = `${p.value}${p.mode === "pct" ? "%" : ""}`;
  const dur = durText(p.duration);
  const cond = p.ownerHpBelowPct != null ? `（自身HP<${p.ownerHpBelowPct}%才生效）`
    : p.ownerHpAbovePct != null ? `（自身HP>${p.ownerHpAbovePct}%才生效）`
    : p.targetHpBelowPct != null ? `（敵方HP<${p.targetHpBelowPct}%才生效）`
    : "";
  const parts = [`${who} ${effName(pe.key)}`];
  if (val) parts.push(`數值 ${val}`);
  if (dur) parts.push(`持續 ${dur}`);
  return `    - ${parts.join("、")}${cond}　\`${pe.key}\``;
}

function renderCard(c, idx) {
  const s = c.monsterCardSkill || {};
  const out = [];
  out.push(`### ${idx}. ${c.name}　[${c.tier || "-"}]`);
  out.push(`- id：\`${c.id}\``);
  out.push(`- 來源怪物：${c.monsterCardMeta?.monsterName || c.monsterName || "—"}`);
  out.push(`- 技能名：${s.name || "（無）"}`);
  out.push(`- 發動機率：${s.chance != null ? s.chance + "%" : "—"}　冷卻：${s.cooldownTurns || 0}回合　觸發時機：${s.trigger || "—"}`);
  out.push(`- 現有描述：${s.description || "（無）"}`);
  const procs = Array.isArray(s.procEffects) ? s.procEffects : [];
  if (procs.length) {
    out.push("- 實際效果：");
    procs.forEach((pe) => out.push(procLine(pe)));
  }
  out.push("");
  return out.join("\n");
}

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  const cards = await db
    .collection("items")
    .find({ itemType: "equipment", equipSlot: "special" })
    .toArray();

  // 用 monsterCardOf 反查怪物「實際」zone（卡片自帶 meta.zone 多半過期，不可信）
  const monsters = await db.collection("monsters").find({}).toArray();
  const monById = new Map(monsters.map((m) => [m.id, m]));
  const liveZoneOf = (c) => {
    const m = c.monsterCardOf ? monById.get(c.monsterCardOf) : null;
    return (m && m.zone) || c.monsterCardMeta?.zone || "（未歸區）";
  };
  const liveLevelOf = (c) => {
    const m = c.monsterCardOf ? monById.get(c.monsterCardOf) : null;
    return (m && m.level) || c.monsterCardMeta?.level || 0;
  };

  // 依「怪物實際 zone」分組
  const byZone = new Map();
  for (const c of cards) {
    const z = liveZoneOf(c);
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push(c);
  }
  // 每區內依怪物等級、再依名稱排序
  for (const list of byZone.values()) {
    list.sort((a, b) =>
      liveLevelOf(a) - liveLevelOf(b) ||
      String(a.name).localeCompare(String(b.name), "zh-Hant"));
  }

  // zone 輸出順序：照 zones.js 的定義順序，未知區墊底
  const zoneOrder = [...ZONE_DEFS.map((z) => z.key), "（未歸區）"];
  const orderedZones = [...byZone.keys()].sort(
    (a, b) => zoneOrder.indexOf(a) - zoneOrder.indexOf(b));

  const targetZones = onlyZone ? orderedZones.filter((z) => z === onlyZone) : orderedZones;
  if (onlyZone && targetZones.length === 0) {
    console.log(`找不到分區 "${onlyZone}"。可用：${[...byZone.keys()].join(", ")}`);
    await client.close();
    return;
  }

  const out = [];
  const title = onlyZone
    ? `# 卡片效果白話清單 — ${ZONE_BY_KEY[onlyZone]?.label || onlyZone}（可編輯）`
    : "# 卡片效果白話清單（按怪物分區，可編輯）";
  out.push(title, "");
  out.push("> 直接在這份檔案上修改數字/文字，改完丟回給我，我再寫進資料庫。");
  out.push("> 每張卡的 `id` 不要動（那是寫回 DB 的依據）。", "");

  for (const z of targetZones) {
    const def = ZONE_BY_KEY[z];
    const heading = def ? `${def.emoji} ${def.label}（${z}，Lv${def.minLevel}-${def.maxLevel ?? "∞"}）` : z;
    const list = byZone.get(z);
    out.push(`## ${heading}　共 ${list.length} 張`, "");
    list.forEach((c, i) => out.push(renderCard(c, i + 1)));
  }

  const outFile = onlyZone
    ? path.join(__dirname, "..", "docs", `CARD_EFFECTS_${onlyZone}.md`)
    : path.join(__dirname, "..", "docs", "CARD_EFFECTS_EDIT.md");
  fs.writeFileSync(outFile, out.join("\n"), "utf8");
  console.log(`已輸出 ${cards.length} 張卡（${targetZones.length} 區）-> ${outFile}`);
  for (const z of targetZones) console.log(`  ${z}: ${byZone.get(z).length} 張`);

  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
