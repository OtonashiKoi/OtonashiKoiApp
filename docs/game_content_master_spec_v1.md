# 遊戲內容總覽 v1

> ⛔ **歷史文件（2026-08-07 審計標記）**：本總覽為 2026 春季快照，核心數字與公式已大量過時——
> 規模（DB 實查現為 422 玩家／101 怪／537 道具／24 徽章）、公式（MAX_HP 現為 `VIT×25+200`
> `combatStats.js:217`；DEF 改為 flatDef＋equipVit/2% 新模型 `combatStats.js:130`；CRIT `LUK×0.5`；
> 連擊上限 100%；傷害浮動 0.7~1.0）、zone 表（`hard` 區已不存在，現為 15 個 zone `src/shared/zones.js`）、
> 武器缺骰子、職業「7 種」現為 11 一轉＋13 二轉。**整份僅存檔備查，改資料一律以
> `docs/CURRENT_GAME_STATUS.md`（`npm run status:update`）與 `src/shared/*` 為準。**

> 這份文件的目標不是只列功能名稱，而是把目前遊戲內容用白話方式完整拆開，讓你在改下一版資料時，可以直接看出「這一段是什麼」、「會影響哪裡」、「通常要改哪些檔案或欄位」。
>
> 內容基準主要來自：
> - `docs/CURRENT_GAME_STATUS.md`
> - `docs/EXP_TABLE.md`
> - `docs/jobs/職業總覽.md`
> - `docs/tsv/attribute_formula_overview.tsv`
> - `docs/tsv/quests_overview.tsv`
> - `docs/tsv/monster_cards_overview.tsv`
> - `docs/tsv/monster_card_effects_zh.tsv`
> - `docs/tsv/monster_effects_map_tier_draft.tsv`
> - `docs/tsv/idle_zones_v1.tsv`
> - `src/shared/*`
> - `src/services/*`
> - `src/bot/handlers/*`
>
> 目前這份是白話版「完整版設計總覽」，重點放在可讀性和改版定位，不是 API 規格書。

---

## 1. 遊戲到底在玩什麼

這個專案本質上是一款 Discord 為主的角色養成遊戲。

玩家主要會做的事情是：
- 建立角色
- 看自己的資料、錢包、背包、裝備
- 去怪物區打怪
- 在掛機區放置拿資源
- 解任務拿獎勵
- 在商店買東西、在拍賣場交易
- 進 PK 擂台對戰
- 用職業徽章、怪物卡、裝備和強化去堆自己的戰力

整體成長線可以簡單理解成：

`等級 → 屬性點 → 裝備 → 職業徽章 → 怪物卡效果 → 強化 → 任務與活動獎勵 → 更高階區域`

如果你之後要改版本，大多數調整都會落在這幾個方向：
- 打怪快不快
- 練功速度快不快
- 裝備是不是太強
- 任務獎勵是不是太多
- 怪物卡是不是太容易把戰局改壞
- 商店和拍賣是不是太便宜
- 後台版位和權限是不是容易誤關或誤開

---

## 2. 目前遊戲規模

根據 `docs/CURRENT_GAME_STATUS.md` 的生成結果，現在大致是：

| 項目 | 數量 |
| --- | --- |
| 玩家 | 347 |
| 進度資料 | 351 |
| 怪物 | 41 |
| 怪物狀態文件 | 5 |
| 道具 | 259 |
| 任務 | 34 |
| 職業徽章 | 7 |
| 職業任務 | 7 |
| 世界王設定 | 1 |
| 世界王狀態 | 1 |

這代表現在不是一個只有幾個測試功能的小系統，而是一個已經有完整內容結構的遊戲資料庫。

---

## 3. 玩家一進來會看到什麼

### 3.1 玩家主要入口

玩家大多是透過 Discord 內的面板操作，不是一直打指令。

目前常見入口：
- 玩家面板
- 怪物區面板
- 掛機區面板
- PK 擂台面板
- 金幣商店面板
- 任務面板
- 背包 / 裝備 / 強化相關按鈕

### 3.2 玩家面板現在能做什麼

