# equipmentGAME 新機器完整部署指南

> 適用情境：把整個 stack（Discord Bot + API + MongoDB + Web）從目前機器搬到另一台電腦。
> 預估時間：1-2 小時（含資料庫遷移）

---

## 0. 部署架構總覽

```
新機器（Windows / Linux）
├── Node.js 20+
├── MongoDB Community 7.0+         ← 資料庫
├── PM2                             ← Process manager
├── Cloudflared                     ← 對外網域 tunnel
├── equipmentGAME/                  ← 主 repo（Bot + API）
└── equipmentGAME-app/              ← Web 前端 repo
```

對外服務：
- `https://otonashikoi.org/api/*` → 本機 `localhost:5566`（Express）
- `https://otonashikoi.org/admin/*` → 本機 `localhost:5566`（後台）
- `https://otonashikoi.org/`（首頁）→ 視部署模式決定

---

## 1. 前置安裝（新機器）

### Windows

```powershell
# Node.js 20 LTS — 從 https://nodejs.org 下載安裝
node --version  # 應顯示 v20.x.x 或更高

# Git — https://git-scm.com/download/win
git --version

# MongoDB Community 7.0 — https://www.mongodb.com/try/download/community
# 安裝時勾選「Install MongoDB as a Service」
mongod --version

# PM2（全域）
npm install -g pm2

# pm2-windows-startup（讓 PM2 開機自動啟動）
npm install -g pm2-windows-startup
pm2-startup install

# Cloudflared — https://github.com/cloudflare/cloudflared/releases
# 下載 cloudflared-windows-amd64.exe，重新命名為 cloudflared.exe，放到 PATH
cloudflared --version
```

### Linux (Ubuntu 22.04 範例)

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# MongoDB Community 7.0
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable mongod && sudo systemctl start mongod

# PM2
sudo npm install -g pm2
pm2 startup systemd
# 跟著輸出的指令再執行一次（會印出一行 sudo env...）

# Cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
```

---

## 2. Clone 程式碼

```powershell
# 任選一個工作目錄
cd C:\Users\<you>\Documents\Github  # Windows
# 或
cd ~/projects  # Linux

# 主 repo
git clone <main-repo-url> equipmentGAME
cd equipmentGAME
npm install

# 前端 repo
cd ..
git clone https://github.com/appskm20049f6/equipmentGAME-app.git
cd equipmentGAME-app
npm install
```

---

## 3. 環境變數 `.env`（主 repo）

### 3.1 從舊機器複製 .env
最快的方法 — 把舊機器的 `.env` **整份複製**到新機器同位置。

> ⚠️ **不要**透過 git push/pull（`.env` 在 `.gitignore`），請用 USB / scp / 加密雲端硬碟傳輸。

### 3.2 從零填（如果沒舊 .env）
參考 `.env.example`，必填：

```ini
# Discord Bot（必填）
DISCORD_TOKEN=                  # Discord Developer Portal → Bot → Token
DISCORD_CLIENT_ID=              # Application ID
DISCORD_CLIENT_SECRET=          # OAuth → Client Secret
DISCORD_GUILD_ID=               # 你的 Discord 伺服器 ID

# Admin
ADMIN_ROLE_IDS=                 # 管理員 Discord role ID（逗號分隔）
ADMIN_USER_IDS=                 # 管理員 Discord user ID
ADMIN_PASSWORD=                 # 後台密碼（自訂）
PERSONAL_ROOM_CHANNEL_ID=

# API
API_PORT=5566
JWT_SECRET=                     # 用 node -e "console.log(require('crypto').randomBytes(64).toString('hex'))" 產生
PUBLIC_BASE_URL=https://otonashikoi.org

# MongoDB
STORAGE_DRIVER=mongo
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=equipment_game

# CORS（前端網域）
ALLOWED_ORIGINS=https://otonashikoi.org,http://localhost:5180

# Cloudinary（圖片上傳，可選）
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Twitch / YouTube OAuth（會員查詢用，可選）
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# 後台額外
ADMIN_API_KEY=                  # 後台 admin API 內部呼叫用
ADMIN_API_CALLER_IDS=
```

> 🔑 **JWT_SECRET 換到新機器後可以保留同一份**（這樣現有玩家的 JWT 還有效）；如要全部踢出重登，就重新產一個。

---

## 4. 資料庫遷移

### 4.1 在舊機器匯出
```powershell
cd C:\Users\<you>\Documents\Github\equipmentGAME

# 完整 dump 所有 collections
mongodump --uri="mongodb://localhost:27017" --db=equipment_game --out=./db-backup

