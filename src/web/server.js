const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { getProfile, getPanelData, topByPower, openChest, fightMonster } = require("../core/userService");

// Session 儲存（生產環境應使用 Redis 或數據庫）
const gameSessions = new Map();

// 創建遊戲 Session
function createGameSession(discordId, username, avatarUrl) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const session = {
    sessionId,
    discordId,
    username,
    avatarUrl,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4小時過期
  };
  
  gameSessions.set(sessionId, session);
  
  // 清理過期 session
  setTimeout(() => {
    gameSessions.delete(sessionId);
  }, 4 * 60 * 60 * 1000);
  
  return sessionId;
}

// 驗證 Session
function validateSession(sessionId) {
  const session = gameSessions.get(sessionId);
  if (!session) return null;
  
  if (new Date() > session.expiresAt) {
    gameSessions.delete(sessionId);
    return null;
  }
  
  return session;
}

function createWebServer() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "equipment-game", time: new Date().toISOString() });
  });

  // 主頁面
  app.get("/", (_req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="zh-TW">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🎮 裝備遊戲 - Equipment Game</title>
        <style>
          body {
            font-family: 'Microsoft JhengHei', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-align: center;
            padding: 50px 20px;
            margin: 0;
            min-height: 100vh;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 40px;
          }
          h1 { font-size: 3em; margin-bottom: 20px; }
          .feature {
            background: rgba(255,255,255,0.1);
            padding: 15px;
            margin: 10px 0;
            border-radius: 10px;
            text-align: left;
          }
          .discord-link {
            background: #5865F2;
            color: white;
            padding: 15px 30px;
            border-radius: 10px;
            text-decoration: none;
            display: inline-block;
            margin-top: 20px;
            font-weight: bold;
          }
          .status {
            background: #10B981;
            padding: 10px;
            border-radius: 5px;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎮 裝備遊戲</h1>
          <div class="status">✅ 服務器運行中</div>
          
          <div class="feature">
            <h3>🔒 私密遊戲體驗</h3>
            <p>創建專屬於你的私人遊戲討論串</p>
          </div>
          
          <div class="feature">
            <h3>🌐 雙重平台體驗</h3>
            <p>Discord + Web 雙重遊戲介面</p>
          </div>
          
          <div class="feature">
            <h3>✨ 豪華特效</h3>
            <p>Web版本擁有豐富的視覺特效</p>
          </div>
          
          <div class="feature">
            <h3>📦 裝備系統</h3>
            <p>開寶箱、收集裝備、提升戰力</p>
          </div>
          
          <p style="margin-top: 30px;">
            <strong>如何開始？</strong><br>
            在Discord中使用 <code>/裝備啟動</code> 指令
          </p>
        </div>
      </body>
      </html>
    `);
  });

  // 創建遊戲 Session API
  app.post("/api/create-session", (req, res) => {
    const { discordId, username, avatarUrl } = req.body;
    
    if (!discordId || !username) {
      return res.status(400).json({ error: "缺少必要參數" });
    }
    
    const sessionId = createGameSession(discordId, username, avatarUrl);
    res.json({ sessionId, gameUrl: `/game?session=${sessionId}` });
  });

  // 遊戲頁面
  app.get("/game", (req, res) => {
    const sessionId = req.query.session;
    const session = validateSession(sessionId);
    
    if (!session) {
      return res.status(401).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 100px;">
            <h1>🚫 無效或過期的遊戲連結</h1>
            <p>請在 Discord 中使用 <code>/裝備啟動</code> 重新開啟遊戲</p>
          </body>
        </html>
      `);
    }
    
    res.sendFile(path.join(__dirname, "public", "game.html"));
  });

  // Session 驗證的 API 路由
  app.get("/api/game-data/:sessionId", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = validateSession(sessionId);
    
    if (!session) {
      return res.status(401).json({ error: "無效 session" });
    }

    try {
      const panelData = await getPanelData(session.discordId, session.username);
      res.json({
        ...panelData,
        session: {
          username: session.username,
          avatarUrl: session.avatarUrl
        },
        avatarUrl: session.avatarUrl
      });
    } catch (error) {
      console.error('獲取遊戲數據失敗:', error);
      res.status(500).json({ error: "獲取數據失敗" });
    }
  });

  app.get("/api/session/:sessionId/panel", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = validateSession(sessionId);
    
    if (!session) {
      return res.status(401).json({ error: "無效 session" });
    }
    
    const panelData = await getPanelData(session.discordId, session.username);
    res.json({ ...panelData, session: { username: session.username, avatarUrl: session.avatarUrl } });
  });

  app.post("/api/session/:sessionId/reload", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = validateSession(sessionId);
    
    if (!session) {
      return res.status(401).json({ error: "無效 session" });
    }
    
    try {
      const panelData = await getPanelData(session.discordId, session.username);
      res.json({ 
        ...panelData, 
        session: { username: session.username, avatarUrl: session.avatarUrl } 
      });
    } catch (error) {
      console.error('重新載入失敗:', error);
      res.status(500).json({ success: false, message: "重新載入失敗" });
    }
  });

  app.post("/api/session/:sessionId/open-chest", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = validateSession(sessionId);
    
    if (!session) {
      return res.status(401).json({ error: "無效 session" });
    }
    
    try {
      const result = await openChest(session.discordId, session.username);
      let message = "";
      
      if (!result.ok) {
        message = "金幣不足！開箱需要 35 金幣";
      } else if (result.upgraded) {
        message = `裝備升級成功！獲得 ${result.item.name}`;
      } else {
        message = `獲得 ${result.item.name}，但沒有超過現有裝備`;
      }
      
      res.json({ 
        success: result.ok,
        message,
        result
      });
    } catch (error) {
      console.error('開寶箱失敗:', error);
      res.status(500).json({ success: false, message: "開寶箱失敗" });
    }
  });

  app.post("/api/session/:sessionId/fight", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = validateSession(sessionId);
    
    if (!session) {
      return res.status(401).json({ error: "無效 session" });
    }
    
    const result = await fightMonster(session.discordId, session.username);
    const panelData = await getPanelData(session.discordId, session.username);
    res.json({ 
      action: "fight", 
      result, 
      panelData: { 
        ...panelData, 
        session: { username: session.username, avatarUrl: session.avatarUrl } 
      } 
    });
  });

  // 原有的API路由（向後兼容）
  app.get("/api/profile/:discordId", async (req, res) => {
    const discordId = req.params.discordId;
    const profile = await getProfile(discordId, `user-${discordId.slice(0, 6)}`);
    res.json(profile);
  });

  app.get("/api/leaderboard", async (req, res) => {
    const limit = Number(req.query.limit || 10);
    const rows = await topByPower(limit);
    res.json({ rows });
  });

  app.get("/api/panel/:discordId", async (req, res) => {
    const discordId = req.params.discordId;
    const panelData = await getPanelData(discordId, `user-${discordId.slice(0, 6)}`);
    res.json(panelData);
  });

  app.post("/api/panel/:discordId/open-chest", async (req, res) => {
    const discordId = req.params.discordId;
    const result = await openChest(discordId, `user-${discordId.slice(0, 6)}`);
    const panelData = await getPanelData(discordId, `user-${discordId.slice(0, 6)}`);
    res.json({ action: "open-chest", result, panelData });
  });

  app.post("/api/panel/:discordId/fight", async (req, res) => {
    const discordId = req.params.discordId;
    const result = await fightMonster(discordId, `user-${discordId.slice(0, 6)}`);
    const panelData = await getPanelData(discordId, `user-${discordId.slice(0, 6)}`);
    res.json({ action: "fight", result, panelData });
  });

  app.get("/panel/:discordId", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "panel.html"));
  });

  return app;
}

module.exports = {
  createWebServer,
  createGameSession,
  validateSession
};
