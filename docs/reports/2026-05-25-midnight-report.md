# 2026-05-25 凌晨例行報告

> 產生時間（沙箱 UTC）：2026-05-25  
> 執行環境：Claude Cowork 排程任務（Linux 沙箱，**無法直接連線到使用者本機 PM2 / MongoDB**）  
> 來源資料：`db-backup/` 2026-05-14 之 JSON 快照（已是專案內最新的離線備份）

---

## 一、伺服器關閉狀態

### 結論
**伺服器尚未被本次排程任務關閉**。請使用者於本機自行執行下列指令。

### 執行細節
| 步驟 | 指令 | 退場碼 | 輸出 |
| --- | --- | --- | --- |
| 1. 確認沙箱 pm2 | `./node_modules/.bin/pm2 status` | 0 | `[PM2] Spawning PM2 daemon with pm2_home=/sessions/.../.pm2` → 空表格 |
| 2. 嘗試停止 | `./node_modules/.bin/pm2 stop all` | 1 | `[PM2][WARN] No process found` |

### 失敗原因
- 沙箱啟動的是 **獨立的 PM2 daemon**（`pm2_home=/sessions/.../.pm2`），無法看見使用者 macOS 主機上實際運作的 `equipmentGAME` 進程。
- PM2 進程僅綁定執行它的作業系統 user / home，沙箱與主機完全隔離。

### 使用者後續操作（必要）
```powershell
# 在你本機跑：
cd ~/Documents/otonashiKoi_game
npx pm2 stop all
npx pm2 status   # 確認所有進程都不是 online
```
若稍後想重啟：
```powershell
npm run pm2:reset
```

---

## 二、PVP 排行榜（前 20 名）

### 結論
**無法產生即時 PVP 排行**。

### 失敗原因
1. 沙箱無外網 / 內網存取，無法解析 DNS（`querySrv ECONNREFUSED _mongodb._tcp.cluster0.98efz0z.mongodb.net`），也無法連到本機 `127.0.0.1:27017`（`ECONNREFUSED`）。
2. 專案內的 `db-backup/progress.json`（2026-05-14 snapshot）**完全沒有** `pkRating` / `pkWins` / `pkLosses` 欄位（277 筆 0 筆有資料），無法從離線檔回填。

### 使用者後續操作
請於本機執行下列任一方式取得即時排行：
```powershell
# 方式 A：透過 admin API（如已開放）
# GET /api/admin/tower/pvp-top?limit=20

# 方式 B：直接從 Mongo Shell / Compass 跑
db.progress.aggregate([
  { $match: { level: { $gte: 30 }, $or: [ { pkWins: { $gt: 0 } }, { pkLosses: { $gt: 0 } } ] } },
  { $sort: { pkRating: -1 } },
  { $limit: 20 },
  { $lookup: { from: "players", localField: "playerId", foreignField: "discordId", as: "_player" } },
  { $project: { playerId: 1, level: 1, pkRating: 1, pkWins: 1, pkLosses: 1,
                displayName: { $ifNull: [ { $arrayElemAt: ["$_player.displayName", 0] }, "$playerId" ] },
                job: "$equipment.job_eq.itemName" } }
])
```
排序鍵已對照 `src/adapters/mongo/createMongoRepositories.js#findTopByPkRating`。  
備註：原始程式設定 PVP 排行需 `level >= 30`，目前 2026-05-14 快照最高僅 20 級，即使有 `pkRating` 也不會有人入榜，請以本機即時資料為準。

---

## 三、爬塔排行榜（前 20 名）

### 結論
**無法產生即時爬塔排行**。

### 失敗原因
1. 同上，沙箱無 Mongo 存取。
2. `db-backup/progress.json` 277 筆中 **完全沒有** `towerRecord` 欄位。

### 使用者後續操作
```javascript
// Mongo Shell：對應 findTopByTowerRecord
db.progress.find(
  { "towerRecord.bestFloor": { $exists: true, $gt: 0 } },
  { playerId: 1, displayName: 1, towerRecord: 1 }
)
.sort({
  "towerRecord.bestFloor": -1,
  "towerRecord.bestProgressDamagePct": -1,
  "towerRecord.bestProgressDamage": -1,
  "towerRecord.bestAt": 1
})
.limit(20)
```

---

## 四、2 等以上玩家清單（共 50 位 — 取自 2026-05-14 快照，非即時）

