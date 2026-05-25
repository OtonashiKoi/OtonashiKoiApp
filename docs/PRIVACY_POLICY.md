# equipmentGAME 隱私權政策

**最後更新日期：2026 年 5 月 24 日**
**生效日期：2026 年 5 月 24 日**

---

## 1. 服務簡介

equipmentGAME（以下稱「本服務」）是一款結合 Discord 機器人與網頁前端的多人線上遊戲，由 otonashikoi 開發與營運。本服務透過 Discord OAuth 進行身份驗證，並可選擇性整合 Twitch、YouTube 等第三方平台，用於辨識玩家於直播頻道之會員身分，據此提供遊戲內專屬獎勵。

本政策說明本服務在運作過程中，會收集、使用、儲存、揭露哪些資料，以及您對自身資料所擁有的權利。

---

## 2. 我們收集的資料

### 2.1 透過 Discord OAuth 收集
當您使用 Discord 帳號登入本服務時，我們會接收以下資料：

| 資料項目 | 用途 |
|---|---|
| Discord 使用者 ID | 玩家唯一識別 |
| Discord 顯示名稱 | 遊戲內顯示 |
| Discord 頭像 URL | 遊戲內顯示 |

我們**不會**讀取您的 Discord 私訊、好友清單、伺服器清單、或任何訊息內容。

### 2.2 透過 Twitch / YouTube OAuth 收集（選擇性綁定）
若您選擇連接 Twitch 或 YouTube 帳號，我們會接收以下資料：

#### Twitch
| 資料項目 | 用途 |
|---|---|
| Twitch 使用者 ID | 帳號識別 |
| Twitch 顯示名稱 | 顯示用 |
| Twitch 訂閱狀態（針對特定頻道） | 判定您是否為頻道訂閱者，據此給予遊戲獎勵 |

#### YouTube
| 資料項目 | 用途 |
|---|---|
| YouTube 頻道 ID | 帳號識別 |
| YouTube 顯示名稱 | 顯示用 |
| YouTube 頻道會員身分（針對特定頻道） | 判定您是否為頻道會員，據此給予遊戲獎勵 |

我們**只會查詢**您是否為特定 Discord 伺服器擁有者所屬頻道之會員或訂閱者，**不會讀取**：
- 您訂閱的其他頻道
- 您的觀看紀錄
- 您的留言、按讚、播放清單
- 您頻道的影片內容或統計資料

### 2.3 遊戲行為資料（自動產生）
本服務在您遊玩過程中會自動產生以下資料並儲存於資料庫：

- 玩家等級、經驗值、屬性點
- 持有道具、裝備、貨幣（金幣、鑽石）
- 戰鬥紀錄、任務進度、打卡紀錄
- 邀請碼使用紀錄、交易紀錄

---

## 3. 我們如何使用您的資料

收集到的資料**僅用於**：

1. **遊戲功能運作**：身份識別、進度儲存、戰鬥模擬、獎勵發放
2. **會員專屬獎勵**：依據 Twitch / YouTube 會員身分，提供對應遊戲內獎勵
3. **服務改善**：分析匿名化使用模式，優化遊戲體驗
4. **問題排除**：處理錯誤、回應使用者支援請求

我們**不會**將您的資料用於：

- 廣告投放
- 銷售給第三方
- 跨服務追蹤
- 訓練 AI 模型

---

## 4. Google API 使用聲明

本服務使用 Google YouTube Data API v3，並符合 [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)，包括「有限使用」(Limited Use) 之要求。

具體而言：

- 我們**只請求**遊戲核心功能所必需的 OAuth scope（例：`youtube.channel-memberships.creator`）
- 從 Google API 取得的資料**僅用於**本政策第 3 條所述用途
- **不會轉售**、**不會用於廣告**、**不會用於人為審閱**（除非取得您明示同意，或法律要求，或為偵測詐欺/安全問題）
- 不會將 Google API 資料傳輸給第三方（除提供您要求之服務所需，例如本服務的雲端託管服務商）

---

## 5. 資料儲存與保護

| 項目 | 說明 |
|---|---|
| 儲存位置 | MongoDB 資料庫，部署於受信任之雲端基礎設施 |
| 傳輸加密 | 所有 API 通訊透過 HTTPS / TLS 加密 |
| 存取控制 | 僅本服務管理員可存取資料庫，並透過密碼及 IP 白名單保護 |
| 第三方 OAuth Token | 加密儲存於資料庫，不在日誌中明文輸出 |
| 資料保留期限 | 帳號活躍期間持續保留；自您最後一次登入起 **365 天**內未活動，將進入清除程序 |

---

## 6. 您的權利

依據相關隱私法規（包括但不限於 GDPR、CCPA、台灣個資法），您擁有以下權利：

- **查閱權**：要求得知我們持有您的哪些資料
- **更正權**：要求修正不正確的資料
- **刪除權**：要求刪除您的帳號及所有相關資料
- **撤回同意權**：隨時撤銷 Twitch / YouTube 綁定授權
- **資料攜出權**：要求以可讀格式取得您的資料副本

行使上述權利，請透過以下方式聯絡：
- Email：**otonashikoi1228@gmail.com**
- Discord：在官方伺服器標記管理員

我們將於 **30 天內**回覆您的請求。

### 6.1 如何撤銷第三方授權

#### Discord
前往 https://discord.com/developers/applications → User Settings → Authorized Apps → 移除 equipmentGAME

#### Twitch
前往 https://www.twitch.tv/settings/connections → 找到本服務 → 中斷連結

#### YouTube / Google
前往 https://myaccount.google.com/permissions → 找到本服務 → 移除存取權

---

## 7. 第三方服務

本服務整合以下第三方服務，各自有獨立的隱私權政策：

| 服務 | 隱私權政策 |
|---|---|
| Discord | https://discord.com/privacy |
| Twitch | https://www.twitch.tv/p/legal/privacy-notice/ |
| Google / YouTube | https://policies.google.com/privacy |
| Cloudflare（CDN / Tunnel） | https://www.cloudflare.com/privacypolicy/ |
| MongoDB Atlas（如使用） | https://www.mongodb.com/legal/privacy-policy |

---

## 8. 兒童隱私

本服務不主動針對未滿 **13 歲**（或您所在司法管轄區之同意年齡）兒童提供服務，亦不會故意收集兒童資料。若我們得知收集到此類資料，將立即刪除。家長若發現未成年子女已使用本服務，請聯絡我們協助處理。

---

## 9. Cookie 與本機儲存

本服務的網頁前端使用以下技術：

- `localStorage` — 儲存登入 JWT、UI 偏好設定（不含密碼）
- Session Cookie — 維持登入狀態（僅 HTTP-only，無第三方 Cookie）

本服務**不使用**廣告 Cookie、追蹤像素、Google Analytics 或類似分析工具。

---

## 10. 政策變更

我們可能不定期更新本政策。重大變更時會：

1. 更新本頁面頂部「最後更新日期」
2. 在 Discord 官方伺服器公告
3. 下次登入時於網頁前端彈出通知

您於變更後繼續使用本服務，即視為同意更新後之政策。

---

## 11. 聯絡資訊

- **服務名稱**：equipmentGAME
- **營運者**：otonashikoi
- **服務網址**：https://otonashikoi.org
- **聯絡 Email**：otonashikoi1228@gmail.com
- **Discord 伺服器**：（請於官方伺服器內聯絡管理員）

如對本政策有任何疑問或顧慮，歡迎透過上述管道聯絡。

---

## 12. 適用法律

本政策依中華民國（台灣）法律解釋與規範。如有爭議，雙方同意以台灣台北地方法院為第一審管轄法院。
