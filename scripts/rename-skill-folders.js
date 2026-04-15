const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', '.vscode', 'prompts', 'skills');

function slugify(name) {
  return name
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\-\s]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function makeFallbackSlug(name) {
  const hex = Buffer.from(name).toString('hex');
  return `sk-${hex.slice(0,12)}`;
}

function readFrontmatterName(skillPath) {
  const f = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(f)) return null;
  const content = fs.readFileSync(f, 'utf8');
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = content.slice(3, end + 1).trim();
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^name:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return null;
}

function listDirs() {
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(n => n !== 'backups' && n !== 'backups-full');
}

function main() {
  const dirs = listDirs();
  const moved = [];
  for (const dir of dirs) {
    const curPath = path.join(base, dir);
    const fmName = readFrontmatterName(curPath);
    const desiredSource = fmName && fmName.length ? fmName : dir;
    let desired = slugify(desiredSource);
    if (!desired || desired.length === 0) {
      desired = makeFallbackSlug(desiredSource);
    }
    if (desired === dir) continue;
    const targetPath = path.join(base, desired);
    if (fs.existsSync(targetPath)) {
      console.error('Target exists, skipping:', targetPath);
      continue;
    }
    fs.renameSync(curPath, targetPath);
    moved.push({ from: dir, to: desired });
    console.log(`Renamed: ${dir} -> ${desired}`);
  }
  console.log('Rename complete. Moved items:', moved.length);
}

main();
