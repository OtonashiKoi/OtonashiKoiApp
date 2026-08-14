"use strict";
/**
 * 卡片圖鑑收集（怪物卡 依區域分組 + 主線 NPC 卡專區）。
 * - 登錄鍵：卡片 itemId，曾擁有就永久登錄（存 progress.cardDex = { [itemId]: ISO 時間 }）。
 * - 收集判定 Dex 式：賣掉/交易掉不掉進度。以「當前背包中的卡片」lazy-sync 補登。
 * - 獎勵（progress.cardDexClaims 記已領；⚠️ 不發鑽石）：
 *     單區集滿 → 金幣(該區卡數 × ZONE_GOLD_PER_CARD)
 *     總進度里程碑 → 金幣＋道具(卡包/藥水/背包擴充券)，全集另給稱號
 *     NPC 卡全集 → 稱號＋金幣＋藥水
 * 需搭配 itemRepository（讀卡片定義）與 monsters（補區域）。
 */
const zones = require("./zones");
const ZONE_DEFS = zones.ZONE_DEFS || {};
const ZONE_ORDER = zones.ALL_ZONE_KEYS || Object.keys(ZONE_DEFS);

// ⚠️ 鑽石 = 硬付費貨幣（儲值 NT$100 = 1 鑽）→ 收集獎勵「完全不發鑽石」，
//    改以 金幣 / 消耗品(卡包・屬性重製・附魔重骰・背包擴充券) / 稱號 為主。
const ITEM = {
  pack:         { itemId: "chest-anchor-pack", name: "記憶錨定卡包" },
  resetAttr:    { itemId: "87b281be-b175-40a0-8044-0accc88a0ee0", name: "屬性重製藥水" },
  resetEnchant: { itemId: "enchant_reroll_potion", name: "附魔重骰藥水" },
  bagExpand:    { itemId: "ticket-bag-expand", name: "背包擴充券（消耗品·本季+20格）" },
};
const ZONE_GOLD_PER_CARD = 1000; // 單區集滿：該區卡數 × 1,000 金幣（2026-08-07 上調，原 600）

// 總進度里程碑（達到收集張數解鎖，一次性領取；每階金幣＋道具都給）
const MILESTONES = [
  { key: "m10", n: 10, gold: 8000, label: "收集 10 張" },
  { key: "m20", n: 20, gold: 8000, items: [{ ...ITEM.bagExpand, qty: 1 }], label: "收集 20 張" },
  { key: "m25", n: 25, gold: 10000, items: [{ ...ITEM.pack, qty: 1 }], label: "收集 25 張" },
  { key: "m40", n: 40, gold: 15000, items: [{ ...ITEM.resetAttr, qty: 1 }, { ...ITEM.bagExpand, qty: 1 }], label: "收集 40 張" },
  { key: "m60", n: 60, gold: 20000, items: [{ ...ITEM.resetEnchant, qty: 3 }, { ...ITEM.pack, qty: 2 }], label: "收集 60 張" },
  { key: "m70", n: 70, gold: 25000, items: [{ ...ITEM.resetAttr, qty: 1 }, { ...ITEM.resetEnchant, qty: 2 }], label: "收集 70 張" },
];
// 全圖鑑集滿：終極成就 → 金幣 + 稱號 + 背包擴充券 ×2 + 卡包 ×3
const COMPLETE_ALL = { key: "all", gold: 50000, title: "title-carddex-master", items: [{ ...ITEM.bagExpand, qty: 2 }, { ...ITEM.pack, qty: 3 }], label: "圖鑑全集" };
// NPC 卡全集 → 稱號 + 金幣 + 屬性重製 + 附魔重骰
const NPC_SET = { key: "npc", gold: 10000, title: "title-memory-collector", items: [{ ...ITEM.resetAttr, qty: 1 }, { ...ITEM.resetEnchant, qty: 3 }], label: "主線 NPC 全集" };

function zoneLabel(key) {
  const d = ZONE_DEFS[key] || (zones.ZONE_BY_KEY && zones.ZONE_BY_KEY[key]) || {};
  return d.name || d.label || d.displayName || key;
}

let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 5 * 60 * 1000;