> 警告：以下數字來自 `db-backup/progress.json`（檔案 mtime 2026-05-14），距今 11 天。等級可能已上升、新增玩家未列入。`displayName` 取自 `db-backup/players.json` 之 `discordId` 對應。  
> 快照中 `equipment.job_eq` 多數為空，因此「職業」欄絕大多數顯示為 `Novice`（base job），僅少數玩家有徽章。

| 暱稱 | 玩家 ID | 等級 | 職業 | 最後更新 |
| --- | --- | --- | --- | --- |
| 喜歡跳烤爐的咩 | 344786855235026944 | 20 | Novice | 2026-04-14T14:01:08.588Z |
| 青葉ＡＢＣ | 159058930402721792 | 20 | Novice | 2026-04-14T14:01:08.612Z |
| 享受夢境 | 364417212645376001 | 20 | Novice | 2026-04-14T14:01:08.682Z |
| 布布 | 139748832517816320 | 20 | Novice | 2026-04-14T14:01:08.707Z |
| Ashiou阿修修 | 158390323372883968 | 20 | Novice | 2026-04-14T14:01:08.730Z |
| Jakklim90 | 665557921551220746 | 20 | Novice | 2026-04-14T14:01:08.779Z |
| 卡布利可 | 828294596010049536 | 20 | Novice | 2026-04-14T14:01:08.899Z |
| 滷灰灰 | 518820138363912234 | 20 | Novice | 2026-04-14T14:01:08.923Z |
| rikataya. | 1217712538800881794 | 20 | Novice | 2026-04-14T14:01:09.023Z |
| Frank | 404245980654075905 | 20 | Novice | 2026-04-14T14:01:09.066Z |
| 吉村佐惠子 | 693452522379280474 | 20 | Novice | 2026-04-14T14:01:41.245Z |
| Eric Huang (回憶風鈴) | 543314526234345472 | 19 | Novice | 2026-04-14T14:01:41.215Z |
| B.Y | 860551109042110475 | 18 | Novice | 2026-04-14T14:01:41.192Z |
| 企鵝 | 237151667160612865 | 18 | Novice | 2026-04-14T14:01:09.093Z |
| 聖光 | 369732621493600257 | 18 | Novice | 2026-04-14T14:01:08.631Z |
| 飼育員 | 614852332026593291 | 17 | Novice | 2026-04-14T14:01:41.136Z |
| 一塊懶骨頭 | 619938728994930724 | 16 | Novice | 2026-04-14T14:01:08.998Z |
| 杯琴 | 742581777427726492 | 16 | Novice | 2026-04-14T14:01:41.267Z |
| 笑不語 | 324363656819245058 | 15 | Novice | 2026-04-14T14:01:08.878Z |
| 鱈魚 | 457175988439351298 | 15 | Novice | 2026-04-14T14:01:09.159Z |
| 毛毛毛 | 947181147488673854 | 15 | Novice | 2026-04-14T14:01:08.980Z |
| 音無恋 | 865264891991425055 | 15 | 劍士徽章 | 2026-04-15T15:20:50.156Z |
| Tojo Kenjiro(東條健次郎) | 343019809455472651 | 15 | Novice | 2026-04-14T14:01:08.799Z |
| 雨川紫 | 258971993452314624 | 15 | Novice | 2026-04-14T14:01:08.962Z |
| extreamt(公雞) | 575308041109372930 | 15 | Novice | 2026-04-14T14:01:41.117Z |
| 彩雲 | 609388495060074536 | 15 | Novice | 2026-04-14T14:01:08.756Z |
| YEE | 597624017851252746 | 15 | Novice | 2026-04-14T14:01:08.836Z |
| 噴火龍的訓練家 | 525828241710252033 | 14 | Novice | 2026-04-14T14:01:08.815Z |
| 贗作十三夜寐 | 350565436087074817 | 12 | Novice | 2026-04-14T14:01:09.113Z |
| JIL-達 | 272649441616330752 | 12 | Novice | 2026-04-14T14:00:44.135Z |
| 阿蟲 | 689055751859208324 | 11 | Novice | 2026-04-14T14:00:43.520Z |
| 餅乾oao | 475247027329171456 | 10 | Novice | 2026-04-14T14:00:42.777Z |
| 雪ノ下かざね🔺 | 538379880996405248 | 9 | Novice | 2026-04-14T14:00:43.012Z |
| shuangjih | 728605307109900319 | 9 | Novice | 2026-04-14T14:00:43.179Z |
| 紫魔 | 1200087356150120540 | 8 | Novice | 2026-04-14T14:00:43.122Z |
| 沒味蟹堡 | 595837539491905536 | 8 | Novice | 2026-04-14T14:00:42.893Z |
| 智軒-tommy3134895 | 551272452676911128 | 7 | Novice | 2026-04-14T14:00:42.688Z |
| sosi | 641514438758891530 | 7 | Novice | 2026-04-14T14:00:43.138Z |
| 大島玉 | 610065281569783818 | 7 | Novice | 2026-04-14T14:00:42.996Z |
| 茶莫 | 603736801710178304 | 7 | Novice | 2026-04-14T14:00:42.705Z |
| BrooF | 378169396595523586 | 7 | Novice | 2026-04-14T13:58:20.915Z |
| 息吹之風 | 234707929259966465 | 7 | Novice | 2026-04-12T12:22:57.408Z |
| Brian_Zhou | 1068978489035857960 | 6 | Novice | 2026-04-14T14:00:43.195Z |
| WG | 1092085184234528898 | 4 | Novice | 2026-04-12T03:06:41.396Z |
| CuchIllo | 1354102125042466929 | 4 | Novice | 2026-04-14T13:58:20.932Z |
| 貓貓咖波 | 849451830239952896 | 3 | Novice | 2026-04-14T14:00:43.084Z |
| トマト | 331642796710821892 | 3 | Novice | 2026-04-14T14:00:42.673Z |
| 四季風 | 540936298567827487 | 3 | Novice | 2026-04-14T14:00:42.932Z |
| 火焰 | 1058147947545624646 | 2 | Novice | 2026-04-14T13:56:00.353Z |
| 包里斯 | 538542893342654465 | 2 | Novice | 2026-04-11T18:06:33.613Z |

