"use strict";
const { spawn, execSync } = require('child_process');
const path = require('path');

function restartPm2() {
  try {
    console.log('Restarting equipmentGAME via pm2...');
    execSync('pm2 restart equipmentGAME || pm2 start ecosystem.config.cjs --only equipmentGAME', { stdio: 'inherit' });
  } catch (e) {
    console.warn('pm2 command failed, ensure pm2 is installed and ecosystem.config.cjs is present');
  }
}

function startLocaltunnel(port = 5566, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    console.log('Starting localtunnel via npx...');
    const proc = spawn('npx', ['localtunnel', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });

    let resolved = false;
    const to = setTimeout(() => {
      if (!resolved) {
        reject(new Error('localtunnel did not return URL in time'));
        proc.kill();
      }
    }, timeoutMs);

    proc.stdout.on('data', (b) => {
      const s = b.toString();
      // localtunnel typically prints a line with the url
      const m = s.match(/https?:\/\/[^\s]+/);
      if (m && m[0]) {
        resolved = true;
        clearTimeout(to);
        const url = m[0].trim();
        console.log('localtunnel url ->', url);
        // leave process running (so tunnel stays alive)
        resolve({ url, proc });
      }
    });

    proc.stderr.on('data', (b) => {
      // swallow noisy output
      // console.error('lt stderr', b.toString());
    });

    proc.on('error', (err) => {
      if (!resolved) {
        clearTimeout(to);
        reject(err);
      }
    });
  });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  restartPm2();

  // start tunnel and get url
  let tunnel = null;
  try {
    tunnel = await startLocaltunnel(5566, 20000);
  } catch (e) {
    console.error('Failed to start localtunnel:', e.message || e);
    process.exit(1);
  }

  const apiUrl = tunnel.url;
  console.log('Publishing frontend using API URL:', apiUrl);

  // call publish script
  try {
    execSync(`node scripts/publish-frontend-local-api.js ${apiUrl}`, { cwd: repoRoot, stdio: 'inherit' });
  } catch (e) {
    console.error('publish script failed', e.message || e);
    // do not kill tunnel so site remains live
  }

  console.log('Autodeploy complete. Localtunnel process remains running; keep this script running to keep tunnel alive.');
  // Keep process alive so tunnel child keeps running
  process.stdin.resume();
}

main().catch((e) => { console.error(e); process.exit(1); });
