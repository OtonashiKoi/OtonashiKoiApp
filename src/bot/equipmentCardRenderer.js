// 裝備欄角色卡圖片生成器（sharp + SVG）
"use strict";

const sharp = require("sharp");
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { calcPlayerStats } = require("../shared/combatStats");

const LEFT_SLOTS  = ["head_top", "armor",   "weapon",  "garment",     "accessory_l"];
const RIGHT_SLOTS = ["head_mid", "head_low", "shield",  "shoes",       "accessory_r"];
const COL3_SLOTS  = ["title_eq", "job_eq",  "special_1", "special_2", "special_3", "anchor"];

const SLOT_LABELS = {
  head_top:    "頭上",     head_mid:    "頭中",
  head_low:    "頭下",     armor:       "衣服",
  weapon:      "武器",     shield:      "副手",
  garment:     "披肩",     shoes:       "鞋子",
  accessory_l: "飾品左",   accessory_r: "飾品右",
  title_eq:    "稱號",     job_eq:      "職業",
  special:     "怪物卡",
  special_1:   "卡①",     special_2:   "卡②",     special_3:   "卡③",
  anchor:      "錨點"
};

const TIER_COLORS = {
  D: "#8899aa", // 灰
  C: "#44cc88", // 綠
  B: "#6699ff", // 藍
  A: "#ffcc44", // 金
  S: "#b9f2ff"  // 鑽石（冰藍）
};

// ── 畫面尺寸（1200×720, 16:9） ──────────────────────
const CARD_W   = 1200;
const TITLE_H  = 50;
const ROW_H    = 110;
const MAIN_H   = ROW_H * 5;        // 550
const FOOTER_H = 120;
const CARD_H   = TITLE_H + MAIN_H + FOOTER_H;  // 720

// 三欄
const COL_LEFT_X   = 0;     const COL_LEFT_W   = 280;
const COL_CENTER_X = 280;   const COL_CENTER_W = 640;
const COL_RIGHT_X  = 920;   const COL_RIGHT_W  = 280;

// 顏色
const C_BG       = "#0a1020";
const C_PANEL    = "#141d33";
const C_PANEL_2  = "#0f1729";
const C_BORDER   = "#2a3550";
const C_GOLD     = "#fbbf24";
const C_GOLD_DIM = "#a07a1f";
const C_TEXT     = "#e8edf5";
const C_TEXT_DIM = "#94a3b8";
const C_TEXT_MUTED = "#5a6885";
const C_HP       = "#ef4444";
const C_GREEN    = "#4ade80";
const C_BLUE     = "#60a5fa";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tierColor(t) {
  return TIER_COLORS[t] || C_BORDER;
}

// 估算字元寬度（中文 1.0、ASCII 0.55）
function approxLen(s, fontPx) {
  let w = 0;
  for (const ch of String(s ?? "")) {
    if (ch.charCodeAt(0) > 255) w += fontPx;
    else w += fontPx * 0.55;
  }
  return w;
}

function truncate(s, fontPx, maxW) {
  s = String(s ?? "");
  if (approxLen(s, fontPx) <= maxW) return s;
  let out = "";
  for (const ch of s) {
    const next = out + ch + "…";
    if (approxLen(next, fontPx) > maxW) break;
    out += ch;
  }
  return out + "…";
}

