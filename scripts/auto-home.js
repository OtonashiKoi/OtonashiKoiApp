/**
 * 終極懶人開服腳本 (Auto Home)
 * 作用：自動啟動隧道 -> 自動同步 GitHub -> 自動重啟 PM2
 * 使用方式：npm run auto-home
 */

const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.join(__dirname, '..');

console.log('🌐 [1/4] 正在啟動自動化隧道 (Localtunnel)...');

// 啟動 localtunnel
const lt = spawn('npx', ['lt', '--port', '5566'], { shell: true, cwd: rootDir });

let urlFound = false;

lt.stdout.on('data', (data) => {
  const output = data.toString();
  console.log(`   📡 [Tunnel]: ${output.trim()}`);

  // 搜尋 https://xxxx.loca.lt 格式的網址
  const match = output.match(/https:\/\/[^\s]+/);
  if (match && !urlFound) {
    const tunnelUrl = match[0];
    urlFound = true;
    console.log(`\n✅ 成功取得隧道網址: ${tunnelUrl}`);
    
    startSync(tunnelUrl);
  }
});

lt.stderr.on('data', (data) => {
  console.error(`   ⚠️  [Tunnel Error]: ${data}`);
});

lt.on('close', (code) => {
  console.log(`\n🛑 隧道已關閉 (Code: ${code})`);
  process.exit(code);
});

/**
 * 執行同步與啟動
 */
function startSync(url) {
  console.log('🚀 [2/4] 正在啟動自動化同步連鎖...');
  
  // 呼叫我們之前寫好的 launch-home.js
  const sync = spawn('node', ['scripts/launch-home.js', url], { 
    stdio: 'inherit', 
    shell: true,
    cwd: rootDir 
  });

  sync.on('close', (code) => {
    if (code === 0) {
      console.log('\n✨ [4/4] 全自動開服程序已圓滿完成！');
      console.log('📢 玩家可以連線了。請維持此視窗開啟以保持連線。');
    } else {
      console.error(`\n❌ 同步程序出錯 (Code: ${code})，但隧道仍維持開啟。`);
    }
  });
}
