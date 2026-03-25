# equipmentGAME Implementation Plan

## Project Goal
建立 Discord Bot + Web API 的開寶箱換裝備遊戲，後續串接 YouTube 直播互動與 Discord 社群玩法。

## Milestones

### M1 - 基礎骨架與核心玩法
- [x] Node.js 專案初始化
- [x] Discord slash commands 註冊流程
- [x] 本機資料持久化 (JSON store)
- [x] RPG核心: 稀有度、裝備屬性、背包、換裝
- [x] 基本戰鬥: 怪物挑戰與獎勵
- [x] Web API: 健康檢查、角色資料、排行榜

### M2 - Discord體驗升級
- [ ] 裝備分享圖片輸出 (Canvas)
- [ ] 更完整背包分頁與篩選
- [ ] 每日任務 / 每日獎勵
- [ ] 經濟平衡參數化

### M3 - YouTube整合
- [ ] YouTube Live 事件監聽器
- [ ] 互動事件轉換為金幣獎勵
- [ ] 會員與SC額外獎勵規則
- [ ] YouTube帳號與Discord帳號綁定策略

### M4 - 帳號連結與Web互動
- [ ] Discord OAuth2
- [ ] 玩家裝備展示頁
- [ ] 可分享的角色頁面
- [ ] WebSocket即時同步

### M5 - 戰鬥系統深化
- [ ] 怪物圖鑑與難度階層
- [ ] 技能與被動效果
- [ ] Boss活動與限時掉落

## Execution Log

- 2026-03-25: 完成 M1 初版可執行系統。
  - 建立 package.json、環境變數範本、README。
  - 建立 Discord 指令: /open-chest, /inventory, /equip, /profile, /fight-monster。
  - 完成 RPG 服務: 掉落表、裝備生成、經驗升級、戰力計算。
  - 建立 web API: /health, /api/profile/:discordId, /api/leaderboard。
- 2026-03-25: 完成本機啟動驗證。
  - npm install 成功。
  - npm run start 成功，Web 服務在 3000 Port 啟動。
  - 未設定 Discord token 時會安全略過 Bot 登入與命令註冊。
- 2026-03-25: 調整裝備規則為「無背包自動換裝」。
  - 開箱後只比較同部位裝備，較強才自動替換。
  - `/inventory` 改為顯示目前穿戴裝備，不再顯示裝備倉庫。
  - 移除手動 `/equip` 流程。
- 2026-03-25: 補齊 Discord 直接測試流程。
  - 新增 `npm run discord:register` 供測試群組快速註冊 slash commands。
  - 註冊流程改為回傳成功/失敗狀態，便於快速除錯。
  - README 新增 Discord API 直接測試步驟。
- 2026-03-25: 完成 Discord 端到端啟動驗證。
  - Slash commands 註冊成功。
  - Bot 登入成功。
  - Web API 服務正常啟動於 Port 5566。
- 2026-03-25: 新增 Discord 曬裝圖卡功能。
  - 新增 `/share-loadout` 指令，直接輸出 PNG 裝備圖卡。
  - 使用 `@napi-rs/canvas` 產生圖片，可在聊天頻道直接分享。
- 2026-03-25: 圖卡改為復古 MMO 介面風格。
  - 裝備區改為左右欄 + 中央角色框的面板式佈局。
  - 新增 Status 區塊，統一顯示戰力與屬性資訊。
- 2026-03-25: 圖卡第二版微調完成。
  - 中央人物區改用 Discord 使用者頭像。
  - 重新調整裝備欄位，左右欄位避開中央圖片區。
  - 背景改為雪景藍白色系，加入細雪點綴。
- 2026-03-26: 圖卡第三版版型校正完成。
  - 對齊經典介面比例，修正 Status 區塊寬度溢出。
  - 完成多欄位版型（左右各 5 格，共 10 格）。
  - 增加上方分頁視覺，整體更接近參考圖。
- 2026-03-26: 圖卡第四版（指定樣式）完成。
  - 中央人物框改為更窄直式比例。
  - 字體改為更接近舊遊戲 UI 的緊湊風格。
  - 狀態欄改為指定順序：Str/Agi/Vit/Int/Dex/Luk 與 Atk/Def/Matk/Mdef/Hit/Flee/Aspd。
- 2026-03-26: 改為 Discord 原生可操作面板。
  - `/share-loadout` 由圖片改為按鈕面板訊息。
  - 可直接在 Discord 內按按鈕開箱、打怪、重新整理，不需跳網頁。

## Current Status

- 當前里程碑: M1
- 狀態: Completed (M1完成，已可本機測試)
- 下一步: 進入 M2，先做裝備分享圖片輸出 (Canvas) 與背包體驗優化