排序鍵：`level DESC, exp DESC`。  
PVP 分數欄位未顯示：快照無 `pkRating`。

---

## 五、執行 log 摘要

### `npm run status:update`
```
> equipment-game-platform@0.1.0 status:update
> node scripts/update-current-game-status.js
MongoServerSelectionError: connect ECONNREFUSED 127.0.0.1:27017
  reason: TopologyDescription { type: 'Unknown', servers: { '127.0.0.1:27017' => ... }}
  [cause]: MongoNetworkError: connect ECONNREFUSED 127.0.0.1:27017
退場碼: 1
```

改用 `MONGODB_URI=$MONGODB_CLOUD_URI` 重試：
```
Error: querySrv ECONNREFUSED _mongodb._tcp.cluster0.98efz0z.mongodb.net
  code: 'ECONNREFUSED', syscall: 'querySrv'
退場碼: 1
```

### 沙箱網路檢查
```
$ nslookup google.com
;; UDP setup with 172.16.10.1#53 failed: network unreachable.
;; no servers could be reached
```
→ 沙箱 **沒有任何外網/內網存取**，導致本任務的 Mongo / PM2 全部步驟都無法在伺服器端執行。

### 資料來源代用
- `db-backup/players.json`（mtime 2026-05-14 16:22）— 277 筆玩家基本資料。
- `db-backup/progress.json`（mtime 2026-05-14 16:22）— 277 筆進度，無 `pkRating` / `towerRecord`。
- `docs/CURRENT_GAME_STATUS.md` 最後生成於 2026-05-21T07:45:44.082Z，無玩家排行資料（該文件本身就不含排行）。

---

## 六、結論與建議

1. **凌晨關服未完成**：請使用者於本機 macOS 跑 `npx pm2 stop all`，並用 `npx pm2 status` 確認。
2. **資料總覽未刷新**：請於本機跑 `npm run status:update` 後重看 `docs/CURRENT_GAME_STATUS.md`。
3. **PVP / 爬塔排行**：請使用本報告第二、三節提供的 Mongo aggregate 指令於本機重跑；或請排程任務改為由本機（可存取 Mongo）的 process 觸發，例如 `cron` + `node scripts/...`。
4. **長期解法**：若要讓 Cowork 排程能完成這份報告，需把腳本部署在能連到 Mongo 的環境（本機 / VPS），或開放 admin API 並提供金鑰，由沙箱透過 HTTPS 呼叫（不過沙箱目前連 DNS 都沒有，需先開白名單）。
