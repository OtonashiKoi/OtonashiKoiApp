const { createCanvas, loadImage } = require("@napi-rs/canvas");

const rarityColor = {
  common: "#6b7280",
  uncommon: "#15803d",
  rare: "#1d4ed8",
  epic: "#7e22ce",
  legendary: "#b45309"
};

const FONT_STACK = '"Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC", sans-serif';

function font(size, weight = 400) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

function drawPanel(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function drawRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawBevel(ctx, x, y, w, h) {
  ctx.strokeStyle = "#f8fbff";
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();

  ctx.strokeStyle = "#6f7e95";
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.stroke();
}

function drawWindow(ctx, x, y, w, h, title) {
  drawPanel(ctx, x, y, w, h, "#dfe7f4");
  drawBevel(ctx, x, y, w, h);

  const topGrad = ctx.createLinearGradient(x + 6, y + 6, x + 6, y + 32);
  topGrad.addColorStop(0, "#93aad0");
  topGrad.addColorStop(1, "#7e95bc");
  drawPanel(ctx, x + 6, y + 6, w - 12, 26, topGrad);
  drawBevel(ctx, x + 6, y + 6, w - 12, 26);

  ctx.fillStyle = "#1f2a44";
  ctx.font = font(16, 600);
  ctx.fillText(title, x + 14, y + 24);
}

function drawTabs(ctx, x, y, labels) {
  let cursor = x;
  for (const label of labels) {
    const w = 66;
    drawPanel(ctx, cursor, y, w, 24, "#d7dfec");
    drawBevel(ctx, cursor, y, w, 24);
    ctx.fillStyle = "#3a4b67";
    ctx.font = font(12, 500);
    ctx.textAlign = "center";
    ctx.fillText(label, cursor + w / 2, y + 16);
    cursor += w + 4;
  }
}

function slotText(slot) {
  if (slot === "head") return "頭上";
  if (slot === "head2") return "頭中";
  if (slot === "weapon") return "右手";
  if (slot === "armor") return "身體";
  if (slot === "leftHand") return "左手";
  if (slot === "garment") return "披風";
  if (slot === "shoes") return "鞋子";
  if (slot === "accessory2") return "飾品2";
  return "飾品1";
}

function renderEquipLine(ctx, side, slot, item, x, y, w) {
  const label = slotText(slot);
  const textAlign = side === "left" ? "left" : "right";

  drawPanel(ctx, x, y, w, 36, "#edf2f8");
  drawBevel(ctx, x, y, w, 36);

  ctx.textAlign = textAlign;
  ctx.fillStyle = "#667085";
  ctx.font = font(12, 500);
  ctx.fillText(label, side === "left" ? x + 10 : x + w - 10, y + 14);

  if (!item) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = font(12, 600);
    ctx.fillText("未裝備", side === "left" ? x + 10 : x + w - 10, y + 30);
    return;
  }

  const color = rarityColor[item.rarity] || "#475569";
  const compactName = item.name.length > 14 ? `${item.name.slice(0, 12)}..` : item.name;

  ctx.fillStyle = color;
  ctx.font = font(12, 600);
  ctx.fillText(compactName, side === "left" ? x + 10 : x + w - 10, y + 30);
}

async function drawCharacterPanel(ctx, x, y, w, h, userName, level, avatarURL) {
  drawPanel(ctx, x, y, w, h, "#edf2f8");
  drawBevel(ctx, x, y, w, h);

  const cx = x + w / 2;
  const cy = y + 118;

  const ringGrad = ctx.createRadialGradient(cx, cy, 24, cx, cy, 72);
  ringGrad.addColorStop(0, "#dbe4f4");
  ringGrad.addColorStop(1, "#b9c9e3");
  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 66, 0, Math.PI * 2);
  ctx.fill();

  let avatarDrawn = false;
  if (avatarURL) {
    try {
      const avatar = await loadImage(avatarURL);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 52, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatar, cx - 52, cy - 52, 104, 104);
      ctx.restore();
      avatarDrawn = true;
    } catch {
      avatarDrawn = false;
    }
  }

  if (!avatarDrawn) {
    ctx.fillStyle = "#8aa3c9";
    ctx.beginPath();
    ctx.arc(cx, cy - 18, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 20, cy + 8, 40, 50);
  }

  ctx.fillStyle = "#1f2a44";
  ctx.textAlign = "center";
  ctx.font = font(28, 600);
  ctx.fillText("稱號", cx, y + 34);
  ctx.font = font(13, 600);
  ctx.fillText(userName.length > 14 ? `${userName.slice(0, 14)}..` : userName, cx, y + h - 28);
  ctx.font = font(12, 400);
  ctx.fillText(`Lv ${level}`, cx, y + h - 10);
}

function drawStatRow(ctx, x, y, w, leftLabel, leftValue, rightLabel, rightValue) {
  drawPanel(ctx, x, y, w, 30, "#edf2f8");
  drawBevel(ctx, x, y, w, 30);

  ctx.textAlign = "left";
  ctx.fillStyle = "#2e3b53";
  ctx.font = font(13, 600);
  if (leftLabel) ctx.fillText(leftLabel, x + 12, y + 20);
  ctx.fillStyle = "#111827";
  if (leftValue) ctx.fillText(String(leftValue), x + 86, y + 20);

  const rightLabelX = x + Math.floor(w * 0.48);
  const rightValueX = x + Math.floor(w * 0.61);
  ctx.fillStyle = "#2e3b53";
  if (rightLabel) ctx.fillText(rightLabel, rightLabelX, y + 20);
  ctx.fillStyle = "#111827";
  if (rightValue !== undefined) ctx.fillText(String(rightValue), rightValueX, y + 20);
}

