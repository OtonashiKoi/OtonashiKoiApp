/**
 * 一鍵開服神器 (Launch Home)
 * 作用：更新網址 -> 同步 GitHub -> 重啟 PM2
 * 使用方式：npm run home <您的隧道網址>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const newUrl = process.argv[2];

if (!newUrl) {
  console.error('❌ 錯誤：請提供新的隧道網址！');
  console.log('用法範例：npm run home https://xxxx.ngrok-free.app');
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const configPath = path.join(rootDir, 'player-web/src/config.json');

console.log('🚀 [1/3] 正在更新前端 API 網址...');
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.remoteApiUrl = newUrl;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(`   ✅ 網址已更新為: ${newUrl}`);
} catch (err) {
  console.error('   ❌ 更新 config.json 失敗:', err.message);
  process.exit(1);
}

console.log('🚀 [2/3] 正在同步到全新 GitHub 倉庫...');
try {
  execSync('git add .', { cwd: rootDir, stdio: 'inherit' });
  // 使用 --allow-empty 以防網址沒變時 Commit 失敗
  execSync(`git commit -m "Auto-Deploy: update home hosting URL to ${newUrl}" --allow-empty`, { cwd: rootDir, stdio: 'inherit' });
  execSync('git push origin master', { cwd: rootDir, stdio: 'inherit' });
  console.log('   ✅ GitHub 同步完成！');
} catch (err) {
  console.error('   ❌ GitHub 推送失敗，請確認網路或 GitHub 權限。');
  // 繼續執行 PM2，因為本地端可能還是要跑
}

console.log('🚀 [3/3] 正在透過 PM2 重啟後端伺服器...');
try {
  // 嘗試重啟名為 equipmentGAME 的進程
  execSync('pm2 restart equipmentGAME', { cwd: rootDir, stdio: 'inherit' });
  console.log('   ✅ PM2 伺服器已成功重啟！');
} catch (err) {
  console.log('   ⚠️  PM2 重啟失敗 (可能進程尚未建立)，嘗試啟動新進程...');
  try {
    execSync('pm2 start src/server.js --name equipmentGAME', { cwd: rootDir, stdio: 'inherit' });
    console.log('   ✅ PM2 伺服器已啟動！');
  } catch (err2) {
    console.error('   ❌ PM2 啟動失敗，請手動檢查。');
  }
}

console.log('\n✨ 全自動開服完成！玩家現在可以透過網頁連線了。');
