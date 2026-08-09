# 賭徒職業 + 骰子武器類型 設計規格 v3

> 狀態：**武器已定案並實作完成**；賭徒技能待重新設計（見第四節備註）
> 範圍：第 11 個一轉職業「賭徒」、新武器類型 `dice`（骰子）
> 不含：二轉系統（另案，門檻 Lv.35 / 上限 3 個二轉徽章 / 遞增 ×2.5 ×5）
>
> 版本沿革：
> - v1 `mult 4 / critBonus 25` → 實測超模 1.55 倍，作廢
> - v2 `mult 3 / 不給 critBonus` → 1.06x，數值 OK 但機制平淡
> - **v3（現行）** 改為雙手武器、倍率減半、每回合固定兩擊、每擊各擲一顆 d6 決定傷害倍率
>
> 註：職業試煉條件已定為 `battle_with_dice` 出戰 10 次（與其他 10 個職業格式一致），
> 原先討論的 `casino_spend`（賭場累積下注）保留給二轉使用。

---

## 一、設計立足點

`luk` 是全遊戲唯一沒有武器以它為攻擊屬性的基礎屬性。骰子吃 luk，等於開一條全新 build 路線，不跟既有 10 個職業互搶。

但這裡有個**必須先看清楚的陷阱**：LUK 在現行戰鬥系統裡已經有三重收益。

| LUK 的既有收益 | 位置 | 效果 |
|---|---|---|
| 爆擊率 | `combatStats.js:180` | `crit = LUK × 0.5 + 武器 critBonus` |
| 攻擊擲骰階級 | `combatStats.js:285` | 大成功 +0.05%/點、大失敗 −0.05%/點 |
| 防禦擲骰階級 | `combatStats.js:309` | 被爆打 −0.05%/點、減傷 +0.05%/點、擦傷 +0.033%/點 |

如果骰子再把 LUK 變成 ATK，就是**四重加成疊在同一個屬性上**。這是 v1 數值爆掉的根本原因——不是我倍率填太高，是 luk 本身的邊際收益遠高於 str/dex/int。

---

## 二、平衡試算（實跑 `calcPlayerStats`）

模型：Lv50、總屬性點 104（實查 `progress` 資料）、主屬性壓 55、S 階武器、對應職業徽章。期望 DPS 含爆擊率、爆擊 ×2、攻擊擲骰階級、傷害浮動、連擊率、武器主屬性 ×1.5 追加傷害。

### 既有職業基準

| 職業 / 武器 | ATK | 爆率 | 連擊 | 期望 DPS | 承傷倍率 |
|---|---|---|---|---|---|
| 劍士 + 真銀單手劍 (STR) | 316 | 1.5% | 7% | 441 | 0.945 |
| 盜賊 + 真銀匕首 (AGI) | 225 | 2.0% | 60.5% | **518**（最強） | 0.944 |
| 弓箭手 + 真銀弓 (DEX) | 316 | 2.5% | 9.5% | 467 | 0.923 |
| 法師 + 真銀雙手杖 (INT) | 316 | 2.0% | 7% | 478 | 0.944 |

平均 476、最強 518。

### 骰子各數值方案

含賭徒被動（持骰子時爆率 +10、爆傷 +20）：

| 方案 | ATK | 爆率 | 期望 DPS | vs 平均 | vs 最強 |
|---|---|---|---|---|---|
| `mult 4 / crit +25` ← **v1 提案** | 316 | 74.5% | 804 | 1.69x | **1.55x** ❌ |
| `mult 4 / crit +0` | 316 | 49.5% | 689 | 1.45x | 1.33x ❌ |
| `mult 3 / crit +25` | 237 | 74.5% | 636 | 1.34x | 1.23x ❌ |
| `mult 3 / crit +15` | 237 | 64.5% | 601 | 1.26x | 1.16x ⚠️ |
| **`mult 3 / crit +0`** ← **v2 採用** | 237 | 49.5% | 549 | 1.15x | **1.06x** ✅ |
| `mult 2.5 / crit +15` | 198 | 64.5% | 524 | 1.10x | 1.01x |

### 早期對照（Lv15、C 階武器、總點數 34）

