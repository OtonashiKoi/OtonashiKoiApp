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

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'backups') continue;
      const skill = path.join(full, 'SKILL.md');
      if (fs.existsSync(skill)) results.push({ skill, folderName: entry.name });
      else results.push(...walk(full));
    }
  }
  return results;
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = content.slice(3, end + 1).trim();
  const rest = content.slice(end + 4);
  const obj = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_\-]+):\s*(.*)$/);
    if (m) obj[m[1]] = m[2];
  }
  return { fmRaw: fm, fmObj: obj, rest };
}

function buildFrontmatter(obj) {
  let out = '---\n';
  for (const k of Object.keys(obj)) {
    out += `${k}: ${obj[k]}\n`;
  }
  out += '---\n\n';
  return out;
}

function main() {
  const items = walk(base);
  if (!items.length) return console.log('No SKILL.md found');
  const changed = [];
  for (const it of items) {
    const content = fs.readFileSync(it.skill, 'utf8');
    const parsed = parseFrontmatter(content);
    let rest = content;
    let fm = {};
    if (parsed) {
      fm = parsed.fmObj;
      rest = parsed.rest;
    }
    const desiredName = slugify(it.folderName);
    const desiredDesc = it.folderName;
    let updated = false;
    if (fm.name !== desiredName) {
      fm.name = desiredName;
      updated = true;
    }
    if (!fm.description || fm.description !== desiredDesc) {
      fm.description = desiredDesc;
      updated = true;
    }
    if (updated) {
      const newContent = buildFrontmatter(fm) + rest.trimStart();
      fs.writeFileSync(it.skill, newContent, 'utf8');
      changed.push(it.skill);
      console.log('Updated:', it.skill);
    }
  }
  console.log('Done. Files changed:', changed.length);
}

main();
