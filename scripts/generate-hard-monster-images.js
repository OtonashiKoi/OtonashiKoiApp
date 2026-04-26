"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const OUTPUT_DIR = path.join(__dirname, "../src/web/public/uploads/monsters");

const MONSTERS = [
  { seq: 1, name: "城牆衛兵", kind: "guard", colors: ["#5b6470", "#d6b36a", "#8fa7c1"] },
  { seq: 2, name: "古城弓手", kind: "archer", colors: ["#44525d", "#7fb1d9", "#d8e6ef"] },
  { seq: 3, name: "石像鬼", kind: "gargoyle", colors: ["#66656c", "#bfc0c7", "#f0d17c"] },
  { seq: 4, name: "古城法師", kind: "mage", colors: ["#4d3f67", "#73d1ff", "#d8b4ff"] },
  { seq: 5, name: "廢墟蠍兵", kind: "scorpion", colors: ["#6b4b36", "#e58d39", "#f6d17a"] },
  { seq: 6, name: "冰封騎士", kind: "iceknight", colors: ["#5b78a9", "#b7e2ff", "#e8f6ff"] },
  { seq: 7, name: "詛咒祭司", kind: "priest", colors: ["#48334e", "#8fdf77", "#dac7a0"] },
  { seq: 8, name: "鐵甲衛將", kind: "captain", colors: ["#3d4651", "#cf7d42", "#f4cc78"] },
  { seq: 9, name: "古城刺客", kind: "assassin", colors: ["#2d3647", "#92f0df", "#e4f5f0"] },
  { seq: 10, name: "毒霧蜘蛛", kind: "spider", colors: ["#3b4a35", "#87d972", "#d8ffd1"] },
  { seq: 11, name: "古城狂戰士", kind: "berserker", colors: ["#5f3b33", "#f27d5d", "#ffd58c"] },
  { seq: 12, name: "黑焰巫師", kind: "darkwizard", colors: ["#241b31", "#ff7c4d", "#ffcf77"] },
  { seq: 13, name: "城堡魔像(B)", kind: "golem", colors: ["#5d5a64", "#e0d3bf", "#f3c971"] },
  { seq: 14, name: "古城將軍(B)", kind: "general", colors: ["#61282a", "#e1a84a", "#f8ecd8"] },
  { seq: 15, name: "廢都魔王(B)", kind: "demonking", colors: ["#241822", "#d04a54", "#f6bf5a"] },
];

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bg(name, c1, c2, c3) {
  return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="55%" stop-color="${c2}"/>
        <stop offset="100%" stop-color="${c3}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="38%" r="52%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.35)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="rgba(0,0,0,0.35)"/>
      </filter>
    </defs>
    <rect width="512" height="512" rx="36" fill="url(#bg)"/>
    <rect x="18" y="18" width="476" height="476" rx="24" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
    <ellipse cx="256" cy="410" rx="150" ry="28" fill="rgba(0,0,0,0.22)"/>
    <rect y="340" width="512" height="172" fill="rgba(20,18,25,0.24)"/>
    <circle cx="256" cy="180" r="180" fill="url(#glow)"/>
    <text x="256" y="468" text-anchor="middle" font-family="Arial, 'Noto Sans TC', sans-serif" font-size="28" font-weight="700" fill="rgba(255,255,255,0.9)">${esc(name)}</text>
  `;
}

function eyes(x1, x2, y, color = "#ffd95e") {
  return `
    <circle cx="${x1}" cy="${y}" r="8" fill="${color}"/>
    <circle cx="${x2}" cy="${y}" r="8" fill="${color}"/>
    <circle cx="${x1 - 2}" cy="${y - 2}" r="2.5" fill="#fff"/>
    <circle cx="${x2 - 2}" cy="${y - 2}" r="2.5" fill="#fff"/>
  `;
}

function kindSvg(kind, colors) {
  const [base, accent, glow] = colors;
  switch (kind) {
    case "guard":
      return `
        <g filter="url(#shadow)">
          <rect x="190" y="145" width="132" height="120" rx="28" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <polygon points="186,178 256,108 326,178" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(232, 280, 198)}
          <rect x="214" y="248" width="84" height="86" rx="18" fill="${accent}" opacity="0.9"/>
          <rect x="216" y="326" width="28" height="72" rx="12" fill="${base}"/>
          <rect x="268" y="326" width="28" height="72" rx="12" fill="${base}"/>
          <rect x="156" y="230" width="26" height="122" rx="12" fill="#9aa9ba"/>
          <polygon points="169,178 188,228 150,228" fill="${glow}"/>
          <path d="M332 228 Q414 240 404 322 Q394 388 316 372 Z" fill="${accent}" opacity="0.82" stroke="rgba(255,255,255,0.35)" stroke-width="5"/>
        </g>`;
    case "archer":
      return `
        <g filter="url(#shadow)">
          <path d="M180 220 Q210 128 256 128 Q302 128 332 220 Q300 274 256 278 Q212 274 180 220 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(236, 276, 214, "#9be7ff")}
          <rect x="214" y="274" width="84" height="88" rx="20" fill="${base}" opacity="0.94"/>
          <rect x="218" y="356" width="26" height="62" rx="12" fill="${accent}"/>
          <rect x="268" y="356" width="26" height="62" rx="12" fill="${accent}"/>
          <path d="M340 158 Q418 256 340 354" fill="none" stroke="${accent}" stroke-width="10"/>
          <line x1="322" y1="250" x2="412" y2="228" stroke="${glow}" stroke-width="6"/>
          <polygon points="408,228 384,216 388,240" fill="${glow}"/>
        </g>`;
    case "gargoyle":
      return `
        <g filter="url(#shadow)">
          <path d="M148 260 Q118 170 190 158 L222 208 Q238 188 256 186 Q274 188 290 208 L322 158 Q394 170 364 260 Q334 248 318 262 Q302 276 300 306 L212 306 Q210 276 194 262 Q178 248 148 260 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <circle cx="256" cy="236" r="56" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(236, 278, 232)}
          <path d="M214 178 L234 142 L250 188" fill="${accent}"/>
          <path d="M298 178 L278 142 L262 188" fill="${accent}"/>
          <rect x="218" y="302" width="28" height="86" rx="12" fill="${base}"/>
          <rect x="266" y="302" width="28" height="86" rx="12" fill="${base}"/>
        </g>`;
    case "mage":
      return `
        <g filter="url(#shadow)">
          <circle cx="256" cy="184" r="56" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(236, 278, 184, "#8bf3ff")}
          <path d="M186 388 L224 236 L288 236 L326 388 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <rect x="228" y="382" width="22" height="36" rx="10" fill="${accent}"/>
          <rect x="262" y="382" width="22" height="36" rx="10" fill="${accent}"/>
          <rect x="348" y="156" width="12" height="198" rx="6" fill="#cfc7b4"/>
          <circle cx="354" cy="142" r="26" fill="${glow}" stroke="${accent}" stroke-width="6"/>
        </g>`;
    case "scorpion":
      return `
        <g filter="url(#shadow)">
          <ellipse cx="256" cy="286" rx="98" ry="72" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(228, 280, 266)}
          <path d="M344 274 Q418 240 434 186 Q448 138 402 118" fill="none" stroke="${accent}" stroke-width="18" stroke-linecap="round"/>
          <polygon points="396,104 430,106 408,142" fill="${glow}"/>
          <path d="M164 286 L108 238" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M166 316 L92 316" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M172 342 L112 390" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M348 286 L404 238" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M346 316 L420 316" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M340 342 L400 390" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <circle cx="182" cy="280" r="20" fill="${accent}"/>
          <circle cx="330" cy="280" r="20" fill="${accent}"/>
        </g>`;
    case "iceknight":
      return `
        <g filter="url(#shadow)">
          <rect x="192" y="132" width="128" height="132" rx="30" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <polygon points="192,166 256,102 320,166" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(234, 278, 194, "#d8f8ff")}
          <rect x="214" y="258" width="84" height="92" rx="18" fill="${accent}" opacity="0.78"/>
          <rect x="218" y="346" width="24" height="70" rx="12" fill="${base}"/>
          <rect x="270" y="346" width="24" height="70" rx="12" fill="${base}"/>
          <rect x="342" y="190" width="18" height="158" rx="8" fill="#eef7ff"/>
          <polygon points="351,138 388,202 314,202" fill="${glow}" opacity="0.9"/>
        </g>`;
    case "priest":
      return `
        <g filter="url(#shadow)">
          <path d="M180 214 Q194 122 256 122 Q318 122 332 214 Q300 248 256 252 Q212 248 180 214 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(238, 276, 204, "#9ef089")}
          <path d="M190 388 L220 248 L292 248 L322 388 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <rect x="226" y="382" width="22" height="34" rx="10" fill="${accent}"/>
          <rect x="264" y="382" width="22" height="34" rx="10" fill="${accent}"/>
          <rect x="344" y="154" width="12" height="194" rx="6" fill="#c9b48e"/>
          <circle cx="350" cy="138" r="24" fill="${accent}" opacity="0.9"/>
          <path d="M334 138 H366 M350 122 V154" stroke="${glow}" stroke-width="6" stroke-linecap="round"/>
        </g>`;
    case "captain":
      return `
        <g filter="url(#shadow)">
          <rect x="176" y="132" width="160" height="150" rx="34" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <polygon points="180,170 256,96 332,170" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(228, 282, 206)}
          <rect x="206" y="272" width="100" height="104" rx="22" fill="${accent}" opacity="0.82"/>
          <rect x="214" y="370" width="26" height="46" rx="12" fill="${base}"/>
          <rect x="272" y="370" width="26" height="46" rx="12" fill="${base}"/>
          <path d="M146 188 L184 290 L146 392" fill="none" stroke="${accent}" stroke-width="18" stroke-linecap="round"/>
        </g>`;
    case "assassin":
      return `
        <g filter="url(#shadow)">
          <circle cx="256" cy="180" r="52" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(238, 276, 180, "#a5fff1")}
          <path d="M194 382 L222 246 L290 246 L318 382 Q286 352 256 352 Q226 352 194 382 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <rect x="222" y="376" width="22" height="40" rx="10" fill="${accent}"/>
          <rect x="268" y="376" width="22" height="40" rx="10" fill="${accent}"/>
          <line x1="176" y1="304" x2="120" y2="348" stroke="#eff6ff" stroke-width="12" stroke-linecap="round"/>
          <line x1="336" y1="304" x2="392" y2="348" stroke="#eff6ff" stroke-width="12" stroke-linecap="round"/>
        </g>`;
    case "spider":
      return `
        <g filter="url(#shadow)">
          <ellipse cx="256" cy="286" rx="84" ry="74" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <circle cx="256" cy="222" r="48" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(238, 274, 218)}
          ${eyes(224, 288, 238, "#baff8a")}
          <path d="M178 248 L104 196" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M174 286 L88 264" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M178 324 L106 376" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M334 248 L408 196" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M338 286 L424 264" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
          <path d="M334 324 L406 376" stroke="${base}" stroke-width="16" stroke-linecap="round"/>
        </g>`;
    case "berserker":
      return `
        <g filter="url(#shadow)">
          <circle cx="256" cy="178" r="52" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <path d="M204 152 L174 126 L198 184" fill="${accent}"/>
          <path d="M308 152 L338 126 L314 184" fill="${accent}"/>
          ${eyes(236, 278, 178)}
          <path d="M186 388 L212 236 L300 236 L326 388 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <rect x="220" y="382" width="22" height="36" rx="10" fill="${accent}"/>
          <rect x="270" y="382" width="22" height="36" rx="10" fill="${accent}"/>
          <line x1="336" y1="196" x2="396" y2="320" stroke="#e5dfd2" stroke-width="12" stroke-linecap="round"/>
          <line x1="398" y1="218" x2="342" y2="246" stroke="#e5dfd2" stroke-width="12" stroke-linecap="round"/>
        </g>`;
    case "darkwizard":
      return `
        <g filter="url(#shadow)">
          <path d="M186 202 Q204 116 256 116 Q308 116 326 202 Q292 238 256 240 Q220 238 186 202 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(238, 276, 194, "#ffb75e")}
          <path d="M184 392 L218 238 L294 238 L328 392 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <rect x="224" y="384" width="22" height="34" rx="10" fill="${accent}"/>
          <rect x="266" y="384" width="22" height="34" rx="10" fill="${accent}"/>
          <path d="M356 194 C388 146, 420 138, 424 166 C428 194, 398 210, 376 230 C360 246, 348 268, 342 290" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round"/>
          <circle cx="388" cy="166" r="28" fill="${glow}" opacity="0.9"/>
        </g>`;
    case "golem":
      return `
        <g filter="url(#shadow)">
          <circle cx="256" cy="170" r="58" fill="${base}" stroke="${accent}" stroke-width="8"/>
          ${eyes(236, 278, 170)}
          <rect x="176" y="222" width="160" height="122" rx="36" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <circle cx="160" cy="270" r="36" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <circle cx="352" cy="270" r="36" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <circle cx="202" cy="370" r="34" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <circle cx="310" cy="370" r="34" fill="${base}" stroke="${accent}" stroke-width="8"/>
        </g>`;
    case "general":
      return `
        <g filter="url(#shadow)">
          <rect x="182" y="132" width="148" height="142" rx="32" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <rect x="224" y="94" width="64" height="38" rx="8" fill="${accent}"/>
          <path d="M188 168 L256 104 L324 168" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <path d="M220 112 L196 82 M292 112 L316 82" stroke="${accent}" stroke-width="10" stroke-linecap="round"/>
          ${eyes(230, 282, 204)}
          <rect x="206" y="268" width="100" height="110" rx="22" fill="${accent}" opacity="0.8"/>
          <rect x="216" y="374" width="24" height="42" rx="10" fill="${base}"/>
          <rect x="272" y="374" width="24" height="42" rx="10" fill="${base}"/>
          <rect x="346" y="174" width="12" height="206" rx="6" fill="#e9ddd2"/>
          <path d="M358 176 L408 190 L358 212 Z" fill="${accent}"/>
        </g>`;
    case "demonking":
      return `
        <g filter="url(#shadow)">
          <circle cx="256" cy="170" r="60" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <path d="M214 150 L184 94 L238 138" fill="${accent}"/>
          <path d="M298 150 L328 94 L274 138" fill="${accent}"/>
          ${eyes(236, 278, 176, "#ffd36e")}
          <path d="M184 392 L212 230 L300 230 L328 392 Z" fill="${base}" stroke="${accent}" stroke-width="8"/>
          <path d="M168 230 Q118 250 112 312 Q154 302 184 332" fill="${accent}" opacity="0.85"/>
          <path d="M344 230 Q394 250 400 312 Q358 302 328 332" fill="${accent}" opacity="0.85"/>
          <rect x="222" y="384" width="22" height="34" rx="10" fill="${accent}"/>
          <rect x="268" y="384" width="22" height="34" rx="10" fill="${accent}"/>
        </g>`;
    default:
      return `<circle cx="256" cy="256" r="120" fill="${base}"/>`;
  }
}

function buildSvg(monster) {
  const [c1, c2, c3] = monster.colors;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  ${bg(monster.name, c1, c2, c3)}
  ${kindSvg(monster.kind, monster.colors)}
</svg>`;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017");
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");
  const col = db.collection("monsters");

  for (const monster of MONSTERS) {
    const fileName = `hard_${String(monster.seq).padStart(2, "0")}_${monster.kind}.svg`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(filePath, buildSvg(monster), "utf8");
    const imageUrl = `/uploads/monsters/${fileName}`;
    await col.updateOne(
      { zone: "hard", seq: monster.seq },
      {
        $set: {
          imageUrl,
          imageThumbnailUrl: imageUrl,
          updatedAt: new Date().toISOString(),
        },
      }
    );
    console.log(`updated hard seq=${monster.seq} ${monster.name} -> ${imageUrl}`);
  }

  await client.close();
  console.log("hard monster images generated and linked.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
