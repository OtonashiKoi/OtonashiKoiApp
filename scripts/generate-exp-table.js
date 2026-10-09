const fs = require('fs');
const path = require('path');
const { MAX_LEVEL, expToNextLevel } = require('../src/shared/progression');

let lines = [];
lines.push('# 經驗值表（由 src/shared/progression.js 自動生成）');
lines.push('');
lines.push('- MAX_LEVEL = 50；1→50共41,425,282 EXP。2026/10/5核定提案統一乘1.5423183302743138，逐級四捨五入。');
lines.push('- 約43.7小時僅為單人、無加成、每隻含交接20秒及換到對應區域的情境估算，非實測養成時間。');
lines.push('- 重產方式：`node scripts/generate-exp-table.js`');
lines.push('');
lines.push('| 等級 | 升下一級所需 EXP | 累計 EXP |');
lines.push('|---|---:|---:|');

let cumulative = 0;
for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
  const need = expToNextLevel(lvl);
  cumulative += need;
  lines.push(`| ${lvl} → ${lvl + 1} | ${need.toLocaleString()} | ${cumulative.toLocaleString()} |`);
}

const out = `${lines.join('\n')}\n`;
const outPath = path.resolve(__dirname, '..', 'docs', 'EXP_TABLE.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf8');
console.log('Wrote', outPath);
