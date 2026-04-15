const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', '.vscode', 'prompts', 'skills');
const indexFile = path.join(base, 'SKILLS_INDEX.md');

function readDescription(skillPath) {
  const f = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(f)) return '';
  const content = fs.readFileSync(f, 'utf8');
  if (!content.startsWith('---')) return '';
  const end = content.indexOf('\n---', 3);
  if (end === -1) return '';
  const rest = content.slice(end + 4);
  const lines = rest.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines[0] || '';
}

function listSkillDirs() {
  return fs.readdirSync(base)
    .filter(name => {
      if (name === 'backups' || name === 'backups-full') return false;
      try { return fs.statSync(path.join(base, name)).isDirectory(); } catch (e) { return false; }
    });
}

function buildIndex() {
  const header = '# SKILL 總覽\n\n此目錄包含專案共用的 Agent SKILL，每個 SKILL 為一個資料夾，內含 `SKILL.md`.\n\n';
  const dirs = listSkillDirs().sort((a,b)=> a.localeCompare(b,'zh-Hant'));
  const lines = [header];
  for (const d of dirs) {
    const desc = readDescription(path.join(base, d)) || d;
    const link = `/.vscode/prompts/skills/${encodeURIComponent(d)}/SKILL.md`;
    lines.push(`- **${d}**：${desc}  \n  路徑：[.vscode/prompts/skills/${encodeURIComponent(d)}/SKILL.md](.vscode/prompts/skills/${encodeURIComponent(d)}/SKILL.md)`);
    lines.push('');
  }
  fs.writeFileSync(indexFile, lines.join('\n'), 'utf8');
  console.log('Wrote SKILLS_INDEX.md with', dirs.length, 'entries');
}

buildIndex();
