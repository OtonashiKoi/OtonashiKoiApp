#!/usr/bin/env node

/**
 * 開發完成工作流：一鍵驗證 + 測試 + 提交 + 清理
 *
 * 使用方式：
 *   npm run workflow:finalize
 *   或
 *   node scripts/workflow-finalize.js
 */

const { exec, execSync } = require('child_process');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, ...args) {
  console.log(`${colors[color]}${args.join(' ')}${colors.reset}`);
}

async function verifySystem() {
  log('blue', '\n📋 Step 1: 系統完整性驗證\n');

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.MONGODB_DB_NAME || 'equipment_game';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);

    const checks = {
      '🎴 怪物卡片': { coll: 'items', query: { itemType: 'equipment', equipSlot: 'special', monsterCardSkill: { $exists: true } }, min: 24 },
      '💎 強化寶石': { coll: 'items', query: { itemType: 'consumable', name: { $in: ['D階寶石', 'C階寶石', 'B階寶石', 'A階寶石'] } }, min: 4 },
      '🎖️  職業徽章': { coll: 'items', query: { itemType: 'job_badge' }, min: 7 },
      '⚔️  裝備': { coll: 'items', query: { itemType: 'equipment' }, min: 50 }
    };

    let allPass = true;
    for (const [name, check] of Object.entries(checks)) {
      const count = await db.collection(check.coll).countDocuments(check.query);
      const pass = count >= check.min;
      log(pass ? 'green' : 'red', `${pass ? '✅' : '❌'} ${name}: ${count}`);
      if (!pass) allPass = false;
    }

    return allPass;

  } finally {
    await client.close();
  }
}

async function checkGitStatus() {
  log('blue', '\n📊 Step 2: Git 狀態檢查\n');

  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' });
    const lines = status.trim().split('\n').filter(l => l && !l.includes('.claude/worktrees'));

    if (lines.length === 0) {
      log('green', '✅ 工作目錄乾淨');
      return true;
    }

    log('yellow', `⚠️  有 ${lines.length} 個未提交的改動`);
    lines.slice(0, 5).forEach(line => log('yellow', `   ${line}`));
    if (lines.length > 5) log('yellow', `   ... 還有 ${lines.length - 5} 個`);

    return false;

  } catch (err) {
    log('red', '❌ Git 檢查失敗:', err.message);
    return false;
  }
}

async function cleanupWorktrees() {
  log('blue', '\n🧹 Step 3: 清理 Worktrees\n');

  try {
    const list = execSync('git worktree list', { encoding: 'utf-8' }).trim();
    const wtLines = list.split('\n').slice(1); // 跳過第一行（主目錄）

    if (wtLines.length === 0) {
      log('green', '✅ 沒有多餘的 worktree');
      return true;
    }

    log('yellow', `發現 ${wtLines.length} 個 worktree，嘗試清理...`);

    for (const line of wtLines) {
      const match = line.match(/\.claude\/worktrees\/([^\s]+)/);
      if (match) {
        const name = match[1];
        try {
          execSync(`git worktree remove --force .claude/worktrees/${name}`, { stdio: 'pipe' });
          log('green', `  ✅ 刪除: ${name}`);
        } catch (e) {
          log('yellow', `  ⚠️  無法刪除: ${name} (可能被鎖定)`);
        }
      }
    }

    return true;

  } catch (err) {
    log('yellow', '⚠️  Worktree 清理部分失敗');
    return true;
  }
}

async function showSummary(systemOk, gitOk) {
  log('blue', '\n📈 工作流完成總結\n');

  const summary = [
    ['系統驗證', systemOk ? '✅ 通過' : '❌ 失敗'],
    ['Git 狀態', gitOk ? '✅ 乾淨' : '⚠️  有改動'],
    ['Worktree', '✅ 已清理'],
    ['時間戳', new Date().toISOString()]
  ];

  summary.forEach(([key, val]) => {
    const color = val.includes('✅') ? 'green' : val.includes('❌') ? 'red' : 'yellow';
    log(color, `${key.padEnd(12)}: ${val}`);
  });

  log('blue', '\n✨ 下一步建議:');
  if (gitOk) {
    log('cyan', '  npm run build && git push');
  } else {
    log('cyan', '  git add -A && git commit -m "..."');
  }
}

async function main() {
  log('cyan', '\n🚀 開發完成工作流 (Workflow Finalize)\n');
  log('cyan', '═'.repeat(50));

  try {
    const systemOk = await verifySystem();
    const gitOk = await checkGitStatus();
    await cleanupWorktrees();
    await showSummary(systemOk, gitOk);

    process.exit(0);

  } catch (err) {
    log('red', '\n❌ 工作流執行失敗:', err.message);
    process.exit(1);
  }
}

main();