| 職業 | ATK | 爆率 | 期望 DPS |
|---|---|---|---|
| 劍士 + 鐵製單手劍 | 116 | 1.0% | 153 |
| 盜賊 + 鐵製匕首 | 81 | 1.5% | 154 |
| **賭徒 + 鐵製骰子** | 84 | 24.0% | **140** |

**這是理想的成長曲線**：早期略弱（−9%），後期靠 LUK 堆疊追平並小幅超前（+6%）。玩家需要投入才拿得到回報，不是一轉職就無腦最強。

### 承傷副作用（必須知道）

賭徒承傷倍率 **0.915**，其他職業 0.923～0.945。也就是說賭徒在輸出持平的同時**還比所有職業耐打 3%**，這是 LUK 影響防禦擲骰的副產品，無法在武器層關掉。

這 3% 是我接受 `1.06x` 輸出上限的原因——如果輸出再給到 1.15x，實際綜合強度會逼近 1.20x。

---

## 三、最終數值（v3 定案）

### WEAPON_CONFIG（`src/shared/combatStats.js:20`）

```js
dice: {
  mult: 1.5,
  baseStat: "luk",
  isTwoHanded: true,
  attackSegments: 2,
  faceMultipliers: [0.5, 0.75, 1.0, 1.0, 1.25, 1.5],
  allMinMult: 0.5,
  allMaxMult: 2.5,
  // 魔法傷害判定（使用者定案 2026-07-24，晚於本文 v3）：骰子傷害視為魔法——
  // 常駐無視 25% DEF，與雙手法杖同級。✅ combatStats.js:58
  bypassDefPct: 25,
},
```

