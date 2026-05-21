# OAuth 完整設定指南

> 本文件記錄完整流程（含踩過的坑）。**首次重做 / 換 cloudflare URL / production 上架** 都應該翻這份。

最後更新：2026-05-21

---

## 0. 觀念與架構

equipmentGAME 透過 OAuth 跟 Twitch / YouTube 互動，分**兩種角色**：

| 角色 | 用途 | 持有 token |
| --- | --- | --- |
| **玩家 (stream-auth)** | 每個玩家自己授權「證明身分」 | DB: `streamAccountBindings` |
| **頻道主 (creator-auth)** | 你（音無恋）一次性授權，系統用此查任何玩家的會員狀態 | DB: `creatorTokens` |

**核心觀念**：玩家綁定 = 證明身分；查會員狀態 = 用你頻道主 token 主動打 API。**兩件事互相獨立**。

---

## 1. 必要環境變數（`.env`）

```env
# 後端公開可達 URL（OAuth callback 會被導回這裡）
PUBLIC_BASE_URL=https://xxxxx.trycloudflare.com

# Twitch
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_BROADCASTER_ID=...     # 你的 Twitch user ID（純數字）

# YouTube
YOUTUBE_CLIENT_ID=...apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=...
# STREAM_YOUTUBE_CREATOR_REFRESH_TOKEN 不用設，由 broadcaster auth 流程寫進 DB

# Admin 後台密碼
ADMIN_PASSWORD=...

# JWT 簽章 secret（player JWT 用）
JWT_SECRET=...
# stream-auth state token 簽章 secret（可跟 JWT_SECRET 不同）
STREAM_AUTH_SECRET=...
```

---

## 2. Twitch 設定

### 2.1 申請 app

1. 去 https://dev.twitch.tv/console/apps
2. 「+ Register Your Application」
3. 必填：
   - **Name**：自訂（e.g. `equipmentGAME`）
   - **OAuth Redirect URLs**：必須包含 3 條
     - `${PUBLIC_BASE_URL}/api/stream-auth/callback/twitch`（玩家綁定回呼）
     - `${PUBLIC_BASE_URL}/api/creator-auth/callback/twitch`（頻道主授權回呼）
     - 本機 dev：`http://localhost:5566/api/stream-auth/callback/twitch`
   - **Client Type**：⚠️ **Confidential**（不是 Public）
4. 建立後：複製 **Client ID**、點「New Secret」生成 **Secret**（只顯示一次）
5. 寫進 `.env`

### 2.2 拿 Broadcaster ID

純數字 user ID，跟 login name 不一樣。最快：用剛拿到的 client_id/secret 打 app token 然後搜尋：

```bash
TOKEN=$(curl -s -X POST "https://id.twitch.tv/oauth2/token" -d "client_id=$CID&client_secret=$CSEC&grant_type=client_credentials" | jq -r .access_token)
curl -s -H "Authorization: Bearer $TOKEN" -H "Client-Id: $CID" "https://api.twitch.tv/helix/search/channels?query=你的login"
```

或網頁工具：https://www.streamweasels.com/tools/convert-twitch-username-to-user-id/

---

## 3. YouTube / Google Cloud 設定

### 3.1 建專案 + 啟用 API

1. 去 https://console.cloud.google.com/projectcreate 建專案（e.g. `equipmentGAME`）
2. 切到該專案後：https://console.cloud.google.com/apis/library/youtube.googleapis.com → **ENABLE**

### 3.2 OAuth 同意畫面（Auth Platform / OAuth consent）

1. 左選單「OAuth 同意畫面」/ `https://console.cloud.google.com/auth/overview`
2. 點「開始」
3. 應用程式資訊：
   - **App name**: 自訂
   - **User support email**: 你的 email
4. **目標對象**：選 **External**（外部）
5. **聯絡資訊**：填 email
6. 同意《Google API 服務：使用者資料政策》→ 建立

### 3.3 設定 scope（資料存取權）

1. 左選單「資料存取權」/ `/auth/scopes`
2. 點「新增或移除範圍」
3. **勾選**：
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
4. **手動新增範圍**（在側邊欄底部）— 貼上：
   ```
   https://www.googleapis.com/auth/youtube.readonly,https://www.googleapis.com/auth/youtube.channel-memberships.creator
   ```
   點「新增至資料表」
5. 點「更新」

⚠️ `youtube.channel-memberships.creator` 是 sensitive scope，testing 模式不需要 verify，但 production 需要送 Google 審。

### 3.4 加測試使用者（很容易忘）

1. 左選單「目標對象」/ `/auth/audience`
2. 「測試使用者」區塊 → 「+ Add users」
3. 加入你自己的 email 跟所有要測試的玩家 email（最多 100 個）
4. **沒加 test user 的玩家無法登入！**

### 3.5 建 OAuth Client ID

