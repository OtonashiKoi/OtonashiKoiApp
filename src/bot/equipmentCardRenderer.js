// 裝備欄卡片圖片生成器（sharp + SVG）
"use strict";

const sharp = require("sharp");
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

const LEFT_SLOTS  = ["head_top", "armor",   "weapon",  "garment",     "accessory_l"];
const RIGHT_SLOTS = ["head_mid", "head_low", "shield",  "shoes",       "accessory_r"];
const COL3_SLOTS  = ["title_eq", "job_eq",  "special_1", "special_2", "special_3"];

const SLOT_LABELS = {
  head_top:    "頭上",     head_mid:    "頭中",
  head_low:    "頭下",     armor:       "衣服",
  weapon:      "武器",     shield:      "副手武器",
  garment:     "披肩",     shoes:       "鞋子",
  accessory_l: "飾品 左",  accessory_r: "飾品 右",
  title_eq:    "稱號",     job_eq:      "職業",
  special:     "怪物卡",
  special_1:   "特殊①",    special_2:   "特殊②",
  special_3:   "特殊③"
};

// 每排右欄第三格：角色資訊
const INFO_ROWS = ["稱號", "職業", "等級", "", ""];
// 右欄第四格：基礎屬性標籤
const STAT_LABELS = ["STR", "AGI", "VIT", "INT", "DEX"];
// 右欄第五格：衍生屬性標籤
const DERIVED_LABELS = ["攻擊", "迴避", "血量", "魔攻", "魔防"];

// ── 畫面尺寸 ──────────────────────────────────────────
// 720 × 442
// 標題列 36px | 5×行 74px | 底部列 32px
const CARD_W   = 720;
const TITLE_H  = 36;
const ROW_H    = 74;
const FOOTER_H = 32;
const CARD_H   = TITLE_H + ROW_H * 5 + FOOTER_H;  // 438
const ROWS_Y   = TITLE_H;

// 欄位 X 座標 & 寬度
const COL_LEFT_X   = 0;    const COL_LEFT_W   = 108;
const COL_AVA_X    = 108;  const COL_AVA_W    = 180;
const COL_RIGHT_X  = 288;  const COL_RIGHT_W  = 108;
const COL_INFO_X   = 396;  const COL_INFO_W   = 104;
const COL_STAT_X   = 500;  const COL_STAT_W   = 80;
const COL_DERIV_X  = 580;  const COL_DERIV_W  = 140;

const PAD = 6;

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

/**
 * @param {{ equipped, avatarUrl, publicDir, progress, player, wallet }} opts
 * @returns {Promise<Buffer>}
 */
