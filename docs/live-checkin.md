# 直播打卡（Live Check-in）設計文件

更新日期：2026-04-04

目標：當直播聊天室出現「打卡」相關訊息時，自動辨識並執行對應效果（紀錄打卡、發放獎勵、建立交易紀錄與審計），並提供管理後台設定與查詢介面。

一、功能要點
- 偵測指定頻道或多個頻道的聊天室訊息，根據規則判定為「打卡」。
- 每位玩家每日（或自訂冷卻時間）可打卡一次，首次打卡可獲得獎勵（可配置金幣/鑽石/經驗）。
- 打卡產生：CheckIn 紀錄、若有獎勵則由 `RewardService` 建立交易紀錄與更新錢包、並寫入審計紀錄。
- 管理後台可設定：啟用頻道、關鍵字規則、獎勵設定、冷卻時間、自動或人工審核模式。

二、資料模型（建議）
- CheckIn
  - id
  - playerId (nullable) — 對應玩家主檔
  - discordId
  - channelId
  - messageId
  - content
  - occurredAt
  - rewardGranted (boolean)
  - rewardDetail (object) — { currencyType, amount, txId }
  - createdAt

三、偵測規則（示例）
- 預設 regex（不區分大小寫）：`/(打卡|上線|^!checkin\b|我要打卡|簽到)/i`
- 支援白名單頻道（只在 channelLayout 的 `live_checkin` 綁定頻道監聽），或全頻道開關。
- 支援「包含文字」或「完全比對」兩種模式。

四、工作流程
1. 訊息到達（由 `commentFetcher` 或 bot messageCreate 事件）
2. 檢查頻道是否為啟用打卡頻道。
3. 以 regex 或自訂規則判斷是否為打卡訊息。
4. 將 discordId 解析成玩家（若無玩家則依策略：自動建立或回覆請先建立玩家）。
5. 呼叫 `checkinService.handleMessage({ discordId, channelId, messageId, content, occurredAt })`。
   - `isEligible`：檢查冷卻、今日是否已打卡。
   - `processCheckin`：建立 `CheckIn` 紀錄，若符合條件呼叫 `rewardService.grantCurrency` / `grantExp`（以交易紀錄方式），並在 `adminActionLogRepository` 記錄一筆操作審計。
6. 回覆使用者：成功（可為公開訊息或私訊/ephemeral），或提示原因（例如：今天已打卡）。

五、服務介面（建議）
- `src/services/checkinService.js`
  - async `handleMessage({ discordId, channelId, messageId, content, occurredAt })`
  - async `isEligible(discordId, channelId, windowInHours)`
  - async `listRecentByDiscordId(discordId, limit)`
  - async `revokeReward(checkInId, adminId)`

六、資料層
- `src/repositories/interfaces/checkinRepository.js`（CRUD）
- 實作：`src/adapters/json/checkinRepository.js`、`src/adapters/mongo/checkinRepository.js`

七、管理後台（簡要）
- 在 admin console 新增「留言整合 / 打卡」設定版位：
  - 啟用/停用
  - 綁定頻道（channelLayout）
  - 關鍵字/正規表達式（可編輯）
  - 獎勵：currencyType、amount、exp、冷卻時間
  - 模式：自動發放 / 需人工審核
  - 查詢：最近打卡紀錄、匯出 CSV

八、原子性與安全性
- 發放獎勵與建立交易紀錄必須為原子操作（使用 service 層負責先建交易，再更新錢包快照，或在 DB transaction 中完成）。
- 對重播或重複訊息做去重（以 `messageId` 與 `discordId` + 時間窗口去重）。
- 權限：管理路由需 `x-admin-key` 驗證。

九、例外與邊界情況
- 使用者在未註冊狀態發打卡：回覆引導建立玩家或自動建立（依配置）。
- 濫用/灌水：設定冷卻時間與頻率限制（例如同一頻道同一使用者 1 小時一次）。
- 獎勵回滾：提供 admin revoke API 與在 `adminActionLog` 記錄執行人與原因。

十、實作步驟（建議優先順序）
1. 新增 repository interface 與 JSON adapter（`checkinRepository`）。
2. 新增 `checkinService`，實作 `handleMessage`、`isEligible`、`listRecentByDiscordId`。
3. 修改 `src/bot/commentFetcher.js` 或 `src/bot/client.js`：在 message 事件或 OneComme 處理流程中呼叫 `checkinService.handleMessage`。
4. 新增 admin route：`GET /admin/checkins`、`POST /admin/checkins/:id/revoke`、`PUT /admin/checkin-settings`。
5. 在後台 UI 新增簡易設定面板（由 `admin.bindings` 擴展）。
6. 撰寫單元測試（service 與 repository）及 e2e 測試。

十一、範例：收到訊息的 JSON 事件
{
  "discordId": "1234567890",
  "channelId": "987654321",
  "messageId": "4567890",
  "content": "打卡！今天完成直播",
  "occurredAt": "2026-04-04T12:34:56.000Z"
}

十二、評估時間
- 設計 + repository + service +基本 bot hook：1 – 2 天
- admin UI +審核流程 +測試：1 – 2 天

備註：此設計以最小可行產品為優先（自動偵測 + 自動發獎勵）。如需更複雜的審核或關聯直播平台事件，可在此基礎上擴展事件來源、Webhook 或更細的規則引擎（例如：多關鍵字權重、黑名單、達成任務後發獎勵）。
