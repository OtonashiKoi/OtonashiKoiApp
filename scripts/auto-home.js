/**
 * 終極懶人開服腳本 (Auto Home) v2.0
 * 作用：直接調用 localtunnel 庫，確保連線穩定不中斷
 */

const localtunnel = require('localtunnel');
const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.join(__dirname, '..');

(async () => {
  console.log('🌐 [1/4] 正在啟動內嵌式隧道 (Localtunnel)...');

  try {
    // 直接調用 library 而不是 spawn 指令
    const tunnel = await localtunnel({ port: 5566 });

    console.log(`\n✅ 成功取得隧道網址: ${tunnel.url}`);
    console.log(`📢 玩家連線網址: ${tunnel.url}`);
    
    // 監聽關閉事件
    tunnel.on('close', () => {
      console.log('\n🛑 隧道已關閉，請重啟腳本以恢復連線。');
      process.exit(0);
    });

    // 啟動同步連鎖
    startSync(tunnel.url);

  } catch (err) {
    console.error('❌ 啟動隧道失敗:', err.message);
    process.exit(1);
  }
})();

function startSync(url) {
  console.log('🚀 [2/4] 正在啟動自動化同步連鎖...');
  
  const sync = spawn('node', ['scripts/launch-home.js', url], { 
    stdio: 'inherit', 
    shell: true,
    cwd: rootDir 
  });

  sync.on('close', (code) => {
    if (code === 0) {
      console.log('\n✨ [4/4] 全自動開服程序已圓滿完成！');
      console.log('📢 伺服器運作中。請維持此視窗開啟以保持連線。');
      console.log('💡 若要停止服務，請按下 Ctrl+C。');

      // 強制程序保持運行，不讓它退出
      setInterval(() => {
        // 每小時印一點東西，確保您知道它還活著
      }, 1000 * 60 * 60);
    } else {
      console.error(`\n❌ 同步程序出錯 (Code: ${code})，但隧道仍維持開啟供您檢查。`);
    }
  });
}