目前玩家面板常見功能包括：
- 建立玩家資料
- 查看我的資料
- 查看我的錢包
- 查看交易紀錄
- 測試獎勵
- 測試經驗

這些按鈕的設計重點是：
- 讓玩家快速看資料
- 讓管理員可以測試資料流
- 讓 Discord 面板成為主要操作入口

### 3.3 玩家面板修改時通常要看哪裡

- `src/bot/playerPanelView.js`
- `src/bot/handlers/playerPanelHandlers.js` 或相關路由
- `src/web/public/admin.bindings.js`
- `src/services/admin/adminConsoleService.js`
- `src/api/routes/adminConsoleRoutes.js`

如果你要改的是「按鈕文字」或「功能可見性」，通常是前端面板和綁定設定。
如果你要改的是「按下去後做什麼」，通常是 handler 或 service。

---

## 4. 等級、經驗、屬性怎麼成長

### 4.1 等級與經驗

等級系統目前有獨立的經驗表。

文件位置：
- `docs/EXP_TABLE.md`

它的用途是定義：
- 升到下一等需要多少經驗
- 累積到某等級總共需要多少經驗

這份表會直接影響：
- 升級速度
- 任務獎勵體感
- 怪物戰鬥成長節奏
- 掛機區收益是否合理

### 4.2 目前的屬性

遊戲屬性核心是：
- `STR`
- `AGI`
- `VIT`
- `INT`
- `DEX`
- `LUK`

白話來說：
- `STR`：偏物理攻擊
- `AGI`：偏速度、迴避、連擊節奏
- `VIT`：偏 HP 與防禦
- `INT`：偏法系輸出、特殊係數
- `DEX`：偏命中與精準輸出
- `LUK`：偏暴擊與運氣類效果

### 4.3 屬性點

角色升級或吃特定道具後，會拿到屬性點或屬性變化。

這些點數通常會影響：
- 攻擊
- HP
- 防禦
- 命中
- 迴避
- 暴擊
- 連擊

### 4.4 改成長時要改哪裡

- 經驗表：`docs/EXP_TABLE.md`
- 屬性公式：`docs/tsv/attribute_formula_overview.tsv`
- 戰鬥屬性計算：`src/shared/combatStats.js`
- 戰鬥迴圈：`src/shared/combatLoop.js`
- 升級、任務、道具效果：`src/services/*`

---

## 5. 戰鬥公式白話版

### 5.1 玩家戰鬥數值來源

玩家戰力不是單看等級，而是由這些部分一起算：
- 基礎屬性
- 已裝備的武器
- 防具與飾品
- 職業徽章
- 怪物卡或特殊效果
- 臨時 buff / debuff

### 5.2 主要公式

根據 `docs/tsv/attribute_formula_overview.tsv`，目前大致是：

| 項目 | 白話理解 |
| --- | --- |
| `ATK_BASE` | 攻擊基礎值依主屬性和武器倍率算，預設走 `STR`，法杖偏 `INT`，弓偏 `DEX` |
| `MAX_HP` | `VIT * 15 + 50` |
| `DEF` | `VIT * 2`，上限 75% |
| `DODGE` | `AGI * 0.5` 再加武器加成，上限 95%（最後會 clamp） |
| `HIT` | `70 + DEX`，上限 100% |
| `CRIT` | `LUK * 0.3`，上限 100% |
| `COMBO` | 基礎 3% 再加 `AGI * 0.5` 和武器加成，上限 80% |
| `DMG_ROLL_MIN` | 傷害浮動下限跟 `INT` 有關，最低不低於 0.5，最高到 0.9 |
| `BLOCK_BASE` | 有盾且不是雙持時，基礎格擋率 20% |

### 5.3 戰鬥流程中的判定

戰鬥中會看這些事：
- 命中有沒有打中
- 怪物或玩家有沒有閃掉
- 有沒有暴擊
- 有沒有連擊
- 有沒有格擋
- 有沒有反擊
- 有沒有斬殺
- 有沒有先手或速度壓制

### 5.4 速度和回合節奏

目前戰鬥節奏不是純固定回合，而是會受到 `AGI` 影響。

