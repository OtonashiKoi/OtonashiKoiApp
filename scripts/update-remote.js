/**
 * 自動化更新腳本：更新前端 API 網址並推送到 GitHub
 * 使用方式：node scripts/update-remote.js <您的隧道網址>
 * 例如：node scripts/update-remote.js https://xxxx.ngrok-free.app
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const newUrl = process.argv[2];

if (!newUrl) {
  console.error('❌ 錯誤：請提供新的隧道網址！');
  console.log('用法範例：node scripts/update-remote.js https://xxxx.ngrok-free.app');
  process.exit(1);
}

// 1. 修改 config.json
const configPath = path.join(__dirname, '../player-web/src/config.json');
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.remoteApiUrl = newUrl;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(`✅ 已更新 API 網址為: ${newUrl}`);
} catch (err) {
  console.error('❌ 無法更新 config.json:', err.message);
  process.exit(1);
}

// 2. 執行 Git 操作
try {
  console.log('⏳ 正在同步到 GitHub...');
  execSync('git add player-web/src/config.json', { stdio: 'inherit' });
  execSync(`git commit -m "Update: frontend remote API URL to ${newUrl}"`, { stdio: 'inherit' });
  execSync('git push origin master', { stdio: 'inherit' });
  console.log('🚀 同步完成！外網玩家現在可以使用新網址連線了。');
} catch (err) {
  console.error('❌ Git 操作失敗，請檢查網路或權限。');
  process.exit(1);
}