async function renderEquipmentCard({ equipped, avatarUrl, publicDir, progress, player, wallet }) {
  const attrs   = progress?.attributes || {};
  const level   = progress?.level  ?? "?";
  const job     = progress?.job    ?? "Novice";
  const gold    = wallet?.gold     ?? 0;
  const name    = player?.displayName ?? "玩家";

  // 計算裝備加成後的總屬性
  const totalAttr = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  for (const k of Object.keys(totalAttr)) totalAttr[k] = attrs[k] ?? 0;
  for (const item of Object.values(equipped)) {
    if (!item?.equipStats) continue;
    for (const [k, v] of Object.entries(item.equipStats)) {
      if (k in totalAttr) totalAttr[k] += (v || 0);
    }
  }

  // 衍生屬性（簡易公式）
  const derived = {
    atk:   Math.floor(totalAttr.str * 2 + totalAttr.dex * 0.5),
    dodge: Math.floor(totalAttr.agi * 1.5 + totalAttr.dex * 0.3),
    hp:    Math.floor(35 + level * 5 + totalAttr.vit * 8),
    matk:  Math.floor(totalAttr.int * 2.5),
    mdef:  Math.floor(totalAttr.vit * 1 + totalAttr.int * 0.5),
  };
  // 命中率（底部）
  const hitRate = Math.min(99, Math.floor(75 + totalAttr.dex * 0.8 + totalAttr.luk * 0.2));

  // ── 小頭像（標題列）─────────────────────────────────
  let smallAvaB64 = null;
  let bigAvaB64   = null;
  try {
    const buf = await fetchBuffer(avatarUrl + "?size=256");
    smallAvaB64 = await toBase64Png(buf, 28, 28, "cover");
    bigAvaB64   = await toBase64Png(buf, COL_AVA_W, ROW_H * 5, "cover");
  } catch { /* 無頭像 */ }

  // ── 已裝備道具縮圖 ───────────────────────────────────
  const thumbB64 = {};
  for (const slot of [...LEFT_SLOTS, ...RIGHT_SLOTS]) {
    const item = equipped[slot];
    if (!item) continue;
    const thumbUrl = item.imageThumbnailUrl || item.imageUrl;
    if (!thumbUrl) continue;
    try {
      let buf;
      if (thumbUrl.startsWith("http")) {
        buf = await fetchBuffer(thumbUrl);
      } else {
        const p = path.resolve(publicDir, thumbUrl.replace(/^\//, ""));
        if (fs.existsSync(p)) buf = fs.readFileSync(p);
      }
      if (buf) thumbB64[slot] = await toBase64Png(buf, 36, 36, "cover");
    } catch { /* 跳過 */ }
  }

  // ── 格子生成器 ──────────────────────────────────────
  function slotBox(slot, x, w, row) {
    const y    = ROWS_Y + row * ROW_H;
    const item = equipped[slot];
    const lbl  = SLOT_LABELS[slot];
    const rawName = item ? item.itemName : "空";
    const name = rawName.length > 7 ? rawName.slice(0, 7) + "…" : rawName;
    const fill   = item ? "#1e3a5f" : "#0f172a";
    const stroke = item ? "#60a5fa" : "#334155";
    const tc     = item ? "#e2e8f0" : "#64748b";
    const bh = ROW_H - 4;
    const bw = w - 4;
    const thumb = thumbB64[slot];
    const imgEl = thumb
      ? `<image href="data:image/png;base64,${thumb}" x="${x + 2}" y="${y + 20}" width="36" height="36" preserveAspectRatio="xMidYMid meet"/>`
      : "";
    const nameX = thumb ? x + 42 : x + PAD;
    return [
      `<rect x="${x + 2}" y="${y + 2}" width="${bw}" height="${bh}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`,
      `<text x="${x + PAD}" y="${y + 14}" font-size="9" fill="#94a3b8" font-family="sans-serif">${esc(lbl)}</text>`,
      imgEl,
      `<text x="${nameX}" y="${y + bh - 6}" font-size="10" fill="${tc}" font-family="sans-serif">${esc(name)}</text>`,
    ].join("\n    ");
  }

  // ── 右欄資訊格 ──────────────────────────────────────
  const infoValues = [
    "",                  // 稱號（暫無）
    job,
    `Lv.${level}`,
    "",
    "",
  ];
  const statKeys   = ["str", "agi", "vit", "int", "dex"];
  const derivedArr = [derived.atk, derived.dodge, derived.hp, derived.matk, derived.mdef];

  function infoCell(row) {
    const y = ROWS_Y + row * ROW_H;
    const label = INFO_ROWS[row];
    const value = infoValues[row];
    if (!label && !value) return "";
    return [
      `<rect x="${COL_INFO_X + 2}" y="${y + 2}" width="${COL_INFO_W - 4}" height="${ROW_H - 4}" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`,
      label ? `<text x="${COL_INFO_X + PAD}" y="${y + 15}" font-size="9" fill="#64748b" font-family="sans-serif">${esc(label)}</text>` : "",
      value ? `<text x="${COL_INFO_X + PAD}" y="${y + ROW_H - 10}" font-size="12" fill="#e2e8f0" font-family="sans-serif">${esc(value)}</text>` : "",
    ].join("\n    ");
  }

  function statCell(row) {
    const y    = ROWS_Y + row * ROW_H;
    const key  = statKeys[row];
    const base = attrs[key] ?? 0;
    const total = totalAttr[key];
    const bonus = total - base;
    const bonusStr = bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : "";
    const valStr = `${total}${bonusStr ? ` (${bonusStr})` : ""}`;
    return [
      `<rect x="${COL_STAT_X + 2}" y="${y + 2}" width="${COL_STAT_W - 4}" height="${ROW_H - 4}" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`,
      `<text x="${COL_STAT_X + PAD}" y="${y + 15}" font-size="9" fill="#64748b" font-family="sans-serif">${STAT_LABELS[row]}</text>`,
      `<text x="${COL_STAT_X + PAD}" y="${y + ROW_H - 10}" font-size="13" fill="${bonus > 0 ? "#4ade80" : "#e2e8f0"}" font-family="sans-serif">${esc(valStr)}</text>`,
    ].join("\n    ");
  }

  function derivedCell(row) {
    const y   = ROWS_Y + row * ROW_H;
    const val = derivedArr[row];
    return [
      `<rect x="${COL_DERIV_X + 2}" y="${y + 2}" width="${COL_DERIV_W - 4}" height="${ROW_H - 4}" rx="5" fill="#0f172a" stroke="#1e293b" stroke-width="1"/>`,
      `<text x="${COL_DERIV_X + PAD}" y="${y + 15}" font-size="9" fill="#64748b" font-family="sans-serif">${DERIVED_LABELS[row]}</text>`,
      `<text x="${COL_DERIV_X + PAD}" y="${y + ROW_H - 10}" font-size="14" fill="#fbbf24" font-family="sans-serif">${esc(String(val))}</text>`,
    ].join("\n    ");
  }

  // ── 組合 SVG ────────────────────────────────────────
  const leftBoxes   = LEFT_SLOTS .map((s, i) => slotBox(s, COL_LEFT_X,  COL_LEFT_W,  i)).join("\n    ");
  const rightBoxes  = RIGHT_SLOTS.map((s, i) => slotBox(s, COL_RIGHT_X, COL_RIGHT_W, i)).join("\n    ");
  const infoCells   = [0,1,2,3,4].map(infoCell).join("\n    ");
  const statCells   = [0,1,2,3,4].map(statCell).join("\n    ");
  const derivCells  = [0,1,2,3,4].map(derivedCell).join("\n    ");

  const avaEl = bigAvaB64
    ? `<image href="data:image/png;base64,${bigAvaB64}" x="${COL_AVA_X}" y="${ROWS_Y}" width="${COL_AVA_W}" height="${ROW_H * 5}" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="${COL_AVA_X}" y="${ROWS_Y}" width="${COL_AVA_W}" height="${ROW_H * 5}" rx="4" fill="#1e293b"/>`;

  const smallAvaEl = smallAvaB64
    ? `<image href="data:image/png;base64,${smallAvaB64}" x="4" y="4" width="28" height="28" preserveAspectRatio="xMidYMid meet"/>`
    : "";

  // 標題列
  const titleRow = `
    <rect width="${CARD_W}" height="${TITLE_H}" fill="#1e293b"/>
    ${smallAvaEl}
    <text x="36" y="23" font-size="13" fill="#f1f5f9" font-family="sans-serif" font-weight="bold">${esc(name)}</text>
    <text x="160" y="23" font-size="11" fill="#94a3b8" font-family="sans-serif">Lv.${esc(String(level))}  ${esc(job)}</text>
    <text x="${CARD_W / 2}" y="23" text-anchor="middle" font-size="11" fill="#60a5fa" font-family="sans-serif">⚔ 裝備欄</text>
  `;

  // 底部列
  const footerY = TITLE_H + ROW_H * 5;
  const footerRow = `
    <rect y="${footerY}" width="${CARD_W}" height="${FOOTER_H}" fill="#1e293b"/>
    <text x="20"  y="${footerY + 21}" font-size="12" fill="#4ade80" font-family="sans-serif">LUK  ${esc(String(totalAttr.luk))}</text>
    <text x="${CARD_W / 2 - 60}" y="${footerY + 21}" font-size="12" fill="#fbbf24" font-family="sans-serif">💰 ${esc(String(gold.toLocaleString()))}</text>
    <text x="${CARD_W - 130}" y="${footerY + 21}" font-size="12" fill="#38bdf8" font-family="sans-serif">命中  ${esc(String(hitRate))}%</text>
  `;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="#0f172a"/>
  ${titleRow}
  ${avaEl}
  ${leftBoxes}
  ${rightBoxes}
  ${infoCells}
  ${statCells}
  ${derivCells}
  ${footerRow}
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { renderEquipmentCard, LEFT_SLOTS, RIGHT_SLOTS, COL3_SLOTS, SLOT_LABELS };
