# 聖劍士（劍士二轉・A 分支）設計規格 v2

> 狀態：**設計定案，等實作**
> 上位職：劍士 `job_swordsman_v1`　／　姊妹分支：B 分支「大劍」（尚未設計）
> 二轉通則見 [SEASON_V0.4.5_PLAN.md](SEASON_V0.4.5_PLAN.md)
>
> **v2 全面改寫**：v1（格擋率+10、反擊×1.6、疊層）建立在錯誤的戰鬥模型上，
> 實測後發現「強化格擋反擊當輸出」根本不成立（盾反只佔總傷 7～8%），且純數值強化**沒有二轉感**。
> v2 改為**戰鬥姿態**：開打前選攻擊或防禦，兩種姿態的玩法完全不同。

---

## 一、核心概念：開打前選姿態

聖劍士**不是把劍士的數字調高**，而是讓玩家在每一場戰鬥前做選擇。

網頁戰鬥畫面原本中央只有一顆按鈕（開打／排隊共用），裝備聖劍士徽章後**變成兩顆**：

```
        ⚔️ 攻擊              🛡️ 防禦
     （任何武器可用）      （需帶盾，否則不亮）
```

| | ⚔️ 攻擊姿態 | 🛡️ 防禦姿態 |
|---|---|---|
| 格擋率 | 60% → **30%** | 60% → **70%** |
| 屬性 | **保證取得屬性優勢**（見下） | 照原本規則 |
| 格擋成功時 | 原本的格擋反擊 | 原本的格擋反擊 ＋ **盾擊（ATK 60%）** |
| 裝備限制 | 無（雙手武器也可用） | **必須帶盾** |

### 攻擊姿態的屬性機制

依照**對手被剋制的屬性**發動攻擊，也就是**保證站在相剋優勢方**：

| 手上武器的屬性等級 | 視為 | 傷害倍率 |
|---|---|---|
| 0 或 1 | 屬性 2 | **×1.2** |
| 2、3、4 | 屬性 4 | **×1.4** |

意思是「有投資屬性石的人，切到攻擊姿態時直接跳到頂級濃度」。
（`elementSystem.js` 的 `PCT_PER_LEVEL = 0.10`，所以等級 N = ±N×10%。）

---

## 二、實測數據

模型：資料庫真實 Lv50 劍士玩家（STR 21 / AGI 19 / VIT 18 / INT 17 / DEX 16 / LUK 13），
秘銀單手劍＋秘銀盾，ATK 733、HP 2746、基礎格擋 60%。照 `monsterZoneHandlers` 實際呼叫參數重建，N=500。

| 情境 | ⚔️ 攻擊姿態 | 🛡️ 防禦姿態 | 誰贏 |
|---|---|---|---|
| **火屬性怪·焦炎蜥**（打得死） | 屬性2 勝率 67%<br>**屬性4 勝率 90%** | 勝率 67% | **攻擊**（屬性4 時） |
| **火屬性世界王**（打不死） | ×1.2 → 16,168<br>×1.4 → 18,724 | **26,718** | **防禦**（多 43%） |
| **無屬性怪**（83% 的內容） | 23,611 | 23,559 | 幾乎相同 |

**設計成立**：玩家真的要想「這場該用哪個」。

- **打得死的屬性怪** → 攻擊姿態把勝率從 67% 拉到 **90%**
- **打不死的王** → 防禦姿態傷害多 **43%**（格擋 70% 換來 28.3 次格擋反擊，攻擊姿態只有 7.9 次）

### ⚠️ 已知限制：屬性覆蓋率

| | 現況 |
|---|---|
| 啟用怪物有屬性的 | **12 / 69（17%）**，全是火屬性 |
| 有 `elements` 欄位的道具 | **0 件**（屬性石尚未發放） |

無屬性的怪 → `getElementRelation` 回 neutral → 攻擊姿態的加成是 **×1.0**，等於白白少了 30% 格擋。

**所以攻擊鈕目前只在 12 隻火屬性怪身上有意義。**
已確認下一季會讓更多怪帶屬性，屆時攻擊姿態才有普遍價值——這也是聖劍士與屬性系統一起開放的原因。

---

## 三、徽章道具

```js
{
  id: "job_holyblade_t2_v1",
  name: "聖劍士徽章",
  description: "攻守之間，只在一念。出鞘則勢如破竹，持盾則寸步不讓。",
  itemType: "job_badge",
  equipSlot: "job_eq",
  equipStats: { str: 5, vit: 5, dex: 2 },   // 總和 12（一轉徽章是 7~8）
  tier: null, weaponType: null, enhanceLevel: 0
}
```

屬性總和 **12** 是二轉的通用基準，之後 19 個二轉都照這個量級，要調就整批調。

---

## 四、實作設計

### 4-1　姿態設定放在 jobAdvancement（單一來源）

不新增效果 key，姿態是**戰鬥層級的參數**。分支定義帶 `stances`：

```js
// src/shared/jobAdvancement.js
swordsman: [
  {
    id: "job_holyblade_t2_v1",
    key: "holyblade",
    name: "聖劍士",
    theme: "攻守姿態切換",
    towerAura: { key: "party_damage_reduction", value: 8, notes: "爬塔：隊伍受到傷害 -8%" },
    stances: {
      attack:  { label: "攻擊", blockChance: 30, guaranteedElement: { baseLevel: 2, upgradedLevel: 4, upgradeFromWeaponLevel: 2 } },
      defense: { label: "防禦", blockChance: 70, shieldBashPct: 60, requiresShield: true },
    },
  },
],
```