文件裡面可以看到：
- `AGI` 會影響 battle tick delay
- `AGI` 高的玩家攻擊節奏會更快
- 如果速度差距夠大，怪物可能會少出手，甚至首回合被壓制

這是很重要的改版點，因為速度屬性如果調太高，整個戰鬥體感會大變。

### 5.5 如果你要改戰鬥難度，通常要動哪裡

- `docs/tsv/attribute_formula_overview.tsv`
- `src/shared/combatStats.js`
- `src/shared/combatLoop.js`
- `src/shared/pkCombat.js`
- `src/bot/handlers/monsterZoneHandlers.js`

---

## 6. 裝備與道具系統

### 6.1 道具類型

目前道具大致分成：
- `consumable` 消耗品
- `collectible` 收藏品
- `equipment` 裝備
- `job_badge` 職業徽章
- `monster_card` 怪物卡

### 6.2 現在數量結構

根據目前狀態文件：
- 裝備：218
- 消耗品：12
- 收藏品：4
- 職業徽章：7
- 怪物卡：18

### 6.3 裝備槽位

目前常見槽位：
- `weapon`
- `shield`
- `armor`
- `garment`
- `shoes`
- `head_top`
- `head_mid`
- `head_low`
- `accessory_l`
- `accessory_r`
- `special`
- `job_eq`

### 6.4 裝備階級套裝效果

一般裝備會依照身上穿著的 D / C / B / A 階件數觸發套裝效果。

計算槽位：
- `weapon`
- `shield`
- `head_top`
- `head_mid`
- `head_low`
- `armor`
- `garment`
- `shoes`
- `accessory_l`
- `accessory_r`

不計算槽位：
- `title_eq`
- `job_eq`
- `special`
- `special_1`
- `special_2`
- `special_3`

| 階級 | 3 件效果 | 5 件效果 | 7 件效果 |
| --- | --- | --- | --- |
| D | STR +3 / INT +3 / DEX +3 | 金幣獲得 +10% | EXP +10% |
| C | 迴避 +10% | 傷害 +5% | 命中 +15% |
| B | 傷害 +10% | 暴擊率 +5% | 暴擊傷害 +10% |
| A | 最終傷害 +5% | Boss 傷害 +10% | 掉落率 +10% |

規則：
- 各階級分開計算件數，可以混搭。
- 同階級效果累積，穿 5 件會同時有 3 件與 5 件效果。
- Boss 傷害只套用在怪物 Boss 戰，不套用在 PK。

### 6.5 武器類型

武器目前主要包括：
- 單手劍
- 雙手劍
- 單手斧
- 雙手斧
- 單手槌
- 雙手槌
- 單手法杖
- 雙手法杖
- 匕首
- 弓

### 6.6 裝備內容在改什麼

裝備不是只改一個數字，它通常會同時影響：
- 主屬性
- 命中 / 迴避
- 暴擊 / 連擊
- 格擋
- 武器倍率
- 特殊效果
- 可否雙持
- 是否能放進拍賣場

### 6.7 道具使用效果

目前常見的消耗品效果包括：
- 增加金幣
- 增加鑽石
- 增加屬性點
- 屬性重製
- 打卡倍率
- 等級下降並隨機失去屬性

這些效果很多是直接在 `shopService` 裡處理。

### 6.8 改道具時要看哪裡

- `src/services/item/itemService.js`
- `src/services/shop/shopService.js`
- `src/services/enhance/enhanceService.js`
- `src/shared/equipmentTierSetBonuses.js`
- `src/shared/effectEngine.js`
- `src/shared/effectDefinitions.js`
- `src/shared/effectDisplayNames.js`

---

## 7. 強化系統

### 7.1 現在的強化概念

目前 D / C / B / A 階裝備可以強化。

強化邏輯白話上就是：
- 消耗對應階級材料
- 消耗金幣
- 看成功率
- 成功後提升裝備價值
- 失敗則材料會被吃掉或結果依規則處理

### 7.2 強化會影響什麼

通常會影響：
- 主屬性值
- 裝備總戰力
- 顯示上的 `+N` 等級
- 任務進度
- 拍賣價值

