"use strict";
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dest)) execSync(`rm -rf ${dest}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function main() {
  const apiUrl = process.argv[2];
  if (!apiUrl) {
    console.error('Usage: node scripts/publish-frontend-local-api.js <API_URL>');
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, '..');
  const webDir = path.join(repoRoot, 'player-web');
  const configPath = path.join(webDir, 'src', 'config.json');

  // update config.json
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  cfg.remoteApiUrl = apiUrl;
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
  console.log('Updated player-web/src/config.json ->', apiUrl);

  // build frontend
  console.log('Building player-web...');
  execSync('npm ci --silent', { cwd: webDir, stdio: 'inherit' });
  execSync('npm run build', { cwd: webDir, stdio: 'inherit' });

  // copy dist to docs/
  const distDir = path.join(webDir, 'dist');
  const docsDir = path.join(repoRoot, 'docs');
  console.log('Copying build to docs/');
  copyDir(distDir, docsDir);

  // commit and push
  try {
    execSync('git add docs player-web/src/config.json', { cwd: repoRoot, stdio: 'inherit' });
    execSync(`git commit -m "chore: publish frontend (API=${apiUrl})"`, { cwd: repoRoot, stdio: 'inherit' });
  } catch (e) {
    console.log('No changes to commit or commit failed.');
  }
  console.log('Pushing to remote...');
  execSync('git push', { cwd: repoRoot, stdio: 'inherit' });

  console.log('Publish complete. If GitHub Pages is set to serve from branch `main` / `docs` folder, the site will update shortly.');
}

main().catch((e) => { console.error(e); process.exit(1); });