# 打包
Compress-Archive -Path .\db-backup -DestinationPath .\db-backup.zip
```

### 4.2 把 `db-backup.zip` 傳到新機器（任意方式：USB / scp / 加密雲端）

### 4.3 在新機器匯入
```powershell
# 解壓
Expand-Archive db-backup.zip -DestinationPath .

# 還原（會覆蓋 DB，請確認）
mongorestore --uri="mongodb://localhost:27017" --db=equipment_game --drop ./db-backup/equipment_game
```

### 4.4 驗證
```powershell
cd C:\Users\<you>\Documents\Github\equipmentGAME
npm run status:update
# 應該輸出 zone / monster / item / player 各種統計
cat docs/CURRENT_GAME_STATUS.md | head -30
```

---

## 5. 第一次啟動

### 5.1 註冊 Discord slash commands（**只在主 bot 機器跑一次**）

```powershell
cd C:\Users\<you>\Documents\Github\equipmentGAME
npm run discord:register
```

> ⚠️ 如果舊機器還沒關，**先把舊機器 PM2 停掉**避免雙 bot 搶 token：
> ```powershell
> # 舊機器
> npm run pm2:stop
> ```

### 5.2 用 PM2 啟動

```powershell
npm run pm2:reset
```

確認狀態：
```powershell
npm run pm2:status
# 應該看到 equipmentGAME online
```

看一下沒爆掉：
```powershell
npm run pm2:logs
# 預期：
#   [API] listening on port 5566
#   [Admin] http://localhost:5566/admin
#   [Quest] seeded ...
```

### 5.3 設定開機自動啟動

```powershell
# 把目前 PM2 process list 存成「開機要自動跑」的清單
pm2 save
```

之後重開機 → PM2 daemon 自動啟動 → 自動載回 equipmentGAME process。

---

## 6. Cloudflared Tunnel 設定

### 6.1 登入並建立 tunnel
```powershell
cloudflared tunnel login
# 會開瀏覽器，選 otonashikoi.org → Authorize

cloudflared tunnel create equipmentGAME
# 輸出 tunnel UUID，記下來（或在 ~/.cloudflared/ 找 .json）
```

### 6.2 設定路由
建立 `C:\Users\<you>\.cloudflared\config.yml`：
```yaml
tunnel: <your-tunnel-uuid>
credentials-file: C:\Users\<you>\.cloudflared\<uuid>.json

ingress:
  - hostname: otonashikoi.org
    service: http://localhost:5566
  - service: http_status:404
```

### 6.3 設 DNS 路由
```powershell
cloudflared tunnel route dns equipmentGAME otonashikoi.org
```

### 6.4 安裝成 Windows service
```powershell
cloudflared service install
# 之後 cloudflared 會跟著 Windows 開機自啟
```

驗證：開瀏覽器 → `https://otonashikoi.org/admin` 應看到後台登入頁。

---

## 7. Web 前端部署

### 選 A：純 Dev 模式（用 vite dev server）
適合：本機自己玩，或還在開發階段
```powershell
cd equipmentGAME-app
npm run dev
# 開 http://localhost:5180
```

### 選 B：Production Build 給 Express 服務
適合：要把前端整合進現有的 `otonashikoi.org`
```powershell
cd equipmentGAME-app
npm run build
# 產出在 dist/

# 把 dist/ 內容複製到主 repo 的 src/web/public/app/
xcopy /E /Y dist\* ..\equipmentGAME\src\web\public\app\
```

然後在 Express 加一條 route 服務這個目錄（用戶可自己加，或我下次補）。

### 選 C：Cloudflare Pages
適合：要前端獨立部署、CDN 加速
1. 連 GitHub repo `appskm20049f6/equipmentGAME-app` 到 Cloudflare Pages
2. Build command：`npm run build`
3. Output directory：`dist`
4. 環境變數：
   - `VITE_API_BASE_URL=https://otonashikoi.org`
   - `VITE_DISCORD_CLIENT_ID=<your-id>`
   - `VITE_DISCORD_REDIRECT_URI=https://app.otonashikoi.org/auth/discord/callback`
5. 自訂網域：`app.otonashikoi.org`

---

## 8. 第三方服務遷移