### 7.3 強化常見修改點

- 強化成本
- 成功率曲線
- `+5` 是否封頂
- D / C / B / A 各階材料需求
- 強化後保留原始效果的規則

### 7.4 修改時要看哪裡

- `src/services/enhance/enhanceService.js`
- `src/shared/enhanceConfig.js`
- `src/services/shop/shopService.js`
- 任務進度：`src/services/weeklyQuest/weeklyQuestService.js`

---

## 8. 職業與職業徽章

### 8.1 現在有幾種職業

目前文件中可以看出至少有 7 種職業：
- 劍士
- 戰士
- 矮人戰士
- 盜賊
- 法師
- 治療師
- 弓箭手

### 8.2 職業定位白話版

- 劍士：平衡型近戰，能守能打
- 戰士：高單發爆發，偏破防與打擊感
- 矮人戰士：控制與坦度比較高
- 盜賊：高機動、高連擊、偏毒和閃避
- 法師：法術輸出和異常狀態
- 治療師：團隊支援與回復光環
- 弓箭手：遠距輸出，偏穩定命中與反應速度

### 8.3 職業徽章作用

職業徽章不是純裝飾，它會直接改戰鬥節奏或特性。

白話說就是：
- 讓職業更像自己的風格
- 讓同樣等級的玩家打起來不一樣
- 讓裝備搭配出現分化

### 8.4 哪些地方會吃到職業效果

- `src/shared/combatStats.js`
- `src/shared/combatLoop.js`
- `src/shared/effectEngine.js`
- `src/services/item/itemService.js`
- `docs/jobs/*.md`

### 8.5 改職業時要注意

- 不要只改名字，要一起看效果和觸發條件
- 職業徽章和戰鬥效果要一起調
- 某些職業會影響 shield / counter / combo / poison / burn 類節奏

---

## 9. 怪物區與戰鬥內容

### 9.1 現在有哪些區域

根據 `docs/CURRENT_GAME_STATUS.md`，目前怪物區分成：

| 區域 | 名稱 | 等級範圍 | 怪物數 | Boss 數 |
| --- | --- | --- | --- | --- |
| beginner | 新手區 | 1 - 3 | 5 | 1 |
| normal | 一般區 | 1 以上 | 8 | 2 |
| mid | 中級區 | 10 以上 | 12 | 2 |
| hard | 高級區 | 20 以上 | 15 | 3 |
| elite | 精英區 | 20 以上 | 1 | 1 |

### 9.2 怪物區的玩法白話版

怪物區不是單純打一次就結束，而是：
- 會有當前怪物
- 會顯示 HP
- 會顯示參戰人數
- 會顯示傷害排行
- 打死後會換下一隻
- 某些區會有 Boss
- 精英區還會有世界王感的結構

### 9.3 玩家打怪的核心回饋

玩家在怪物區會拿到：
- 金幣
- 經驗
- 掉落物
- 可能的卡片或特殊獎勵

### 9.4 怪物戰鬥的結構

戰鬥邏輯大致是：
- 進入區域
- 選定當前怪物
- 收集參戰者
- 根據屬性與裝備算傷害
- 累積傷害排行
- 怪物倒下後結算
- 生成下一隻怪物或切換事件

### 9.5 怪物資料結構

每隻怪物通常會有：
- 名稱
- 區域
- 序號
- 等級
- HP
- EXP
- 金幣
- 入場費
- 是否 Boss
- 掉落數量

### 9.6 目前可看到的怪物資料來源

- `docs/CURRENT_GAME_STATUS.md`
- `docs/MONSTER_LINEUP_V1_SPEC.md`
- `docs/tsv/monster_drops_overview.tsv`
- `docs/tsv/monster_effects_map_tier_draft.tsv`
- `docs/tsv/monster_cards_overview.tsv`
- `src/services/monster/monsterService.js`
- `src/bot/handlers/monsterZoneHandlers.js`

### 9.7 改怪物戰鬥時通常會動哪裡

- 怪物數值：HP / EXP / 金幣 / 入場費
- 怪物排序
- 怪物輪替邏輯
- 怪物掉落表
- Boss 設定
- 區域等級門檻
- 戰鬥公式
- 怪物卡和技能