好處：之後別的二轉要做姿態，照同一格式填表即可，combatLoop 不用再長 if。

### 4-2　combatLoop 三個接點

| 位置 | 現況 | 改動 |
|---|---|---|
| `combatLoop.js:3583` | `Math.min(95, (pStats.blockChance \|\| 0) + playerBlockBonus)` | 姿態有指定 `blockChance` 時改用姿態值 |
| `combatLoop.js:1014` | `playerHitMult = bossVulnMult × elementMult × elementBonusMult` | 攻擊姿態時 `elementMult` 改用保證優勢的倍率 |
| `combatLoop.js:3892` | `if (blockedThisRound && pStats.blockCounter …)` | 前面插入盾擊區塊（防禦姿態且格擋成功時） |

`options.stance` 由呼叫端傳入；沒傳 → 行為完全同現況（其他職業零影響）。

### 4-3　API

`POST /api/combat/quick-battle`（`playerAppRoutes.js:2570`）body 新增 `stance: "attack" | "defense"`。

**伺服器端必須驗證**，不能只靠 UI：

- 沒裝聖劍士徽章 → 忽略 `stance`，走現況
- `stance: "defense"` 但沒帶盾 → **直接拒絕**（回錯誤，不靜默退回）
- 未指定 → 預設攻擊姿態

### 4-4　前端（**在另一個 repo**）

`~/Documents/equipmentGAME-app`（分支 `feat/web-dark-fantasy-tower`）
`src/components/BattleLayer.tsx` 約 887 行的中央圓鈕。

- 裝備聖劍士徽章 → 渲染兩顆鈕，否則維持現在一顆
- 防禦鈕在沒帶盾時 disabled ＋ 灰階，加提示「需裝備盾牌」
- 兩顆鈕都要保留現有的**排隊**行為（戰鬥中按 → 排隊；CD 中 → 不可按）
- 排隊時要記住玩家選的姿態，自動進場時沿用

### 4-5　各戰鬥入口的姿態處理

全部呼叫 `runCombatLoop` 的地方（後台戰力計算機不算實戰）：

| 入口 | 位置 | 姿態 |
|---|---|---|
| 網頁一般戰鬥 | `playerAppRoutes.js:2987` | **兩顆按鈕可選** |
| 網頁世界王 | 同上（共用 quick-battle） | **兩顆按鈕可選** |
| 單人王 | `soloBossRoutes.js:176` | **要能選** ← 需另外加 stance 參數與 UI |
| 劇情戰鬥 | `storyRoutes.js:105` | 固定攻擊姿態 |
| DC 一般戰鬥 | `monsterZoneHandlers.js:2990` | 固定攻擊姿態 |
| 爬塔（網頁） | `playerAppRoutes.js:3908` | **下一季會先拿掉爬塔，不處理** |
| 爬塔（DC） | `towerHandlers.js:710` | 同上 |

> 註：先前我把「組隊」列成獨立入口是錯的——`playerAppRoutes.js:3908` 是**爬塔的組隊戰**，
> 屬於爬塔的一部分，遊戲裡沒有獨立的組隊系統。

---

## 五、爬塔光環

| | 一轉劍士 | 聖劍士 |
|---|---|---|
| 光環 | 隊伍受到傷害 −5% | 隊伍受到傷害 **−8%** |

沿用既有 `party_damage_reduction`，只調數值，不需新 key。

---

## 六、二轉試煉

| 欄位 | 值 |
|---|---|
| cadence | `job`（resetPolicy `once`） |
| type | `battle_as_swordsman` |
| target | **350**（第 2／3 個二轉自動變 700／1000） |
| unlockLevel | 35 |
| unlockRequireItemIds | `["job_swordsman_v1"]` |
| isT2Trial | `true` ← 標了就自動套用五道閘門 |
| **enabled** | **`false`** ← 未開放內容一律預設關閉，要開是使用者的決定 |
| rewardItemId | `job_holyblade_t2_v1` |

---

## 七、決策紀錄（皆已定案）

| 項目 | 決定 |
|---|---|
| 防禦姿態沒帶盾 | **API 直接拒絕**（回錯誤，不靜默退回） |
| 世界王 / 單人王 | **要能選姿態** |
| 劇情戰鬥 | 固定攻擊姿態 |
| DC 端 | 固定攻擊姿態，不做按鈕 |
| 爬塔 | 下一季會先拿掉，不處理 |
| 屬性覆蓋率 | 下一季會有更多怪帶屬性，攻擊姿態屆時就有普遍價值 |

---

## 八、v1 作廢原因（存查）

v1 設計是「格擋率+10、格擋反擊×1.6、格擋疊加攻擊層數」。實測推翻：

- **盾反只佔總傷 7～8%**，在它上面乘倍率母數太小，×2.5 也只有 0.86x
- 一般怪「每次格擋都會反擊」是 1:1；只有多段攻擊的世界王會出現「擋多次只反擊一次」
- 真實數據下**雙持才是傷害王**（世界王 34,170）、盾是保命王（陣亡 1% vs 41%），
  v1 那句「盾在硬仗贏兩倍」是壞模型的產物

v1 的錯誤模型（已修正）：玩家 ATK 456→**940**、HP 365→**2591**、怪物 DEF 0%→**75%**，
以及**漏傳 `playerLevel`** 導致等級壓制變成「Lv1 打 Lv44」。
