#!/usr/bin/env node

/**
 * 定時同步管理器：每小時自動同步本地 → 雲端 MongoDB
 *
 * 使用方式：
 *   node scripts/db-sync-scheduler.js
 *
 * 或用 npm script：
 *   npm run db:sync:start
 */

const cron = require('node-cron');
const { syncToCloud } = require('./sync-db-to-cloud');

// 每小時整點執行
const task = cron.schedule('0 * * * *', async () => {
  console.log('\n⏰ 定時同步觸發...');
  try {
    await syncToCloud();
  } catch (err) {
    console.error('❌ 定時同步失敗:', err.message);
  }
});

console.log('✅ 數據庫同步排程已啟動');
console.log('   頻率: 每小時整點執行');
console.log('   下次執行: ' + new Date(new Date().getTime() + 3600000).toLocaleString());
console.log('\n按 Ctrl+C 停止排程\n');

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n⛔ 停止同步排程...');
  task.stop();
  task.destroy();
  process.exit(0);
});

module.exports = { task };
