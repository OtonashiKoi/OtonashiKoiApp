# 戀雀直播預測

> 狀態：已於 2026-09-04 部署正式環境，2026-09-06 改為獨立登入與獨立玩家介面。玩家可見行為以 `src/services/mahjongPrediction/**`、`src/api/routes/mahjongPredictionRoutes.js` 與 MongoDB 現況為準。

## 定位

戀雀預測是直播期間的獨立娛樂預測工具，與 RPG 賭場及玩家金幣／鑽石分開。它使用專屬 Discord OAuth token，只以 Discord ID 辨識戀雀券錢包；不建立 RPG 角色、不要求玩家身分組，也不受音無樂園賽季維護閘門影響。

戀雀券不可購買、贈送、交易、兌現，亦不可兌換任何 RPG 貨幣或道具。

## 目前盤口

- 本局音無恋能和牌嗎：能和牌／不能和牌。
- 本局最終和牌級別：未和牌／1–2 番／3–4 番／滿貫以上。

「下車」屬主觀牌風判斷，現階段不作為可結算盤口。盤口由 Live Studio 主播控制台手動建立，10～120 秒後封盤，也可提前封盤。每位玩家每盤只能投注一次，送出後不能更改。

## 戀雀券與派彩

- 首次啟用錢包：10,000 張。
- 每日領取：1,000 張，以 Asia/Taipei 日期判定。
- 單注：100～5,000 張。
- 彩池制：中獎者取回本金，並依投注占比瓜分落選池的 90%；剩餘 10% 與除不盡尾數回收。
- 作廢：所有成立投注全額退還。

下注、派彩與退款會把錢包、投注單、盤口統計與戀雀券交易台帳包在同一個 MongoDB transaction。每盤每人唯一索引與 `sourceRef` 唯一索引阻止重複下注或重複入帳。

## 入口

- 玩家：獨立介面 `/mahjong-live`；登入成功仍回到此頁，不載入音無樂園主框架、角色、戰鬥、通知或遊戲選單。
- 主播：Live Studio `/studio#koi`。
- OBS：`/static/mahjong-prediction-overlay.html`；`?demo=1&bg=1` 可預覽。

## MongoDB

- `mahjongPredictionWallets`
- `mahjongPredictionTransactions`
- `mahjongPredictionMarkets`
- `mahjongPredictionBets`
- `mahjongPredictionState`