function drawSnow(ctx, width, height) {
  for (let i = 0; i < 80; i += 1) {
    const x = ((i * 97) % width) + ((i * 13) % 23);
    const y = ((i * 53) % height) + ((i * 19) % 17);
    const r = (i % 3) + 1;
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.35)" : "rgba(230,240,255,0.45)";
    ctx.beginPath();
    ctx.arc(x % width, y % height, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function renderLoadoutCard({ name, level, power, bonus, equipped, avatarURL }) {
  const width = 920;
  const height = 760;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, "#d8e6f7");
  bgGrad.addColorStop(1, "#b8cde8");
  drawPanel(ctx, 0, 0, width, height, bgGrad);
  drawSnow(ctx, width, height);

  const overlayGrad = ctx.createLinearGradient(0, 0, width, height);
  overlayGrad.addColorStop(0, "rgba(248,252,255,0.35)");
  overlayGrad.addColorStop(1, "rgba(174,196,224,0.25)");
  drawPanel(ctx, 12, 12, width - 24, height - 24, overlayGrad);
  drawBevel(ctx, 12, 12, width - 24, height - 24);

  drawWindow(ctx, 24, 22, width - 48, 446, "Equipment");
  drawTabs(ctx, 42, 56, ["一般裝備", "特殊裝備", "稱號"]);

  const leftX = 48;
  const rightX = width - 48 - 208;
  const lineW = 208;
  const lineYStart = 102;
  const gap = 44;

  renderEquipLine(ctx, "left", "head", null, leftX, lineYStart + gap * 0, lineW);
  renderEquipLine(ctx, "left", "head2", null, leftX, lineYStart + gap * 1, lineW);
  renderEquipLine(ctx, "left", "weapon", equipped.weapon, leftX, lineYStart + gap * 2, lineW);
  renderEquipLine(ctx, "left", "garment", null, leftX, lineYStart + gap * 3, lineW);
  renderEquipLine(ctx, "left", "accessory", equipped.accessory, leftX, lineYStart + gap * 4, lineW);

  renderEquipLine(ctx, "right", "head", null, rightX, lineYStart + gap * 0, lineW);
  renderEquipLine(ctx, "right", "armor", equipped.armor, rightX, lineYStart + gap * 1, lineW);
  renderEquipLine(ctx, "right", "leftHand", null, rightX, lineYStart + gap * 2, lineW);
  renderEquipLine(ctx, "right", "shoes", null, rightX, lineYStart + gap * 3, lineW);
  renderEquipLine(ctx, "right", "accessory2", null, rightX, lineYStart + gap * 4, lineW);

  drawRoundRect(ctx, 358, 98, 204, 304, 2);
  ctx.fillStyle = "#e9f0fb";
  ctx.fill();
  drawBevel(ctx, 358, 98, 204, 304);
  await drawCharacterPanel(ctx, 370, 110, 180, 280, name, level, avatarURL);

  drawWindow(ctx, 24, 486, width - 48, 252, "Status");

  const basePower = Math.max(1, Math.floor(power - bonus.atk - bonus.def - bonus.hp * 0.2));
  const str = Math.max(1, Math.floor(basePower * 0.52));
  const agi = Math.max(1, Math.floor(level * 2 + 5));
  const vit = Math.max(1, Math.floor(level * 2 + 6));
  const intStat = Math.max(1, Math.floor(level * 2 + 4));
  const dex = Math.max(1, Math.floor(level * 2 + 5));
  const luk = Math.max(1, Math.floor(level + 2));

  const atk = power + bonus.atk;
  const def = Math.floor(power * 0.6 + bonus.def);
  const matk = Math.floor(intStat * 3 + bonus.atk * 0.8);
  const mdef = Math.floor(intStat * 2 + bonus.def * 0.7);
  const hit = Math.floor(dex * 2 + level * 3);
  const flee = Math.floor(agi * 2 + bonus.def);
  const aspd = Math.min(195, 150 + agi + Math.floor(level * 0.8));

  const leftRows = [
    ["Str", `${str}+${bonus.atk}`],
    ["Agi", `${agi}+${bonus.def}`],
    ["Vit", `${vit}+${Math.floor(bonus.hp * 0.1)}`],
    ["Int", `${intStat}+${Math.floor((bonus.atk + bonus.def) * 0.1)}`],
    ["Dex", `${dex}+${Math.floor(bonus.atk * 0.2)}`],
    ["Luk", `${luk}+${Math.floor(bonus.def * 0.1)}`],
    ["", ""]
  ];

  const rightRows = [
    ["Atk", atk],
    ["Def", def],
    ["Matk", matk],
    ["Mdef", mdef],
    ["Hit", hit],
    ["Flee", flee],
    ["Aspd", aspd]
  ];

  const statX = 36;
  const statW = width - 72;
  const statStartY = 530;
  const statGap = 30;
  for (let i = 0; i < 7; i += 1) {
    drawStatRow(ctx, statX, statStartY + i * statGap, statW, leftRows[i][0], leftRows[i][1], rightRows[i][0], rightRows[i][1]);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#5b6b82";
  ctx.font = font(12, 400);
  ctx.fillText("equipmentGAME / winter panel style", width - 38, height - 18);

  return canvas.toBuffer("image/png");
}

module.exports = {
  renderLoadoutCard
};