### 9.8 怪物區改版風險

這個系統最容易出問題的地方是：
- 傷害太高導致怪物瞬間死
- 怪物 HP 太高導致打太久
- 掉落與金幣太多導致經濟膨脹
- 速度公式太強導致先手壓制
- 控制類效果太多導致玩家不能玩

---

## 10. 怪物卡與效果系統

### 10.1 怪物卡是什麼

怪物卡本質上是可以裝備或蒐集的特殊道具。

它的核心不是外觀，而是：
- 提供戰鬥特效
- 讓角色走出不同流派
- 把怪物特色帶到玩家身上

### 10.2 怪物卡階級

目前卡片資料主要分：
- `D`
- `C`
- `B`
- `A`

### 10.3 效果類型大概有哪些

根據現有資料，怪物卡常見效果包含：
- 攻擊提升
- 降攻
- 力量提升
- 防禦提升
- 暴擊率提升
- 生命偷取
- 強效生命偷取
- 中毒
- 燃燒
- 流血
- 暈眩
- 冰凍
- 魅惑
- 沉默
- 反擊
- 雷擊
- 黑暗詛咒
- 遠古之力

### 10.4 這些效果白話怎麼看

- `atk_up`：自己打更痛
- `atk_down`：敵人打更弱
- `str_up`：物理輸出更高
- `def_up`：比較耐打
- `crit_rate_up`：爆擊更容易出現
- `lifesteal`：打出去的傷害一部分回到自己身上
- `poison`：每回合扣最大 HP
- `burn`：也是持續燒血
- `bleed`：持續流血
- `stun`：不能行動
- `freeze`：速度或行動節奏被壓住
- `charm`：受控、行為被影響
- `silence`：不能施放主動技能
- `counter`：受擊時反擊
- `lightning`：雷擊類持續傷害或爆發
- `dark_curse`：全屬性下降
- `ancient_power`：強化輸出

### 10.5 效果在哪些檔案定義

- `src/shared/effectDefinitions.js`
- `src/shared/effectDisplayNames.js`
- `src/shared/effectPayloads.js`
- `src/shared/effectEngine.js`
- `docs/tsv/monster_card_effects_zh.tsv`
- `docs/tsv/monster_effects_map_tier_draft.tsv`

### 10.6 改效果時要注意

這個系統最常見的問題不是「有沒有效果」，而是：
- 同一個效果的中文、資料鍵、觸發條件沒有同步
- 數值在怪物卡和職業徽章之間互相疊太強
- 控制類效果太容易連發
- 持續傷害百分比太高

### 10.7 修改順序建議

如果你要改怪物卡，建議順序是：
1. 先改資料表
2. 再確認效果鍵有沒有對上
3. 再看戰鬥中是否真的會觸發
4. 最後再調文案和 UI 顯示

---

## 11. 怪物掉落與道具來源

### 11.1 現在道具來源大概有哪些

道具主要來源：
- 怪物掉落
- 商店購買
- 任務獎勵
- 管理員發放
- 活動或特殊結算
- 拍賣場交易

### 11.2 道具類型和用途

- 消耗品：用掉後直接生效
- 裝備：裝上去改屬性
- 收藏品：偏展示
- 怪物卡：戰鬥特效
- 職業徽章：職業特性

### 11.3 掉落資料在哪

- `docs/tsv/monster_drops_overview.tsv`
- `docs/CURRENT_GAME_STATUS.md`
- `src/services/monster/monsterService.js`
- `src/services/reward/*` 或相關獎勵服務

### 11.4 改掉落時最該注意

- 掉落數量
- 稀有度
- 是否會造成經濟爆炸
- 是否讓低階區太快畢業
- 是否會讓拍賣場失去價值

---

## 12. 任務系統

### 12.1 任務種類

目前可以看出有：
- 新手任務 / onboarding
- 每日任務 / daily
- 每週任務 / weekly
- 職業任務

### 12.2 任務在做什麼

