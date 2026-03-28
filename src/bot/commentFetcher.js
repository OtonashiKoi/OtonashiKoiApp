const WebSocket = require('ws');

const ONECOMME_WS_URL = 'ws://127.0.0.1:11180/sub'; // 嘗試使用 /sub

function startFetcher() {
  console.log('[OneComme] 正在嘗試連線至:', ONECOMME_WS_URL);
  
  const ws = new WebSocket(ONECOMME_WS_URL);

  ws.on('open', () => {
    console.log('[OneComme] 🟢 連線成功！正在等待留言推播...');
  });

ws.on('message', (rawData) => {
    try {
      const payload = JSON.parse(rawData);
      
      if (payload.type === 'comments' && payload.data && Array.isArray(payload.data.comments)) {
        payload.data.comments.forEach(c => {
          // 根據你提供的資料結構：c.data 直接包含了所有資訊
          const d = c.data; 
          
          if (d) {
            const name = d.displayName || d.name || '未知用戶';
            const text = d.comment || ''; // 這裡 d.comment 直接就是字串

            // 如果是 V-tuber 身份 (音無戀 / Kotona) 想要做特殊反應，可以在這加判斷
            // if (text.includes('草')) console.log('>>> 偵測到笑聲');
          }
        });
      }
    } catch (err) {
      // 忽略心跳包或格式錯誤
    }
  });

  ws.on('error', (err) => {
    console.error('[OneComme] 🔴 連線錯誤:', err.message);
    if (err.message.includes('404')) {
        console.log('提示: 請檢查 OneComme 軟體內的 "WebSocket URL" 到底是什麼路徑。');
    }
  });

  ws.on('close', () => {
    console.log('[OneComme] 🟡 連線中斷，5 秒後嘗試重連...');
    setTimeout(startFetcher, 5000);
  });
}

startFetcher();