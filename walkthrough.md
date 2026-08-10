# 🏠 終極懶人開服系統：操作手冊 (v2.0)

> ⛔ **舊 Windows／localtunnel 操作紀錄**：本文的路徑、外部 App repo 與自動推送流程不是目前標準部署方式，
> 請勿照本文操作正式環境。現行啟動方式看 [README.md](README.md)，搬機與正式部署看 [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md)。

恭喜！您的開服系統已進化成「**全自動連鎖模式**」。您現在只需執行一個指令，剩下的事情系統會自己幫您搞定。

## 🤖 懶人啟動指令

請在專案根目錄下輸入：
```powershell
npm run auto-home
```

### 系統會執行的自動化任務：
1. **[自動化] 獲取隧道**：系統會自動啟動隧道並捕捉產生的 `loca.lt` 網址。
2. **[自動化] 連鎖同步**：網址一產生，立即更新 [config.json](file:///c:/Users/appsk/Documents/Github/equipmentGAME/player-web/src/config.json) 並推送到 GitHub [OtonashiKoiApp](https://github.com/OtonashiKoi/OtonashiKoiApp)。
3. **[自動化] 開啟伺服器**：自動重啟您本地的 PM2 `equipmentGAME` 進程。

---

## 🛠️ 下層技術更新實錄

- **全自動驅動器**：建立了 [auto-home.js](file:///c:/Users/appsk/Documents/Github/equipmentGAME/scripts/auto-home.js) 邏輯。
- **配置無縫整合**：優化了 [api.js](file:///c:/Users/appsk/Documents/Github/equipmentGAME/player-web/src/api.js) 的偵測優先權。
- **Git 權限認證**：已永久綁定您的 Otonashi 帳號 Token，不再有權限問題。

---

## 📢 Localtunnel 使用小指南

由於我們使用的是 `localtunnel` 以實現自動化：
- **維持視窗開啟**：執行 `npm run auto-home` 的視窗必須維持開啟，否則連線會中斷。
- **隧道密碼**：如果玩家點開網址被要求輸入密碼，請提供您家裡的 **公網 IP**（可至 [whatismyip.com](https://www.whatismyip.com/) 查詢）。

> [!TIP]
> **懶人終點站**：如果您以後想要連這行指令都省了，最好的辦法依然是去 Ngrok 申請一個免費的「固定網址」，並將它設定在您的 PM2 啟動腳本中。

現在，您的「音無樂園」伺服器已正式進入自動化時代！如果您還有任何想優化的細節，我隨時待命。
