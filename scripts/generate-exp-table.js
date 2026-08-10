const fs = require('fs');
const path = require('path');
const { MAX_LEVEL, expToNextLevel } = require('../src/shared/progression');

let lines = [];
lines.push('# 經驗值表（由 src/shared/progression.js 自動生成）');
lines.push('');
lines.push('- MAX_LEVEL = 50；Lv40→41 至 Lv49→50 的需求套用後段倍率 ×1.3');
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
