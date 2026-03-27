# Mongo-Ready Game Platform Plan

更新日期：2026-03-27

## 1. 產品目標

本專案的第一原則是「資料庫優先」，Discord 只是第一個入口，不是唯一入口。

第一期要建立的是可長期擴充的遊戲資料平台：
- 玩家可以先在 Discord 內遊玩
- 玩家資料未來可以被後台 API、網頁、App 重用
- 玩家資產以金幣與鑽石為核心
- 所有獎勵與扣款都必須可追蹤

## 2. 第一階段範圍

In scope：
- Discord 作為玩家入口
- Web 後台與管理 API
- JSON 開發模式與 MongoDB 正式模式雙軌
- 玩家主檔、錢包、交易紀錄、管理審計
- Discord 版位與功能綁定設定
- 檔案治理與模組拆分規範

Out of scope：
- 第三方平台整合（YouTube、直播事件）
- 複雜戰鬥與裝備系統
- 多幣種配置化
- 跨平台帳號體系重構

## 3. 產品規則

1. Discord ID 為第一期玩家主鍵
2. 第一期固定雙幣種：金幣、鑽石
3. 錢包餘額是快照，交易紀錄才是事實來源
4. Discord 與 API 必須共用同一服務層規則
5. 玩家操作以聊天室互動元件為主，不依賴玩家手打 slash command
6. 任一檔案超過 400 行必須拆分
7. 320 行即視為預警，應優先重構

## 4. 核心資料模型

### Player
- discordId
- displayName
- status
- schemaVersion
- createdAt
- updatedAt

### Wallet
- playerId
- gold
- diamond
- updatedAt

### TransactionLog
- playerId
- currencyType
- amount
- direction
- source
- sourceRef
- balanceAfter
- createdAt
- operator

### GameProgress
- playerId
- level
- exp
- flags
- updatedAt

### AdminActionLog
- adminId
- targetPlayerId
- actionType
- payload
- createdAt

## 5. 技術分層

- src/domain：資料模型與領域規則
- src/services：玩家、錢包、獎勵、進度等商業邏輯
- src/repositories/interfaces：資料存取介面
- src/adapters/json：JSON 儲存實作
- src/adapters/mongo：MongoDB 儲存實作
- src/bot：Discord 指令與互動入口
- src/api：後台與共用 API
- src/shared：錯誤格式、回應格式、檢查工具

## 6. 7 天 MVP 計畫

### Day 1 - 契約凍結
- 定義資料模型、回傳格式、錯誤碼、目錄規則
- 完成 config 契約與環境變數設計
- 建立模組骨架

### Day 2 - Repository 與 JSON 基線
- 完成 repository interface
- 完成 JSON adapter
- 驗證玩家建立與錢包初始化流程

### Day 3 - 服務層
- 完成 PlayerService、WalletService、RewardService
- 確保金幣/鑽石異動一定留下交易紀錄

### Day 4 - Mongo Adapter
- 連接 MongoDB 線上版
- 完成與 JSON 相同的儲存行為
- 驗證雙模式回傳一致

### Day 5 - Discord MVP
- 新增管理員發布玩家面板能力
- 玩家透過聊天室按鈕完成建立、查詢、測試互動
- 完成一般玩家與管理員權限分流

### Day 6 - 後台 API / Web
- 建立玩家查詢、錢包調整、獎勵發放、審計查詢 API
- 建立 Web 後台設定頁，管理白名單與 Discord 版位
- 統一 response envelope

### Day 7 - 驗證與封板
- JSON/Mongo 一致性驗證
- Discord/API 交叉驗證
- 文件更新與檢查腳本封板

## 7. 驗收標準

- Discord 可建立玩家並查詢錢包
- 金幣與鑽石可透過服務層安全增減
- 每次資產變動都有交易紀錄
- 管理員高權限操作有審計紀錄
- JSON 與 Mongo 模式可切換且回傳格式一致
- 任一檔案超過 400 行時，檢查流程失敗

## 8. 工程治理

- 單檔 320 行預警，400 行阻擋
- 指令層不可直接寫資料庫
- API 層不可直接實作遊戲規則
- 所有業務規則集中在 services
- 所有儲存切換集中在 adapters

## 9. 下一步

1. 完成 config、env、scripts 改造
2. 建立 domain / services / repositories / adapters / shared 骨架
3. 先做 JSON adapter 與基本玩家/錢包服務
4. 再接 MongoDB 正式儲存