任務系統本質上是：
- 讓玩家知道現在該做什麼
- 讓玩家拿穩定獎勵
- 引導玩家用到戰鬥、裝備、商店、掛機等不同系統

### 12.3 任務資料內容

每個任務通常會有：
- ID
- 名稱
- 類型
- 目標值
- 金幣獎勵
- 經驗獎勵
- 鑽石獎勵
- 道具獎勵
- 重置規則
- 排序
- 啟用狀態

### 12.4 任務目前資料來源

- `docs/tsv/quests_overview.tsv`
- `src/services/weeklyQuest/weeklyQuestService.js`
- `src/services/quest/*` 或相關流程

### 12.5 你改任務通常會改什麼

- 目標值
- 獎勵金額
- 每日 / 每週重置政策
- 任務排序
- 是否啟用
- 新任務是一次性還是可重複

### 12.6 任務改版風險

- 奬勵過高會讓經濟快速膨脹
- 目標太難會讓玩家直接放棄
- 目標太容易會失去任務感

---

## 13. 掛機區

### 13.1 掛機區玩法

掛機區是放置型玩法，重點是：
- 玩家不用一直按
- 主要拿金幣和經驗
- 風險低、節奏穩

### 13.2 現在掛機區分級

根據 `docs/tsv/idle_zones_v1.tsv`，目前有 5 個掛機區：

| 區域 | 名稱 | 適用等級 | 最短可領 | 掛機上限 | 冷卻 |
| --- | --- | --- | --- | --- | --- |
| idle-beginner-zone | 新手放置區 | 1 - 3 | 5 分鐘 | 240 分鐘 | 5 分鐘 |
| idle-normal-zone | 一般放置區 | 1 - 10 | 8 分鐘 | 360 分鐘 | 8 分鐘 |
| idle-mid-zone | 中級放置區 | 10 - 25 | 10 分鐘 | 480 分鐘 | 10 分鐘 |
| idle-hard-zone | 高級放置區 | 20 - 40 | 12 分鐘 | 600 分鐘 | 12 分鐘 |
| idle-elite-zone | 精英放置區 | 30 以上 | 15 分鐘 | 720 分鐘 | 15 分鐘 |

### 13.3 掛機區獎勵結構

掛機獎勵目前依區域和等級段落分層，白話說就是：
- 等級越高，單位時間收益越高
- 高階區有更好的效率
- 但也會有更高門檻

### 13.4 改掛機區時看哪裡

- `docs/tsv/idle_zones_v1.tsv`
- `src/services/idle/idleService.js`
- `src/bot/handlers/idleZoneHandlers.js`

### 13.5 掛機區常見調整目標

- 讓前期更順
- 讓中期不會太卡
- 限制高等長期刷太快
- 調整收益曲線

---

## 14. 金幣商店

### 14.1 商店在遊戲中的角色

商店是整個經濟系統的出口之一。

它主要做兩件事：
- 把資源變成消耗
- 把玩家手上的貨幣轉成進度或便利性

### 14.2 商店商品可能包含

- 消耗品
- 裝備
- 特殊功能道具
- 任務導向商品
- 可能的限購品

### 14.3 商店背後的效果邏輯

目前可見的商店使用效果有：
- 加屬性點
- 打卡倍率
- 屬性重製
- 等級下降並隨機失去屬性

這代表商店不只是賣補品，還會影響成長節奏。

### 14.4 商店修改點

- `src/services/shop/shopService.js`
- `src/services/item/itemService.js`
- `src/web/public/*`
- `docs/CURRENT_GAME_STATUS.md` 或商店相關資料表

### 14.5 商店改版風險

- 價格太低會讓經濟失衡
- 太多功能型道具會直接跳過正常成長
- 可重複購買的道具若不限制，會很快出問題

---

## 15. 拍賣場

### 15.1 拍賣場是做什麼

拍賣場是玩家之間交易的地方。

它的作用是：
- 讓多餘裝備有去處
- 讓稀有物有市場
- 讓玩家之間形成貨幣流動

### 15.2 可以上架什麼

目前拍賣場常見能上架的東西：
- 裝備
- 怪物卡
- 寶石或材料

不允許或限制的類型則會被擋下，例如職業徽章這種比較核心的東西通常會限制。