1. 左選單「用戶端」/ `/auth/clients`
2. 「+ 建立用戶端」
3. **應用程式類型**：**Web application**
4. **名稱**：自訂
5. **已授權的重新導向 URI**：跟 Twitch 對應，加 3 條：
   - `${PUBLIC_BASE_URL}/api/stream-auth/callback/youtube`
   - `${PUBLIC_BASE_URL}/api/creator-auth/callback/youtube`
   - `http://localhost:5566/api/stream-auth/callback/youtube`
6. 「建立」
7. 對話框會顯示 **Client ID** 跟 **Client Secret** → 複製到 `.env`

---

## 4. Broadcaster 一次性授權（拿 refresh token）

OAuth 申請完還只完成一半。**broadcaster token 要透過後台流程拿到**：

1. 確定後端跑著（`DEV_MIRROR=1 API_ONLY=1 node src/index.js`）
2. 確定 cloudflare tunnel 跑著（`cloudflared tunnel --url http://localhost:5566`）
3. 確定 `.env` 的 `PUBLIC_BASE_URL` 是當前 tunnel URL
4. 打開瀏覽器：**`${PUBLIC_BASE_URL}/static/admin-creator-auth.html`**
   - ⚠️ 注意：不是 `/admin/creator-auth`（會被 admin auth middleware 擋）
5. 輸入 `ADMIN_PASSWORD` 登入
6. 對 **Twitch** 卡點「重新授權」→ 跳到 Twitch 授權頁 → 點「授權」→ 回到後台會顯示 `twitch broadcaster token 已寫入資料庫`
7. 對 **YouTube** 卡同樣流程：
   - Google 會跳「這個應用程式未經 Google 驗證」 → 點**繼續**（黑色背景下的小字連結）
   - 接著看到 scope 同意頁，勾「全選」→ 繼續
8. 兩張卡都顯示綠色 `active` 即完成

---

## 5. Cloudflare Tunnel 注意事項

trycloudflare quick tunnels 是免費臨時 URL，每次重啟 `cloudflared` URL 都會變。換 URL 時要：

1. 改 `.env` 的 `PUBLIC_BASE_URL`
2. **Twitch console** 加新 redirect URL（舊的不用刪）
3. **Google Cloud Console**「用戶端」加新 redirect URI
4. 重啟後端
5. **Broadcaster token 要重做** Step 4，因為 redirect_uri 必須跟授權時一致

**長期解法**：用 cloudflared named tunnel + 自己網域：
```bash
cloudflared tunnel login
cloudflared tunnel create equipmentgame
cloudflared tunnel route dns equipmentgame your-domain.com
cloudflared tunnel run --url http://localhost:5566 equipmentgame
```
這樣 URL 永久固定（你網域），OAuth console 設定一次就好。

---

## 6. 踩過的坑（避免重蹈覆轍）

| 症狀 | 原因 | 解法 |
| --- | --- | --- |
| `/api/stream-auth/start` 回 `invalid signature` | 前端把登入 JWT 當 state 用，但後端用 `streamAuth.stateSecret` 驗證，預設值不同 | 前端先 POST `/api/me/stream-auth/state` 拿合法 state |
| `Twitch OAuth 尚未設定完成` | `.env` 缺 `TWITCH_*` 變數 | 補齊三個變數 |
| `Updating the path 'createdAt' would create a conflict at 'createdAt'` | `$set` 跟 `$setOnInsert` 同時寫 `createdAt` | repository.save 把 `createdAt` 從 `$set` 拿掉 |
| `CORS blocked: https://xxx.trycloudflare.com` | `cors` middleware 只白名單 localhost 跟 ALLOWED_ORIGINS | server.js 加 `*.trycloudflare.com` 自動允許 |
| `/admin/creator-auth` 回 `Invalid admin password` | 被 adminConsoleRoutes 的 `router.use("/admin", auth)` 攔住 | 改用 `/static/admin-creator-auth.html`（已是 static serve） |
| Google scope 畫面只勾兩個 YouTube 沒勾 | Google 預設不勾 sensitive scope | 在 consent 頁勾「全選」或手動勾兩個 |
| Google 跳「未經驗證」警告 | testing 模式正常現象 | 點「繼續」忽略即可，production 才需要 verify |

---

## 7. 重做 checklist（搬機器 / 換網域時）

```
□ .env 補齊 TWITCH_*、YOUTUBE_*、ADMIN_PASSWORD
□ cloudflared tunnel 跑著
□ PUBLIC_BASE_URL 更新
□ Twitch console redirect URL 加新的
□ Google Cloud Console redirect URI 加新的
□ Google OAuth consent 測試使用者加全部要測的 email
□ 後端 npm run pm2:reset 或 node src/index.js
□ /static/admin-creator-auth.html 重新做兩個平台的 broadcaster auth
□ 用 /api/me/bindings 測試會員狀態查得到
```
