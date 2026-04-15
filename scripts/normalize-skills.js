const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, '..', '.vscode', 'prompts', 'skills');
const backupBase = path.join(base, 'backups');

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'backups') continue;
      results.push(...walk(full));
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      results.push(full);
    }
  }
  return results;
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function buildFrontmatter(folderName, description) {
  return `---\nname: ${slugify(folderName)}\ndescription: ${description || folderName}\nmetadata:\n  pattern: tool-wrapper\n  domain: equipmentgame\n---\n\n`;
}

function normalizeContent(original, folderName) {
  const lines = original.split(/\r?\n/);
  // Attempt to extract a short description from the original
  let shortDesc = folderName;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('**名稱**') || t.startsWith('名稱：')) continue;
    // take first meaningful line as description
    shortDesc = t.replace(/^\*\*?/g, '').slice(0, 120);
    break;
  }

  const fm = buildFrontmatter(folderName, shortDesc);

  const body = [];
  body.push('You are an expert. Follow these conventions when applicable.');
  body.push('\n## Core Conventions\n');
  body.push('- Purpose: Describe purpose for this skill.');
  body.push('- Trigger: When to apply this skill.');
  body.push('- Check rules / Steps: Concrete checklist or steps.');
  body.push('- Reject strategy / Exceptions: When to refuse or escalate.');
  body.push('- Audit: What to record and how.');
  body.push('\n## Implementation Notes\n');
  body.push('- Provide examples and code snippets ≤400 lines.');
  body.push('- Mention maintainer and change process.');
  body.push('\n## Maintainer\n');
  body.push('- Update owner: project maintainers.');
  body.push('\n## Original\n');
  body.push('> Original content preserved below for reference.');
  body.push('');
  body.push('```');
  body.push(original);
  body.push('```');

  return fm + body.join('\n') + '\n';
}

function main() {
  const files = walk(base);
  if (!files.length) {
    console.log('No SKILL.md files found.');
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of files) {
    const rel = path.relative(base, file);
    const folder = path.dirname(rel).split(path.sep).pop() || path.basename(path.dirname(file));
    const content = fs.readFileSync(file, 'utf8');

    // backup
    const bakDir = path.join(backupBase, path.dirname(rel));
    ensureDir(bakDir);
    const bakFile = path.join(bakDir, `SKILL.md.bak.${ts}`);
    fs.writeFileSync(bakFile, content, 'utf8');
    console.log('Backup written:', bakFile);

    // normalize
    const newContent = normalizeContent(content, folder);
    fs.writeFileSync(file, newContent, 'utf8');
    console.log('Rewrote:', file);
  }
  console.log('Normalization complete. Backups under', backupBase);
}

main();