async function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const bufs = [];
      res.on("data", (c) => bufs.push(c));
      res.on("end", () => resolve(Buffer.concat(bufs)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function toBase64Png(buffer, w, h, fit = "cover") {
  const buf = await sharp(buffer).resize(w, h, { fit }).png().toBuffer();
  return buf.toString("base64");
}

async function loadThumb(item, publicDir, w, h) {
  if (!item) return null;
  const url = item.imageThumbnailUrl || item.imageUrl;
  if (!url) return null;
  try {
    let buf;
    if (url.startsWith("http")) buf = await fetchBuffer(url);
    else {
      const p = path.resolve(publicDir, url.replace(/^\//, ""));
      if (fs.existsSync(p)) buf = fs.readFileSync(p);
    }
    if (buf) return await toBase64Png(buf, w, h, "cover");
  } catch { /* skip */ }
  return null;
}

/**
 * @param {{ equipped, avatarUrl, publicDir, progress, player, wallet }} opts
 * @returns {Promise<Buffer>}
 */
async function renderEquipmentCard({ equipped, avatarUrl, publicDir, progress, player, wallet }) {
  equipped = equipped || {};
  const attrs   = progress?.attributes || {};
  const level   = progress?.level  ?? 1;
  const job     = progress?.job    ?? "Novice";
  const gold    = wallet?.gold     ?? 0;
  const name    = player?.displayName ?? "玩家";
  const inventory = progress?.inventory || [];

  // ── 真實戰鬥屬性（與 monsterZone / playerApp 完全一致） ─────────
  let stats;
  try {
    stats = calcPlayerStats(attrs, equipped, [], inventory);
  } catch {
    stats = null;
  }

  // 裝備加成
  const baseAttr = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const k of Object.keys(baseAttr)) baseAttr[k] = attrs[k] ?? 0;
  const totalAttr = { ...baseAttr };
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in totalAttr) totalAttr[k] += (v || 0);
    }
  }

  const stat = (key) => Math.round(stats?.[key] ?? 0);

  // ── 預載所有縮圖 ────────────────────────────────────
  const ALL_SLOTS = [...LEFT_SLOTS, ...RIGHT_SLOTS, ...COL3_SLOTS];
  const thumbs = {};
  await Promise.all(ALL_SLOTS.map(async (slot) => {
    const item = equipped[slot];
    if (!item) return;
    thumbs[slot] = await loadThumb(item, publicDir, 64, 64);
  }));

  // ── 頭像 ───────────────────────────────────────────
  let avatarBigB64 = null;
  let avatarSmallB64 = null;
  try {
    const buf = await fetchBuffer(avatarUrl + "?size=512");
    avatarBigB64   = await toBase64Png(buf, 200, 200, "cover");
    avatarSmallB64 = await toBase64Png(buf, 32, 32, "cover");
  } catch { /* 無頭像 */ }

  // ── 頂部標題列 ──────────────────────────────────────
  const titleSvg = `
    <defs>
      <linearGradient id="titleGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a2540"/>
        <stop offset="100%" stop-color="#0d1525"/>
      </linearGradient>
    </defs>
    <rect width="${CARD_W}" height="${TITLE_H}" fill="url(#titleGrad)"/>
    <rect y="${TITLE_H - 2}" width="${CARD_W}" height="2" fill="${C_GOLD}" opacity="0.5"/>
    ${avatarSmallB64 ? `<image href="data:image/png;base64,${avatarSmallB64}" x="14" y="9" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>` : ""}
    <text x="56" y="32" font-size="18" font-weight="bold" fill="${C_TEXT}" font-family="sans-serif">${esc(truncate(name, 18, 280))}</text>
    <text x="${56 + Math.min(290, approxLen(name, 18) + 12)}" y="32" font-size="13" fill="${C_GOLD}" font-family="sans-serif">Lv.${esc(String(level))} ・ ${esc(job)}</text>
    <text x="${CARD_W / 2}" y="32" text-anchor="middle" font-size="14" font-weight="bold" fill="${C_GOLD}" font-family="sans-serif" letter-spacing="2">⚔ EQUIPMENT</text>
    <text x="${CARD_W - 16}" y="32" text-anchor="end" font-size="12" fill="${C_TEXT_DIM}" font-family="sans-serif">EquipmentGAME</text>
  `;

  // ── 裝備槽 ─────────────────────────────────────────
  function slotBox(slot, x, row, w) {
    const y = TITLE_H + row * ROW_H;
    const item = equipped[slot];
    const lbl = SLOT_LABELS[slot] || slot;
    const innerX = x + 8;
    const innerY = y + 6;
    const innerW = w - 16;
    const innerH = ROW_H - 12;

    const tier = item?.tier || null;
    const fillColor = item ? C_PANEL : C_PANEL_2;
    const stroke = item ? tierColor(tier) : C_BORDER;
    const strokeW = item ? 2 : 1;

    const parts = [
      `<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" rx="8" fill="${fillColor}" stroke="${stroke}" stroke-width="${strokeW}"/>`,
      `<text x="${innerX + 12}" y="${innerY + 18}" font-size="11" fill="${C_TEXT_MUTED}" font-family="sans-serif" letter-spacing="1">${esc(lbl)}</text>`
    ];

    if (!item) {
      parts.push(`<text x="${innerX + innerW / 2}" y="${innerY + innerH / 2 + 8}" text-anchor="middle" font-size="13" fill="${C_TEXT_MUTED}" font-family="sans-serif">— 空 —</text>`);
      return parts.join("\n    ");
    }

    // tier badge
    if (tier) {
      const tx = innerX + innerW - 30;
      parts.push(`<rect x="${tx}" y="${innerY + 8}" width="22" height="16" rx="3" fill="${tierColor(tier)}"/>`);
      parts.push(`<text x="${tx + 11}" y="${innerY + 20}" text-anchor="middle" font-size="11" font-weight="bold" fill="#0a0f1c" font-family="sans-serif">${esc(tier)}</text>`);
    }

    // 縮圖 64×64
    const thumb = thumbs[slot];
    const thumbX = innerX + 10;
    const thumbY = innerY + 26;
    parts.push(`<rect x="${thumbX}" y="${thumbY}" width="64" height="64" rx="6" fill="#0a0f1c" stroke="${C_BORDER}" stroke-width="1"/>`);
    if (thumb) {
      parts.push(`<image href="data:image/png;base64,${thumb}" x="${thumbX}" y="${thumbY}" width="64" height="64" preserveAspectRatio="xMidYMid meet"/>`);
    }

    // 名稱
    const nameX = thumbX + 72;
    const nameMaxW = innerW - 80 - 8;
    const itemName = item.itemName || item.name || "";
    parts.push(`<text x="${nameX}" y="${innerY + 46}" font-size="14" font-weight="500" fill="${C_TEXT}" font-family="sans-serif">${esc(truncate(itemName, 14, nameMaxW))}</text>`);

    // 強化等級
    const enh = Number(item.enhanceLevel || 0);
    if (enh > 0) {
      parts.push(`<text x="${nameX}" y="${innerY + 68}" font-size="14" font-weight="bold" fill="${C_GOLD}" font-family="sans-serif">+${enh}</text>`);
    }

    // 主屬性（前 2 個正向）
    if (item.equipStats) {
      const statsText = Object.entries(item.equipStats)
        .filter(([_, v]) => v > 0)
        .slice(0, 3)
        .map(([k, v]) => `${k.toUpperCase()}+${v}`)
        .join(" ");
      if (statsText) {
        const statsX = enh > 0 ? nameX + 30 : nameX;
        parts.push(`<text x="${statsX}" y="${innerY + 68}" font-size="11" fill="${C_TEXT_DIM}" font-family="sans-serif">${esc(truncate(statsText, 11, nameMaxW - (enh > 0 ? 30 : 0)))}</text>`);
      }
    }

    // 武器類型 / 怪物卡技能（底部小字）
    let bottomNote = "";
    if (slot === "weapon" || slot === "shield") {
      if (item.weaponType) bottomNote = item.weaponType;
    } else if (item.monsterCardSkill?.name) {
      bottomNote = `🎴 ${item.monsterCardSkill.name}`;
    }
    if (bottomNote) {
      parts.push(`<text x="${nameX}" y="${innerY + 86}" font-size="10" fill="${C_TEXT_MUTED}" font-family="sans-serif">${esc(truncate(bottomNote, 10, nameMaxW))}</text>`);
    }

    return parts.join("\n    ");
  }

  const leftSlotsSvg  = LEFT_SLOTS .map((s, i) => slotBox(s, COL_LEFT_X,  i, COL_LEFT_W)).join("\n  ");
  const rightSlotsSvg = RIGHT_SLOTS.map((s, i) => slotBox(s, COL_RIGHT_X, i, COL_RIGHT_W)).join("\n  ");

  // ── 中央區（頭像 + 屬性表） ─────────────────────────
  const cy0 = TITLE_H + 8;
  const centerInnerX = COL_CENTER_X + 16;
  const centerInnerW = COL_CENTER_W - 32;

  // 頭像 200×200 居中
  const avaW = 200;
  const avaX = COL_CENTER_X + (COL_CENTER_W - avaW) / 2;
  const avaY = cy0 + 6;

  // 名字（頭像下）
  const nameY = avaY + avaW + 28;
  const jobY  = nameY + 22;

  // 稱號 / 職業 / 卡①②③ 五個 64×64 徽章
  const badgeW = 60, badgeH = 60, badgeGap = 10;
  const badgeRowW = COL3_SLOTS.length * badgeW + (COL3_SLOTS.length - 1) * badgeGap;
  const badgeStartX = COL_CENTER_X + (COL_CENTER_W - badgeRowW) / 2;
  const badgeY = jobY + 18;

  function specialBadge(slot, idx) {
    const item = equipped[slot];
    const lbl  = SLOT_LABELS[slot] || slot;
    const x = badgeStartX + idx * (badgeW + badgeGap);
    const y = badgeY;
    const tier = item?.tier || null;
    const stroke = item ? tierColor(tier) : C_BORDER;
    const fill = item ? C_PANEL : C_PANEL_2;
    const strokeW = item ? 2 : 1;
    const thumb = thumbs[slot];
    const enh = Number(item?.enhanceLevel || 0);

    const parts = [
      `<rect x="${x}" y="${y}" width="${badgeW}" height="${badgeH}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"/>`,
    ];
    if (item && thumb) {
      parts.push(`<image href="data:image/png;base64,${thumb}" x="${x + 4}" y="${y + 4}" width="${badgeW - 8}" height="${badgeH - 8}" preserveAspectRatio="xMidYMid meet"/>`);
    } else if (!item) {
      parts.push(`<text x="${x + badgeW / 2}" y="${y + badgeH / 2 + 4}" text-anchor="middle" font-size="11" fill="${C_TEXT_MUTED}" font-family="sans-serif">${esc(lbl)}</text>`);
    }
    if (enh > 0) {
      parts.push(`<rect x="${x + badgeW - 24}" y="${y + badgeH - 16}" width="22" height="14" rx="3" fill="${C_GOLD}"/>`);
      parts.push(`<text x="${x + badgeW - 13}" y="${y + badgeH - 5}" text-anchor="middle" font-size="10" font-weight="bold" fill="#0a0f1c" font-family="sans-serif">+${enh}</text>`);
    }
    // 槽位標籤（小字在下）
    parts.push(`<text x="${x + badgeW / 2}" y="${y + badgeH + 12}" text-anchor="middle" font-size="9" fill="${C_TEXT_MUTED}" font-family="sans-serif">${esc(lbl)}</text>`);
    return parts.join("\n    ");
  }

  const badgesSvg = COL3_SLOTS.map((s, i) => specialBadge(s, i)).join("\n  ");

  // 屬性表（6 屬性，2 列 × 3 行）
  const attrTitleY = badgeY + badgeH + 28;
  const attrRowY1  = attrTitleY + 22;
  const attrColW   = (centerInnerW - 16) / 2;
  const attrCol1X  = centerInnerX + 4;
  const attrCol2X  = centerInnerX + attrColW + 12;

  function attrLine(label, base, total, x, y) {
    const bonus = total - base;
    const bonusStr = bonus > 0 ? `+${bonus}` : (bonus < 0 ? `${bonus}` : "");
    const totalColor = bonus > 0 ? C_GREEN : (bonus < 0 ? "#f87171" : C_TEXT);
    return [
      `<text x="${x}" y="${y}" font-size="13" fill="${C_TEXT_DIM}" font-family="sans-serif" letter-spacing="1">${esc(label)}</text>`,
      `<text x="${x + 56}" y="${y}" font-size="15" font-weight="bold" fill="${totalColor}" font-family="sans-serif">${esc(String(total))}</text>`,
      bonusStr ? `<text x="${x + 96}" y="${y}" font-size="11" fill="${C_GREEN}" font-family="sans-serif">(${bonusStr})</text>` : ""
    ].join("\n    ");
  }

  const attrLines = [
    attrLine("STR", baseAttr.str, totalAttr.str, attrCol1X, attrRowY1),
    attrLine("AGI", baseAttr.agi, totalAttr.agi, attrCol2X, attrRowY1),
    attrLine("VIT", baseAttr.vit, totalAttr.vit, attrCol1X, attrRowY1 + 26),
    attrLine("INT", baseAttr.int, totalAttr.int, attrCol2X, attrRowY1 + 26),
    attrLine("DEX", baseAttr.dex, totalAttr.dex, attrCol1X, attrRowY1 + 52),
    attrLine("LUK", baseAttr.luk, totalAttr.luk, attrCol2X, attrRowY1 + 52),
  ].join("\n  ");

  const centerSvg = `
    <rect x="${COL_CENTER_X}" y="${TITLE_H}" width="${COL_CENTER_W}" height="${MAIN_H}" fill="#0d1426"/>
    <rect x="${COL_CENTER_X}" y="${TITLE_H}" width="${COL_CENTER_W}" height="${MAIN_H}" fill="none" stroke="${C_BORDER}" stroke-width="1"/>

    <!-- 大頭像 -->
    <rect x="${avaX - 4}" y="${avaY - 4}" width="${avaW + 8}" height="${avaW + 8}" rx="6" fill="${C_PANEL}" stroke="${C_GOLD}" stroke-width="2"/>
    ${avatarBigB64
      ? `<image href="data:image/png;base64,${avatarBigB64}" x="${avaX}" y="${avaY}" width="${avaW}" height="${avaW}" preserveAspectRatio="xMidYMid meet"/>`
      : `<rect x="${avaX}" y="${avaY}" width="${avaW}" height="${avaW}" fill="${C_PANEL_2}"/>`
    }

    <!-- 名字 + 職業 -->
    <text x="${COL_CENTER_X + COL_CENTER_W / 2}" y="${nameY}" text-anchor="middle" font-size="22" font-weight="bold" fill="${C_TEXT}" font-family="sans-serif">${esc(truncate(name, 22, COL_CENTER_W - 40))}</text>
    <text x="${COL_CENTER_X + COL_CENTER_W / 2}" y="${jobY}" text-anchor="middle" font-size="14" fill="${C_GOLD}" font-family="sans-serif">⚔ ${esc(job)} ・ Lv.${esc(String(level))}</text>

    <!-- 5 個徽章 (稱號/職業/卡片) -->
    ${badgesSvg}

    <!-- 屬性表標題 + 分隔線 -->
    <line x1="${centerInnerX}" y1="${attrTitleY - 8}" x2="${centerInnerX + centerInnerW}" y2="${attrTitleY - 8}" stroke="${C_GOLD_DIM}" stroke-width="1" opacity="0.5"/>
    <text x="${COL_CENTER_X + COL_CENTER_W / 2}" y="${attrTitleY + 6}" text-anchor="middle" font-size="12" fill="${C_GOLD}" font-family="sans-serif" letter-spacing="3">— STATS —</text>

    ${attrLines}
  `;

  // ── 底部：核心戰鬥數據 + 金幣 ─────────────────────────
  const fy = TITLE_H + MAIN_H;
  // 核心數據條：HP / ATK / DEF% / HIT% / DODGE% / CRIT%
  const coreData = stats ? [
    { label: "HP",    value: stat("maxHp"), color: C_HP,   suffix: "" },
    { label: "ATK",   value: stat("atk"),   color: C_GOLD, suffix: "" },
    { label: "DEF",   value: stat("def"),   color: C_BLUE, suffix: "%" },
    { label: "HIT",   value: stat("hit"),   color: C_GREEN,suffix: "%" },
    { label: "DODGE", value: stat("dodge"), color: C_BLUE, suffix: "%" },
    { label: "CRIT",  value: stat("crit"),  color: "#fb7185", suffix: "%" },
  ] : [];

  const cellW = (CARD_W - 200) / coreData.length; // 留 200 給金幣區
  function dataCell(d, i) {
    const x = i * cellW + 8;
    const y = fy + 14;
    const w = cellW - 12;
    return `
      <rect x="${x}" y="${y}" width="${w}" height="86" rx="8" fill="${C_PANEL_2}" stroke="${C_BORDER}" stroke-width="1"/>
      <text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" font-size="11" fill="${C_TEXT_DIM}" font-family="sans-serif" letter-spacing="2">${esc(d.label)}</text>
      <text x="${x + w / 2}" y="${y + 58}" text-anchor="middle" font-size="26" font-weight="bold" fill="${d.color}" font-family="sans-serif">${esc(String(d.value))}${d.suffix ? `<tspan font-size="14">${d.suffix}</tspan>` : ""}</text>
    `;
  }

  const dataCellsSvg = coreData.map(dataCell).join("\n  ");

  // 金幣方塊（最右）
  const goldX = CARD_W - 192;
  const goldY = fy + 14;
  const goldW = 184;
  const goldSvg = `
    <rect x="${goldX}" y="${goldY}" width="${goldW}" height="86" rx="8" fill="#2a1f0a" stroke="${C_GOLD}" stroke-width="2"/>
    <text x="${goldX + goldW / 2}" y="${goldY + 26}" text-anchor="middle" font-size="12" fill="${C_GOLD_DIM}" font-family="sans-serif" letter-spacing="3">GOLD</text>
    <text x="${goldX + goldW / 2}" y="${goldY + 64}" text-anchor="middle" font-size="28" font-weight="bold" fill="${C_GOLD}" font-family="sans-serif">💰 ${esc(Number(gold).toLocaleString())}</text>
  `;

  const footerSvg = `
    <rect y="${fy}" width="${CARD_W}" height="${FOOTER_H}" fill="#0d1525"/>
    <rect y="${fy}" width="${CARD_W}" height="2" fill="${C_GOLD}" opacity="0.4"/>
    ${dataCellsSvg}
    ${goldSvg}
  `;

  // ── 組合 SVG ────────────────────────────────────────
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="${C_BG}"/>
  ${titleSvg}
  ${centerSvg}
  ${leftSlotsSvg}
  ${rightSlotsSvg}
  ${footerSvg}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { renderEquipmentCard, LEFT_SLOTS, RIGHT_SLOTS, COL3_SLOTS, SLOT_LABELS };
