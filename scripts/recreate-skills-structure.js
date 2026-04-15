const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', '.vscode', 'prompts', 'skills');
const backup = path.join(base, 'backups-full');
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
ensureDir(backup);

function slugify(name) {
  return name
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function readFrontmatter(file) {
  if (!fs.existsSync(file)) return {};
  const s = fs.readFileSync(file, 'utf8');
  if (!s.startsWith('---')) return {};
  const end = s.indexOf('\n---', 3);
  if (end === -1) return {};
  const fm = s.slice(3, end+1).trim();
  const obj = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) obj[m[1].trim()] = m[2].trim();
  }
  const rest = s.slice(end+4);
  return { fm: obj, body: rest };
}

function makeSkillContent(slug, desc, original) {
  const fm = ['---', `name: ${slug}`, `description: ${desc}`, 'metadata:', '  pattern: tool-wrapper', '  domain: equipmentgame', '---', ''].join('\n');
  const body = [];
  body.push(`You are an expert in ${desc}.`);
  body.push('');
  body.push('## Purpose');
  body.push(`- ${desc} 的標準與檢查清單。`);
  body.push('');
  body.push('## Trigger');
  body.push('- 當變更可能影響遊戲內容、後台或 database schema 時。');
  body.push('');
  body.push('## Check Rules');
  body.push('- 列出變更範圍、搜尋 repo 引用、檢查前端/後端/DB/資產。');
  body.push('- 確保 adminActionLogs 有紀錄、並提供 migration/backfill。');
  body.push('');
  body.push('## Reject Strategy');
  body.push('- 若發現未授權 collection、缺失遷移或前端支持，拒絕合併並說明修正步驟。');
  body.push('');
  body.push('## Audit');
  body.push('- 每次變更應產生可查詢的稽核紀錄（adminActionLogs）。');
  body.push('');
  body.push('## Implementation Notes');
  body.push('- 提供搜尋範例命令與 migration 範本，並在 staging 驗證。');
  body.push('');
  body.push('## Maintainer');
  body.push('- 專案維護者');
  body.push('');
  if (original && original.trim()) {
    body.push('## Original');
    body.push('```');
    body.push(original.trim());
    body.push('```');
    body.push('');
  }
  return fm + body.join('\n');
}

function listSkillDirs() {
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(n => n !== 'backups' && n !== 'backups-full');
}

function run() {
  const dirs = listSkillDirs();
  const created = [];
  for (const d of dirs) {
    const skillPath = path.join(base, d);
    const skillFile = path.join(skillPath, 'SKILL.md');
    const origContent = fs.existsSync(skillFile) ? fs.readFileSync(skillFile,'utf8') : '';
    // backup
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    const bakDir = path.join(backup, d);
    ensureDir(bakDir);
    fs.writeFileSync(path.join(bakDir, `SKILL.md.bak.${ts}`), origContent, 'utf8');

    const parsed = readFrontmatter(skillFile);
    const desc = parsed.fm && parsed.fm.description ? parsed.fm.description : d;
    const slug = slugify(desc) || ('sk-'+Buffer.from(d).toString('hex').slice(0,12));

    const targetDir = path.join(base, slug);
    ensureDir(targetDir);
    const newContent = makeSkillContent(slug, desc, origContent);
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), newContent, 'utf8');
    created.push(slug);
    console.log('Created skill:', slug);
  }
  // regenerate index
  try { require('./gen-skills-index'); } catch (e) { console.error('gen index failed', e.message); }
  console.log('Recreation complete. Backups under', backup);
}

run();
