const fs = require('fs');
const path = require('path');

function expToNextLevel(level) {
  if (level <= 15) return Math.round(300 * Math.pow(level, 1.6));
  return Math.round(260 * Math.pow(level, 1.55));
}

let lines = [];
lines.push('# 等級經驗表（1–20 等）');
lines.push('');
lines.push('此表使用專案內 `expToNextLevel` 規則（16–20 為延伸曲線）。');
lines.push('');
lines.push('| 等級 | 升到下一等所需 EXP | 累積總 EXP（從 1 等起算） |');
lines.push('|------:|--------------------:|-------------------------:|');

let cumulative = 0;
for (let lvl = 1; lvl <= 20; lvl++) {
  const need = expToNextLevel(lvl);
  cumulative += need;
  lines.push(`| ${lvl} | ${need.toLocaleString()} | ${cumulative.toLocaleString()} |`);
}

lines.push('');
lines.push('> 備註：此表中「累積總 EXP」為每級所需經驗的累加，實際遊戲中顯示可能以當前等級起算剩餘經驗。');

const out = lines.join('\n');
const outPath = path.resolve(__dirname, '..', 'docs', 'EXP_TABLE.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf8');
console.log('Wrote', outPath);