| 欄位 | 值 | 理由 |
|---|---|---|
| `mult` | **1.5** | 「倍率減半、固定打兩次」，總量與單段 mult 3 相當 |
| `baseStat` | `luk` | 全遊戲唯一。需在 `combatStats.js` 的 baseStat 解析新增 agi/luk 分支 |
| `critBonus` | **不設** | 爆擊率 100% 由玩家自己堆的 LUK 決定 |
| `isTwoHanded` | **true** | 不能配盾，少 20% 格擋與副手屬性——這是實質代價 |
| `attackSegments` | **2** | 每回合固定兩擊，**不計入連擊**（不加 comboCount、不吃連擊增傷、不受連擊率影響） |
| `faceMultipliers` | 見下 | 每段各擲一顆 d6，骰面決定該段傷害倍率，純運氣、不看屬性 |
| `allMinMult` / `allMaxMult` | 0.5 / 2.5 | 全 1 / 全 6（各 1/36）時，每段倍率改寫成此值 |
| `bypassDefPct` | **25**（後補定案） | 骰子傷害視為魔法，常駐無視 25% DEF（與 staff_2h 同級）；2026-07-24 使用者定案，✅ [combatStats.js:58](../src/shared/combatStats.js#L58) |

### 骰面倍率

| 骰面 | 【1】 | 【2】 | 【3】 | 【4】 | 【5】 | 【6】 |
|---|---|---|---|---|---|---|
| 傷害倍率 | ×0.5 | ×0.75 | **×1.0** | **×1.0** | ×1.25 | ×1.5 |

平均 `(0.5+0.75+1+1+1.25+1.5)/6 = 1.0`，**不影響整體平衡，只放大方差**。

### 判定順序（重要）

**攻擊一開始就把兩顆骰全部擲出**（全 6 / 全 1 需要先知道兩顆結果才能判定）。
命中／迴避／攻擊階級對整輪**只判定一次**，兩擲共用——所以迴避就是兩擲一起被閃，不會出現「全六卻有一擲落空」的矛盾。

⚠️ **骰面倍率必須套在整個傷害算完的最尾端**（含爆擊與武器主屬性固定加成之後）。實作時踩過兩個坑：
1. 武器主屬性追加傷害（LUK×1.5≈119 點固定值）是最後才加的，若骰面套在前面就不會被縮放；骰子 ATK 只有 119，固定加成佔每擊近一半，會把骰面效果稀釋掉。
2. 爆擊路徑會從 `attackBase` 重新計算傷害，套在前面的骰面倍率會被整個丟掉。

兩個坑一起踩的結果：1+1 只掉到 84%、6+6 只到 144%（設計是 50% / 250%）。

### 實測驗證（N=4000 場，每組 550～1250 次樣本）

| 組合 | 佔基準 | 組合 | 佔基準 |
|---|---|---|---|
| **1+1** | **48%**（設計 50%）✅ | 3+4 | 98% |
| 1+2 | 62% | 4+5 | 109% |
| 1+4 | 71% | 3+6 | 121% |
| 2+3 | 84% | 5+6 | 136% |
| 1+6 | 98% | **6+6** | **243%**（設計 250%）✅ |

`1+6` 一好一壞回到 98% 基準、`3+4` 也是 98%，符合「3、4 是平均」。

### 傷害隨敵方防禦變化（與單段 mult 3 相比）

| 怪物 flatDef | 單段 mult3 | 雙段 mult1.5 | 比值 |
|---|---|---|---|
| 0 | 465 | 519 | 1.12x |
| 20 | 439 | 461 | 1.05x |
| 60 | 379 | 362 | 0.95x |

兩股力量抵銷：武器主屬性固定加成**每段各加一次等於翻倍**（低防怪變強），但 flatDef 每擊各扣一次、ATK 減半後被扣比例變大（高防王變弱）。
**結果：賭徒打雜魚偏強、打高防王偏弱**，這是這把武器的性格。

### 戰報樣式

```
🎲 擲出 【5】【3】
⚔️ ⚡大成功！骰面翻出一個好數字，隨手一擲定生死，造成 213 點傷害（🛡️減傷）！
🎲 【3】⚡大成功！第 2 擲！再造成 220 點傷害！

🎲 擲出 【6】【6】　—　全六！命運之骰全開，本回合傷害 250%！
🎲 擲出 【1】【1】　—　全一…手氣爛透了，本回合傷害只剩 50%。
```

### 骰子武器線（9 件，完全對齊 bow 曲線）

| 階 | 名稱 | equipStats | setKey | id |
|---|---|---|---|---|
| D | 木製骰子 | agi 1, luk 2 | `basic_d` | (uuid) |
| C | 鐵製骰子 | agi 2, luk 5 | `basic_c` | (uuid) |
| B | 鋼製骰子 | agi 3, luk 12 | `basic_b` | (uuid) |
| A | 秘銀骰子 | agi 4, luk 19 | `mithril_p` | (uuid) |
| A | 焰紋骰子 | agi 4, luk 19 | `hellfire_p` | `fire-a-wpn-dice` |
| A | 亞龍骨骰 | agi 4, luk 19 | `dragonscale_p` | `dragon-a-wpn-dice` |
| S | 真銀骰子 | agi 4, luk 19 | `mithril_p` | `mithril-s-wpn-dice` |
| S | 獄焰・炎狼骰 | agi 4, luk 19 | `hellfire_p` | `fire-s-wpn-dice` |
| S | 幼龍骨骰 | agi 4, luk 19 | `dragonscale_p` | `s-dragon-dice` |

命名慣例、id 慣例、屬性曲線均比照 `bow`（副屬 agi + 主屬）。`description` 照既有格式「{階} 級 武器」。圖先用佔位圖。

### 完整道具 JSON 範本

```js
{
  id: "mithril-s-wpn-dice",
  name: "真銀骰子",
  description: "S 級 武器",
  itemType: "equipment",
  equipSlot: "weapon",
  equipStats: { str: 0, agi: 4, vit: 0, int: 0, dex: 0, luk: 19 },
  weaponType: "dice",
  isTwoHanded: true,
  atkStat: "luk",
  tier: "S",
  setKey: "mithril_p",
  setKeys: ["mithril_p"],
  imageUrl: "<佔位圖>",
  effect: { type: "none", value: 0 },
  combatEffects: [], passiveEffects: [], procEffects: [], useEffects: []
}
```

---

## 四、賭徒徽章

### 道具本體

```js
{
  id: "job_gambler_v1",
  name: "賭徒徽章",
  description: "以命運為武器的人。LUK 決定一切——傷害、爆擊、閃避，甚至你今天的運氣。",
  itemType: "job_badge",
  equipSlot: "job_eq",
  equipStats: { str: 0, agi: 2, vit: 0, int: 0, dex: 1, luk: 5 },  // 總和 8，對齊既有徽章
  tier: null, weaponType: null, enhanceLevel: 0,
  passiveEffects: [ ... ], procEffects: [ ... ], jobSkills: [ ... ]
}
```

### 被動 `passiveEffects`

| key | 值 | 條件 | 說明 |
|---|---|---|---|
| `crit_rate_up` | +10 | `weaponType: dice` | 持骰子才生效，鼓勵用本職武器 |
| `crit_damage_up` | +20 | `weaponType: dice` | 賭徒的爆發來源 |
| `gold_gain_up` | +15 | 無條件 | 經濟味。**不綁武器**，讓玩家可以先轉職再慢慢湊骰子 |
| `rare_drop_rate_up` | +5 | 無條件 | LUK 的主題呼應 |

```js
passiveEffects: [
  { key: "crit_rate_up",   target: "self", trigger: "passive", chance: 100,
    params: { value: 10 }, condition: { weaponType: "dice" }, notes: "持骰子：爆擊率+10%" },
  { key: "crit_damage_up", target: "self", trigger: "passive", chance: 100,
    params: { value: 20 }, condition: { weaponType: "dice" }, notes: "持骰子：爆擊傷害+20%" },
  { key: "gold_gain_up",   target: "self", trigger: "passive", chance: 100,
    params: { value: 15 }, notes: "金幣獲得+15%" },
  { key: "rare_drop_rate_up", target: "self", trigger: "passive", chance: 100,
    params: { value: 5 }, notes: "稀有掉落+5%" }
]
```

### 觸發 `procEffects`

```js
procEffects: [
  { key: "proc_extra_hit", target: "enemy", trigger: "on_attack", chance: 15,
    params: { value: 100 }, condition: { weaponType: "dice" }, notes: "再擲一次：15% 追加一擊" }
]
```

### 主動技能 `jobSkills`

⚠️ 賭徒的技能**不吃其他職業那套「每回合 35% 機率隨機發動一個」的閘門**，改用自訂 `trigger` 走自己的觸發條件。
實作方式：`jobSkills` 帶 `trigger` 欄位的技能會被排除在 35% 隨機池之外，由 combatLoop 各自的觸發點處理。

#### 將大局逆轉吧 — `trigger: "on_dice_one"`，CD 2

當回合有骰子擲出【1】時**必定發動**（不擲機率），重骰那顆【1】，並自身 LUK+15 持續 1 回合。

```js
{
  key: "gambler_turn_the_table",
  name: "將大局逆轉吧",
  description: "當回合有骰子擲出【1】時，重骰該顆骰子，並自身LUK+15持續1回合。",
  trigger: "on_dice_one",
  cooldownTurns: 2,
  condition: {},
  procEffects: [
    { key: "luk_up", target: "self", params: { value: 15, duration: { mode: "turns", value: 1 } } }
  ]
}
```

觸發點在 combatLoop 的擲骰處，且**重骰之後才判定全 1 / 全 6**——所以重骰有機會把【1】【1】救成【6】【6】。

戰報：
```
✨ **(賭徒徽章)** 發動【將大局逆轉吧】！【1】【5】 → **【6】【5】**
🎲 擲出 【6】【5】
```

實測 13,453 個攻擊回合：觸發 3,313 次，**重骰前 100% 都含【1】**；含【1】的回合佔比從理論 30.6% 壓到 10.7%（CD2 會擋掉一部分，符合預期）。

#### 千術 — `trigger: "round_start_chance"`，chance 50，CD 3

回合開始擲 50%，發動則敵方本回合攻擊**必定大失敗**（自傷 30% 並跳過該次攻擊）。

```js
{
  key: "gambler_loaded_dice",
  name: "千術",
  description: "50%機率發動：敵方本回合攻擊必定大失敗（自傷並無法攻擊）。",
  trigger: "round_start_chance",
  chance: 50,
  cooldownTurns: 3,
  condition: {},
  procEffects: [
    { key: "force_crit_fail", target: "enemy", params: { value: 100, duration: { mode: "turns", value: 1 } } }
  ]
}
```

怪物大失敗的自傷邏輯本來就存在（`combatLoop.js` 的 `mAtkTier === 'critFail'` 分支），這裡只是加一個 `forceMonsterCritFail` 旗標強制走進去。

⚠️ **已知互動**：玩家 AGI 比怪物高 5 以上時，怪物只會在偶數回合攻擊。千術若發動在怪物本來就不出手的回合就**白白浪費**。實測玩家 AGI 壓制時只有約 53% 的千術造成大失敗；怪物 AGI 拉高（每回合都攻擊）時為 100%。這是既有 AGI 機制的自然結果，非 bug。

### 爬塔光環（`towerHandlers.js` 的 `JOB_TRAITS`）

**全隊爆擊率 +5%** — 與軍師（隊傷 +5%）、盜賊（連擊 +5%）、弓箭手（Boss 傷害 +5%）都區隔開。

---

## 五、與傳說錨點「骰・命運之輪」的互動

遊戲裡已經有一件 S 階傳說錨點 `s-legend-dice`「骰・命運之輪」（`equipSlot: anchor`，LUK +20）：

- `crit_rate_down` 100% — 完全關閉一般爆擊
- `variance_crit` — 改成「LUK × 0.3% 機率打出 ×4 大爆」，期望守恆、方差暴增

**這件錨點根本就是為賭徒預留的**，而且數值上驚人地平衡。Lv50 賭徒戴上後 LUK = 99：

| 路線 | 計算 | 期望傷害倍率 |
|---|---|---|
| 穩定爆擊（戴普通錨點） | 59.5% × 2.4 + 40.5% × 1 | **1.833** |
| 方差大爆（戴命運之輪） | 29.7% × 4 + 70.3% × 1 | **1.891** |

兩條路差 3%，等於玩家是在選「穩定 vs 方差」而不是選「弱 vs 強」。這是很漂亮的 build 分歧，**不需要額外調整**。

> 這也反過來驗證了 `mult 3 / critBonus 0` 是對的：如果骰子自帶 critBonus，穿命運之輪的玩家會白白浪費武器詞條。

---

## 六、職業試煉任務（✅ 實裝版＝`battle_with_dice`）

實裝版與其他 10 個職業格式一致（seed：[weeklyQuestService.js:937](../src/services/weeklyQuest/weeklyQuestService.js#L937)，DB 同）：

| 欄位 | 值 |
|---|---|
| cadence | `job`（resetPolicy `once`） |
| type | **`battle_with_dice`**（metric 定義在 `weeklyQuestService.js:14`） |
| target | **使用骰子出戰 10 次** |
| unlockLevel | 10、基礎 LUK + AGI > 10、`unlockWeaponTypes: ["dice"]` |
| rewardItemId | `job_gambler_v1`（＋500 金幣） |
| 附送 C 階武器 | 鐵製骰子（`jobBadgeBonus.js:32` 的 `BADGE_TO_WEAPON_NAME`） |
| enabled | `false`（骰子外洩事件後關閉；開放口徑待與使用者確認） |

### ⛔ 作廢：`casino_spend`（賭場累積下注 500 萬）方案

原提案「以賭場累積下注 500 萬解鎖」**未採用為一轉試煉**，保留作**二轉備案**
（實際上 DB 的「賭神試煉」現為 `type: t2_transfer`，`casino_spend` metric 至今未實作）。
原方案的數值依據（casinoBets 實查：平均單注 147,516、500 萬 ≈ 34 次下注、累積不回溯）
與登記點清單（weeklyQuestService／casinoService／admin.weekly.js）僅存檔，不再是待辦。

---

## 七、玩家體驗流程

1. Lv.10 前 —— 職業任務分頁看得到「賭徒試煉」但灰色鎖定（沿用現有 job cadence 顯示邏輯）
2. Lv.10 —— 解鎖，任務顯示「賭場累積下注 0 / 5,000,000」
3. 去賭場下注，每次下注即時累積
4. 達標領獎 —— 拿到「賭徒徽章」＋自動附送「鐵製骰子」（C 階）
5. 裝備徽章到 `job_eq` 槽（Lv.10 門檻已滿足）→ 正式成為賭徒
6. 此時金幣 +15%、稀有掉落 +5% 立刻生效；換上鐵製骰子後 ATK 改吃 LUK
7. 玩家開始把屬性點投 LUK → 同時獲得 ATK、爆擊率、攻擊擲骰、防禦擲骰四重成長
8. 後期目標：S 階骰子 + 傳說錨點「骰・命運之輪」的方差 build

---

## 八、改動清單（✅ 已全部實作完成——2026-07-20 上線，CHANGELOG #176/#177；以下留作對照）

### 必改（不改會壞）

1. `src/shared/combatStats.js:20` — `WEAPON_CONFIG` 加 `dice`（**最高優先，缺這條 ATK 變 NaN**）
2. `src/shared/combatStats.js:110` — `baseStat` 新增 `luk` 分支
3. `src/services/item/itemService.js:8` — `VALID_WEAPON_TYPES` 加 `dice`（否則後台存檔被清成 null）
4. `src/services/item/itemService.js:11` — `WEAPON_ATK_STAT` 加 `dice: "luk"`
5. `src/services/enhance/enhanceService.js:8` — `WEAPON_MAIN_STAT_BY_TYPE` 加 `dice: "luk"`
6. `src/web/public/admin.items.js:36` — 標籤加 `dice:'骰子'`（否則後台建不出骰子武器）
7. `src/bot/playerPanel.js:188` + `:220` — **兩份**weaponType 中文表都要加

### 資料建立（script）

8. `scripts/upsert-weapon-dice.js` — 建 9 件骰子武器
9. `scripts/upsert-job-gambler.js` — 建賭徒徽章
10. `scripts/write_job_skills.js:5` — 加 `gambler` 的兩個主動技能

### 任務系統

11. `weeklyQuestService.js:6` — 加 `casino_spend` metric
12. `weeklyQuestService.js:751` — 加賭徒試煉 seed
13. `src/services/casino/casinoService.js` — 下注成功時累積任務進度（新回報點）
14. `admin.weekly.js:5` / `:33` — 後台 metric label / unit

### 職業登記

15. `src/shared/jobBadgeBonus.js:21` — 徽章 → 鐵製骰子
16. `src/shared/combatLoop.js:76` — archetype 比對 + `JOB_FLAVOR` 戰報文案
17. `src/bot/handlers/towerHandlers.js:90` — `JOB_TRAITS` 爬塔光環
18. `src/bot/playerPanel.js:466` — 職業特性顯示分支

### 顯示 / 體驗（不改不會壞）

19. `combatLoop.js:25` + `pkCombat.js:340` — 骰子攻擊敘述詞（「擲出命運之骰」「甩手一擲」「骰子在空中翻轉落下」），不加會用預設的「揮拳猛擊」
20. `playerPanel.js:1161` `weaponFamily()` — 歸入 `ranged`，不加會落到 `other` 在背包子頁籤中消失
21. `battle.html:513` — emoji 🎲
22. `admin.shop.js:33`、`admin.monsters.js:376` — 後台標籤
23. `battleConfigService.js:1` + `:44` — 動畫白名單與站位（比照 bow 遠程）
24. `admin.animation-studio.js:2` — 動畫模板選項
25. `admin.combat-calculator.js:11` — 戰力計算機 weaponConfig

### 玩家端 React app（**在另一個 repo `~/Documents/equipmentGAME-app`**）

26. weaponType 中文標籤表加 `dice`
27. 命中音效映射加 `dice`；音檔缺席會 fallback `default.mp3`，可先不做

---

## 九、順帶發現的既有 bug（✅ 均已修，2026-08-07 覆核）

| 位置 | 問題 | 現況 |
|---|---|---|
| `enhanceService.js` vs `itemService.js` | `dagger` 主屬性兩處不一致 | ✅ 已修——兩處皆為 `agi`（`enhanceService.js:13`、`itemService.js:14`） |
| `admin.combat-calculator.js:19` | `dagger.mult` 曾為 2 | ✅ 已修為 3 |

⚠️ 覆核時發現計算機端**新的**漂移（未修，僅記錄）：`admin.combat-calculator.js` 的
`dagger.combo` 仍是 20（`WEAPON_CONFIG` 已降為 10，combatStats.js:34）、
axe 仍帶 `armorBreak: 15`（斧破防已於 2026-08-07 整個移除，combatStats.js:26）。

---

## 十、待確認事項（歷史紀錄——均已有結論）

1. ~~`mult 3` / 不給 `critBonus` 可以嗎？~~ → v3 定案改雙擲 `mult 1.5×2`（見第三節），後補魔法判定 `bypassDefPct 25`
2. ~~賭場試煉 500 萬門檻？~~ → ⛔ 未採用，一轉改 `battle_with_dice`（見第六節）
3. 「自身增益＋自身代價」的真・豪賭仍做不出來（白名單優先於 target，`combatLoop.js:2882`）——另案評估中
4. ~~兩個既有 bug 要不要修？~~ → ✅ 已修（見第九節）
