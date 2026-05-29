const fs = require('fs');
const path = process.argv[2];
const c = fs.readFileSync(path, 'utf8');
const lines = c.split('\n');
let depth = 0;
let inStr = false, strCh = '', inTpl = false, inLine = false, inBlock = false, esc = false;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  inLine = false;
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (esc) { esc = false; continue; }
    if (inBlock) { if (ch === '*' && line[j + 1] === '/') { inBlock = false; j++; } continue; }
    if (inLine) continue;
    if (inStr) {
      if (ch === '\\') { esc = true; continue; }
      if (ch === strCh) inStr = false;
      continue;
    }
    if (inTpl) {
      if (ch === '\\') { esc = true; continue; }
      if (ch === '`') inTpl = false;
      continue;
    }
    if (ch === '/' && line[j + 1] === '/') { inLine = true; continue; }
    if (ch === '/' && line[j + 1] === '*') { inBlock = true; j++; continue; }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === '`') { inTpl = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) { console.log('NEG at line', i + 1); process.exit(0); }
    }
  }
}
console.log('final depth:', depth);