### 15.3 拍賣場常見規則

- 有上架時間
- 有價格
- 有幣別
- 有數量限制
- 有下架 / 失效規則
- 不能買自己的商品

### 15.4 改拍賣場要看哪裡

- `src/services/auction/auctionService.js`
- `src/bot/handlers/auctionZoneHandlers.js`
- 拍賣相關 repository / routes

### 15.5 拍賣場風險

- 交易太容易會讓商店失去意義
- 太難上架會讓市場死掉
- 稅率或手續費太高會讓玩家不想用

---

## 16. PK 擂台

### 16.1 PK 擂台在玩什麼

PK 擂台是玩家對玩家的對戰玩法。

白話上就是：
- 看雙方戰力
- 看等級區間是否允許
- 可以下注
- 結束後給結果和獎勵

### 16.2 現在的分級概念

擂台不是所有人混在一起，而是有等級分段。

這樣做的目的：
- 不讓低等完全沒機會
- 不讓高等直接壓扁所有人
- 讓不同等級都能找到對手

### 16.3 PK 裡會影響什麼

- 玩家屬性
- 裝備
- 怪物卡 / 徽章
- 戰鬥公式
- 下注金額
- 獎勵發放

### 16.4 PK 修改點

- `src/shared/pkArenaConfig.js`
- `src/bot/handlers/pkArenaHandlers.js`
- `src/shared/pkCombat.js`
- `src/bot/pkArenaView.js`

### 16.5 PK 改版風險

- 如果獎勵太高，大家會只打 PK
- 如果戰鬥太偏向先手，公平性會差
- 如果下注太容易，容易變成高風險貨幣池

---

## 17. 後台與 Discord 版位配置

### 17.1 你剛剛看到的那個版位配置是什麼

你截圖裡的那個 `DISCORD 版位配置`，本質上是在做：
- 哪個頻道綁哪個功能
- 玩家能不能看到
- 管理員能不能看到
- 這個功能有沒有啟用

### 17.2 常見欄位意思

- `channelId`：要發到哪個 Discord 頻道
- `enabled`：這個功能本身有沒有開
- `visibleTo.player`：玩家看不看得到
- `visibleTo.admin`：管理員看不看得到
- `featureKey`：這是什麼功能

### 17.3 後台可以控制什麼

目前後台可做的事大致包括：
- 指定面板要發到哪個頻道
- 切換玩家 / 管理員可見性
- 同步 Discord 權限
- 發布玩家面板
- 管理管理員與玩家白名單

### 17.4 怪物區面板怎麼關

如果你要關的是怪物戰鬥面板，通常是：
- 找到對應的 `monster_zone_*` 綁定
- 把玩家可見關掉
- 或把 `enabled` 關掉
- 再同步 Discord 權限

### 17.5 後台對應檔案

- `src/web/public/admin.bindings.js`
- `src/services/admin/adminConsoleService.js`
- `src/api/routes/adminConsoleRoutes.js`
- `src/shared/zones.js`
- `src/bot/handlers/monsterZoneHandlers.js`

### 17.6 這裡最容易誤會的地方

「關閉面板」不一定等於「刪掉功能」。

通常會分成三層：
- 不給玩家看
- 只留管理員看
- 完全停用這個功能

你前面提到的需求，比較像是第一層或第二層，而不是直接改程式刪功能。

---

## 18. 直播 / 打卡 / 身分綁定

### 18.1 這些系統在做什麼

這部分主要是把外部互動資料帶進遊戲裡。

常見用途：
- 直播聊天室打卡
- 身分標籤判斷
- 支援者 / 會員辨識
- 任務進度記錄

### 18.2 會影響什麼

- 打卡獎勵
- 任務進度
- 特定商品解鎖
- 支援者相關商品效果

### 18.3 修改點

- `src/bot/handlers/streamHandlers.js`
- `src/services/shop/shopService.js`
- `src/services/weeklyQuest/weeklyQuestService.js`

---

## 19. 目前最重要的資料檔索引

如果你要改資料，通常先看這些：

### 19.1 基礎與總覽

