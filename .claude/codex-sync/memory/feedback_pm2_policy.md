---
name: PM2 操作規範
description: PM2 的啟動由用戶自己負責，Claude 不要主動啟動或重啟
type: feedback
---

PM2 的啟動由用戶自己來，Claude 不要主動 start/restart/reset。

**Why:** 用戶需要自己控制伺服器的啟動時機，Claude 亂啟動會搶占端口或在錯誤時機啟動。

**How to apply:**
- 需要重啟時，只說「你可以用 `npm run pm2:reset` 重啟」，讓用戶自己執行
- 如果用戶明確說「幫我重啟」才執行
- 重啟命令用 `npm run pm2:reset`（不是 pm2 restart），會先釋放端口
- 代碼改完後不要自動重啟，告知用戶改動完成即可
