const fs = require('fs');
const path = process.argv[2];
const c = fs.readFileSync(path, 'utf8');
let depth = 0;
let inStr = false, strCh = '', inTpl = false, inLine = false, inBlock = false, esc = false;
let line = 1, col = 0;
const stack = [];
for (let j = 0; j < c.length; j++) {
  const ch = c[j];
  if (ch === '\n') { line++; col = 0; inLine = false; continue; }
  col++;
  if (esc) { esc = false; continue; }
  if (inBlock) { if (ch === '*' && c[j + 1] === '/') { inBlock = false; j++; } continue; }
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
  if (ch === '/' && c[j + 1] === '/') { inLine = true; continue; }
  if (ch === '/' && c[j + 1] === '*') { inBlock = true; j++; continue; }
  if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
  if (ch === '`') { inTpl = true; continue; }
  if (ch === '{') { depth++; stack.push({ line, col }); }
  else if (ch === '}') {
    depth--;
    if (stack.length === 0) { console.log('NEG at', line, col); process.exit(0); }
    stack.pop();
  }
}
console.log('final depth:', depth);
console.log('unclosed opens:');
for (const s of stack) console.log('  line', s.line, 'col', s.col);