### Discord OAuth Redirect URIs
[Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects：
- 確認有 `https://otonashikoi.org/api/auth/discord/callback`
- （如果用 Cloudflare Pages）加 `https://app.otonashikoi.org/auth/discord/callback`

### Twitch OAuth Redirect URLs
[Twitch Developer Console](https://dev.twitch.tv/console/apps) → OAuth Redirect URLs：
- `https://otonashikoi.org/api/stream-auth/callback?provider=twitch`

### YouTube / Google OAuth Redirect URIs
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 Client IDs → Authorized redirect URIs：
- `https://otonashikoi.org/api/stream-auth/callback?provider=youtube`

### Cloudinary（如果有用）
無須遷移，照舊用 API key。

---

## 9. 驗收 Checklist

部署完跑這個全部 ✅：

```powershell
# 1. PM2 running
npm run pm2:status   # equipmentGAME → online

# 2. API health
curl http://localhost:5566/api/health
# 預期：{"status":"ok"}

# 3. MongoDB 連線
mongosh "mongodb://localhost:27017/equipment_game" --eval "db.players.countDocuments()"
# 預期：玩家總數

# 4. Discord Bot 上線
# 進你的 Discord 伺服器，看 bot 是否顯示綠燈

# 5. 對外網域
curl https://otonashikoi.org/api/health
# 預期：{"status":"ok"}

# 6. 後台
# 瀏覽器開 https://otonashikoi.org/admin → 用 ADMIN_PASSWORD 登入

# 7. Web 前端
# 瀏覽器開 http://localhost:5180 → 點 Discord 登入 → 應該能進首頁看到角色
```

---

## 10. 後續維運

### 重啟服務
```powershell
npm run pm2:restart  # 一般重啟
npm run pm2:reset    # 完整 delete + start（用於 ecosystem.config 變動時）
```

### 看 log
```powershell
npm run pm2:logs           # 持續滾動
npm run pm2:logs --lines 50 --nostream   # 只看最後 50 行
```

### 同步資料庫狀態文件
```powershell
npm run status:update  # 重新生成 docs/CURRENT_GAME_STATUS.md
```

### 備份 DB（建議每天）
排程一個 cron / Task Scheduler 任務：
```powershell
mongodump --uri="mongodb://localhost:27017" --db=equipment_game --out=D:\backups\equipment_game-$(Get-Date -Format yyyy-MM-dd)
```

保留 30 天 + 每月一份永久備份。

---

## 11. 常見問題

### Q1: `npm run pm2:reset` 後 process 起不來
看 log：`pm2 logs equipmentGAME --err`，常見原因：
- `.env` 缺欄位 → 對照 `.env.example` 補
- MongoDB 沒跑 → `Get-Service MongoDB` / `systemctl status mongod`
- Port 5566 被佔用 → `netstat -ano | findstr 5566`，殺掉舊 process

### Q2: 兩台機器同時跑會怎樣？
**Discord token 只能登入一處**。新機器啟動會把舊機器踢下線。確保只有一台跑 bot。
如果非要兩台並行（一台跑 API、一台跑 Bot），第二台在 `.env` 加 `API_ONLY=1` 跳過 Bot 部分。

### Q3: 對外 URL 從 otonashikoi.org 換成別的
- 改 `.env` 的 `PUBLIC_BASE_URL`
- 改 Discord / Twitch / Google OAuth 的 redirect URI
- 改 cloudflared `config.yml` 的 `hostname`
- 改 web 前端 `.env` 的 `VITE_API_BASE_URL`、`VITE_DISCORD_REDIRECT_URI`
- 改 `ALLOWED_ORIGINS`
- 重啟 PM2 + cloudflared

### Q4: 舊機器資料一直在增加（玩家還在玩），怎麼切換沒空窗？
**最小停機切換流程**：
1. 新機器 dump + restore 完成（先做一份）
2. 公告維護 5 分鐘
3. 舊機器：`npm run pm2:stop`
4. 舊機器：再 dump 一次（增量）
5. 把增量 dump 複製到新機器，restore（`--drop` 後 replay）
6. 新機器：`npm run pm2:start`
7. Cloudflared tunnel 切到新機器
8. 玩家重連

### Q5: cloudflared tunnel 從舊機器搬到新機器
**最簡單**：
1. 把舊機器 `~/.cloudflared/` 整個複製到新機器同位置
2. 新機器 `cloudflared service install`
3. 舊機器 `cloudflared service uninstall`

Tunnel UUID 不變，DNS 也不用改。

---

## 12. 移動前的最後檢查（在舊機器執行）

部署前在舊機器跑一次：
```powershell
# 1. 確認所有檔案都 commit / push 了
cd equipmentGAME
git status

cd ..\equipmentGAME-app
git status

# 2. 列出所有 .env 變數（不含值）
Get-Content equipmentGAME\.env | Where-Object { $_ -match "^[A-Z]" } | ForEach-Object { ($_ -split '=')[0] }

# 3. dump DB
cd equipmentGAME
mongodump --uri="mongodb://localhost:27017" --db=equipment_game --out=.\db-backup-$(Get-Date -Format yyyy-MM-dd)

# 4. 壓縮 .cloudflared、.env、db-backup
Compress-Archive -Path .\.env, .\db-backup-*, $env:USERPROFILE\.cloudflared -DestinationPath .\migration-bundle.zip
```

把 `migration-bundle.zip` 帶到新機器即可。