- `docs/CURRENT_GAME_STATUS.md`
- `docs/EXP_TABLE.md`
- `docs/game_content_master_spec_v1.md` 這份文件

### 19.2 戰鬥與公式

- `docs/tsv/attribute_formula_overview.tsv`
- `src/shared/combatStats.js`
- `src/shared/combatLoop.js`
- `src/shared/pkCombat.js`

### 19.3 怪物與掉落

- `docs/tsv/monster_drops_overview.tsv`
- `docs/tsv/monster_cards_overview.tsv`
- `docs/tsv/monster_card_effects_zh.tsv`
- `docs/tsv/monster_effects_map_tier_draft.tsv`
- `docs/MONSTER_LINEUP_V1_SPEC.md`

### 19.4 任務與掛機

- `docs/tsv/quests_overview.tsv`
- `docs/tsv/idle_zones_v1.tsv`
- `src/services/weeklyQuest/weeklyQuestService.js`
- `src/services/idle/idleService.js`

### 19.5 裝備、道具、商店

- `src/services/item/itemService.js`
- `src/services/shop/shopService.js`
- `src/services/enhance/enhanceService.js`
- `src/shared/enhanceConfig.js`

### 19.6 後台與版位

- `src/web/public/admin.bindings.js`
- `src/services/admin/adminConsoleService.js`
- `src/api/routes/adminConsoleRoutes.js`
- `src/bot/handlers/monsterZoneHandlers.js`

---

## 20. 如果你要改下一版，建議怎麼動

### 20.1 想改「成長速度」

優先改：
- 經驗表
- 任務獎勵
- 掛機收益
- 怪物 EXP / 金幣
- 商店消耗品

### 20.2 想改「戰鬥體感」

優先改：
- 戰鬥公式
- 命中 / 迴避 / 暴擊
- 速度差
- 怪物 HP
- 怪物卡效果

### 20.3 想改「經濟平衡」

優先改：
- 金幣來源
- 鑽石來源
- 商店價格
- 拍賣場上架規則
- 任務金額
- 掛機收益

### 20.4 想改「內容豐富度」

優先改：
- 任務種類
- 怪物卡
- 掉落物
- 職業徽章
- 新怪物
- 新掛機區

### 20.5 想改「後台管理方便度」

優先改：
- 版位綁定
- 面板可見性
- 同步權限流程
- 後台說明文字

---

## 21. 我建議你接下來的改版順序

如果你是要開始改資料，我建議順序這樣排：

1. 先定大方向
   - 這版要偏快成長還是偏慢成長
   - 要偏戰鬥還是偏收集
   - 要偏 PvE 還是偏 PvP

2. 先改數值資料
   - 經驗表
   - 怪物數值
   - 任務獎勵
   - 掛機收益
   - 商店價格

3. 再改效果資料
   - 怪物卡
   - 職業徽章
   - 消耗品效果

4. 再改 UI 和文案
   - 面板文字
   - 頻道名稱
   - 按鈕說明

5. 最後再做後台權限與發布調整
   - 哪些功能要開給玩家
   - 哪些只留管理員
   - 哪些要整個停掉

---

## 22. 簡短結論

這個遊戲現在的內容已經不是單一功能，而是一整套：
- 戰鬥
- 掛機
- 任務
- 商店
- 拍賣
- PK
- 職業
- 怪物卡
- 後台版位控制

如果你下一版要改資料，最實際的做法不是先亂動 UI，而是先按下面順序去看：
1. `docs/CURRENT_GAME_STATUS.md`
2. `docs/EXP_TABLE.md`
3. `docs/tsv/attribute_formula_overview.tsv`
4. `docs/tsv/quests_overview.tsv`
5. `docs/tsv/monster_cards_overview.tsv`
6. `docs/tsv/idle_zones_v1.tsv`
7. `src/shared/combatStats.js`
8. `src/shared/effectDefinitions.js`
9. `src/services/shop/shopService.js`
10. `src/services/admin/adminConsoleService.js`

如果你要，我下一步可以直接幫你把這份文件再拆成兩份：
- `玩家看得懂版`
- `改資料專用版`