/** 建立卡片登錄表（依區域分組 + NPC 專區）。快取 5 分鐘。 */
async function getCardRegistry(db, { force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && (now - _cacheAt) < CACHE_MS) return _cache;

  const items = db.collection("items");
  const monsters = db.collection("monsters");
  const cards = (await items.find({
    $or: [{ equipSlot: "special" }, { monsterCardOf: { $exists: true } }, { isNpcCard: true }],
  }).toArray()).filter((card) => card?.bestiaryVisible !== false);
  const mAll = await monsters.find({}).project({ id: 1, zone: 1, name: 1 }).toArray();
  const zoneById = {}, zoneByName = {};
  for (const m of mAll) { zoneById[m.id] = m.zone; zoneByName[m.name] = m.zone; }

  const STAT_LABEL = { str: "力量", agi: "敏捷", vit: "體質", int: "智力", dex: "靈巧", luk: "幸運" };
  const view = (c) => {
    const stats = c.equipStats && typeof c.equipStats === "object"
      ? Object.entries(c.equipStats).filter(([, v]) => Number(v)).map(([k, v]) => ({ key: k, label: STAT_LABEL[k] || k.toUpperCase(), value: Number(v) }))
      : [];
    const skill = c.monsterCardSkill
      ? { name: c.monsterCardSkill.name || null, description: c.monsterCardSkill.description || null, chance: c.monsterCardSkill.chance || null, cooldownTurns: c.monsterCardSkill.cooldownTurns || 0 }
      : null;
    return {
      id: c.id, name: c.name, tier: c.tier || null,
      imageUrl: c.imageUrl || c.imageThumbnailUrl || null,
      description: c.description || null,
      stats, skill,
    };
  };
  const byId = {};
  const npcCards = [];
  const zoneMap = {}; // zoneKey -> [cards]
  for (const c of cards) {
    byId[c.id] = c;
    if (c.isNpcCard) { npcCards.push(view(c)); continue; }
    // 以「來源怪物的現行區域」為準（monsterCardMeta.zone 是快照、怪物搬區後會過時，例如舊鍵 "hard"→已改 ancient_city）。
    // 依序：怪物 id → 怪物名 → 卡名去尾 → 才退回舊 meta.zone。
    const bare = String(c.name || "").replace(/[(（].*$/, "").replace(/卡$/, "");
    const z = zoneById[c.monsterCardOf]
      || (c.monsterCardMeta && zoneByName[c.monsterCardMeta.monsterName])
      || zoneByName[String(c.name || "").replace(/卡$/, "")]
      || zoneByName[bare]
      || (c.monsterCardMeta && c.monsterCardMeta.zone)
      || "未分類";
    (zoneMap[z] = zoneMap[z] || []).push(view(c));
  }

  // 依 zones 順序輸出，未知 zone 附在後面
  const orderedKeys = [...ZONE_ORDER.filter((k) => zoneMap[k]), ...Object.keys(zoneMap).filter((k) => !ZONE_ORDER.includes(k))];
  const groups = orderedKeys.map((k) => ({
    key: k,
    label: zoneLabel(k),
    cards: zoneMap[k].sort((a, b) => String(a.tier).localeCompare(String(b.tier)) || String(a.name).localeCompare(String(b.name))),
  }));
  const npcGroup = { key: "npc", label: "主線角色", cards: npcCards.sort((a, b) => String(a.name).localeCompare(String(b.name))) };
  const totalCards = groups.reduce((s, g) => s + g.cards.length, 0) + npcGroup.cards.length;

  _cache = { groups, npcGroup, totalCards, byId, generatedAt: new Date().toISOString() };
  _cacheAt = now;
  return _cache;
}

/** 由已登錄的 cardDex + registry 計算收集狀態、可領獎勵。 */
function computeCardDexState(cardDex, claims, registry) {
  const owned = (id) => Boolean(cardDex && cardDex[id]);
  const claimed = (key) => Boolean(claims && claims[key]);

  const zoneGroups = registry.groups.map((g) => {
    const collected = g.cards.filter((c) => owned(c.id)).length;
    const complete = collected === g.cards.length && g.cards.length > 0;
    const rewardGold = g.cards.length * ZONE_GOLD_PER_CARD;
    const claimKey = `zone:${g.key}`;
    return {
      key: g.key, label: g.label, total: g.cards.length, collected, complete,
      reward: { gold: rewardGold },
      claimKey, claimable: complete && !claimed(claimKey), claimed: claimed(claimKey),
      cards: g.cards.map((c) => ({ ...c, owned: owned(c.id) })),
    };
  });

  const npc = registry.npcGroup;
  const npcCollected = npc.cards.filter((c) => owned(c.id)).length;
  const npcComplete = npcCollected === npc.cards.length && npc.cards.length > 0;
  const npcSection = {
    key: "npc", label: npc.label, total: npc.cards.length, collected: npcCollected, complete: npcComplete,
    reward: { gold: NPC_SET.gold || 0, title: NPC_SET.title, items: NPC_SET.items },
    claimKey: `set:npc`, claimable: npcComplete && !claimed("set:npc"), claimed: claimed("set:npc"),
    cards: npc.cards.map((c) => ({ ...c, owned: owned(c.id) })),
  };

  const totalCollected = zoneGroups.reduce((s, g) => s + g.collected, 0) + npcCollected;
  const totalCards = registry.totalCards;

  const milestones = MILESTONES.map((m) => ({
    key: m.key, label: m.label, need: m.n, reached: totalCollected >= m.n,
    reward: { gold: m.gold || 0, items: m.items || [] },
    claimKey: `ms:${m.key}`, claimable: totalCollected >= m.n && !claimed(`ms:${m.key}`), claimed: claimed(`ms:${m.key}`),
  }));
  const allComplete = totalCollected >= totalCards && totalCards > 0;
  milestones.push({
    key: "all", label: COMPLETE_ALL.label, need: totalCards, reached: allComplete,
    reward: { gold: COMPLETE_ALL.gold || 0, title: COMPLETE_ALL.title, items: COMPLETE_ALL.items || [] },
    claimKey: `ms:all`, claimable: allComplete && !claimed("ms:all"), claimed: claimed("ms:all"),
  });

  return {
    totalCollected, totalCards, pct: totalCards ? Math.round((totalCollected / totalCards) * 100) : 0,
    zones: zoneGroups, npc: npcSection, milestones,
  };
}

/** 把背包中現有卡片補登進 cardDex（lazy-sync）。回傳是否有新增。 */
function syncCardDexFromInventory(progress, registry) {
  if (!progress) return false;
  if (!progress.cardDex || typeof progress.cardDex !== "object") progress.cardDex = {};
  const inv = Array.isArray(progress.inventory) ? progress.inventory : [];
  const equipped = progress.equipment && typeof progress.equipment === "object" ? Object.values(progress.equipment) : [];
  const now = new Date().toISOString();
  let changed = false;
  for (const entry of [...inv, ...equipped]) {
    const id = entry && entry.itemId;
    if (!id || !registry.byId[id]) continue;
    if (!progress.cardDex[id]) { progress.cardDex[id] = now; changed = true; }
  }
  return changed;
}

/** 解析一次領獎：回傳 { ok, reward:{diamond,packs,title}, claimKey } 或 { ok:false, reason }。 */
function resolveClaim(cardDex, claims, registry, claimKey) {
  const state = computeCardDexState(cardDex, claims, registry);
  const all = [...state.zones, state.npc, ...state.milestones];
  const target = all.find((x) => x.claimKey === claimKey);
  if (!target) return { ok: false, reason: "找不到獎勵項目" };
  if (target.claimed) return { ok: false, reason: "已領取" };
  if (!target.claimable) return { ok: false, reason: "尚未達成" };
  const reward = {
    gold: target.reward.gold || 0,
    items: Array.isArray(target.reward.items) ? target.reward.items : [],
    title: target.reward.title || null,
  };
  return { ok: true, reward, claimKey };
}

module.exports = {
  ITEM, ZONE_GOLD_PER_CARD, MILESTONES, COMPLETE_ALL, NPC_SET,
  getCardRegistry, computeCardDexState, syncCardDexFromInventory, resolveClaim,
};
