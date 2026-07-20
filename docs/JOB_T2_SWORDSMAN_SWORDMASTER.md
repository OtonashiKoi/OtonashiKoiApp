# 劍聖（劍士二轉・A 分支）設計草案

> 狀態：**草案，等使用者確認後才實作**
> 上位職：劍士 `job_swordsman_v1`
> 姊妹分支：B 分支「雙手大劍・蓄力流」（另案）
> 二轉通則：Lv.35 解鎖、一轉徽章不銷毀可自由換裝、每人最多持有 3 個二轉徽章、
> 第 1/2/3 個二轉試煉要求為標準 ×1 / ×2.5 / ×5

---

## 一、定位：越硬的仗越強

劍聖不是發明新身分，而是把劍士**既有的傾向放大**。實測數據（Lv50、S 階、8 回合）：

| 情境 | 單手劍＋盾 | 大劍 | 雙持 | 盾的格擋次數 |
|---|---|---|---|---|
| 慢怪（AGI 壓制、常跳過攻擊） | 1.00x | 1.21x | **1.47x** | 1.7 次 |
| 高攻速王（每回合都打） | 1.00x | 1.07x | **1.14x** | **3.4 次** |

從雜魚到硬仗，雙持的優勢從 1.47x 縮到 1.14x——因為盾的格擋次數翻倍，而**每次格擋都會送一發完整反擊**。

劍聖把這條曲線再拉陡：**雜魚場最弱、王場最強**。這剛好跟賭徒（打雜魚強、打高防王弱）相反，也跟雙持（開場就強、一路平穩）形成對比。

### 為什麼格擋在這個遊戲很重

| 機制 | 效果 |
|---|---|
| 格擋成功（一般怪） | 傷害直接**降到 1** |
| 格擋成功（BOSS） | 卸去 **70%** 傷害 |
| `blockCounter` 格擋反擊 | **一次完整攻擊**（同樣的 ATK 與全部倍率，不是打折追擊） |

---

## 二、徽章道具

```js
{
  id: "job_swordmaster_t2_v1",
  name: "劍聖徽章",
  description: "擋下的每一擊，都是還擊的起點。越是苦戰，劍越快。",
  itemType: "job_badge",
  equipSlot: "job_eq",
  equipStats: { str: 5, vit: 5, dex: 2 },   // 總和 12
  tier: null, weaponType: null, enhanceLevel: 0
}
```

**屬性總和 12**（一轉徽章是 7～8）。這是二轉的通用基準，之後 19 個二轉都照這個量級，之後要調就整批調。

---

## 三、被動 `passiveEffects`

| # | key | 值 | 條件 | 說明 | 狀態 |
|---|---|---|---|---|---|
| 1 | `block_chance_up` | +15 | 持盾 | 單手劍＋盾可達約 **75%** | ✅ 現成 |
| 2 | `block_counter_damage_up` | +60 | 持盾 | 格擋反擊傷害 **×1.6** | 🆕 要新增 |
| 3 | `stack_on_block_offense` | +4（上限 40） | 持盾 | 每次格擋攻擊 +4%，上限 +40% | 🆕 要新增 |
| 4 | `damage_reduction` | +5 | 無條件 | 沒帶盾時也有的基礎韌性 | ✅ 現成 |

```js
passiveEffects: [
  { key: "block_chance_up", target: "self", trigger: "passive", chance: 100,
    params: { value: 15 }, condition: { equippedSlot: "shield" },
    notes: "持盾：格擋率 +15%" },
  { key: "block_counter_damage_up", target: "self", trigger: "passive", chance: 100,
    params: { value: 60 }, condition: { equippedSlot: "shield" },
    notes: "持盾：格擋反擊傷害 +60%" },
  { key: "stack_on_block_offense", target: "self", trigger: "passive", chance: 100,
    params: { value: 4, maxValue: 40 }, condition: { equippedSlot: "shield" },
    notes: "每次格擋：攻擊 +4%（上限 +40%）" },
  { key: "damage_reduction", target: "self", trigger: "passive", chance: 100,
    params: { value: 5 }, notes: "受到傷害 -5%" }
]
```

三個核心被動掛在**同一個循環**上：擋得多 → 反擊多 → 層數疊得高 → 反擊更痛。

⚠️ 前三個都綁 `condition: { equippedSlot: "shield" }`——**不帶盾的劍聖幾乎沒有被動**，這是刻意的：劍聖就是盾牌流，想玩雙持請走別的分支。

---

## 四、主動技能 `jobSkills`

沿用為賭徒建好的自訂 `trigger` 機制（帶 `trigger` 的技能不吃「每回合 35% 隨機發動一個」的閘門）。

### 技能一：不動如山 — `trigger: "on_block"`，CD 2

**格擋成功時必定發動**（不擲機率）：立即追加一次額外的格擋反擊。

```js
{
  key: "swordmaster_immovable",
  name: "不動如山",
  description: "格擋成功時，立即追加一次額外反擊。",
  trigger: "on_block",
  cooldownTurns: 2,
  condition: {},
  procEffects: [
    { key: "extra_block_counter", target: "enemy", params: { value: 1 } }
  ]
}
```

🆕 需要新增 `extra_block_counter` 效果 key 與 `on_block` 觸發點。

### 技能二：見切 — 一般 35% 隨機池，CD 4

```js
{
  key: "swordmaster_perception",
  name: "見切",
  description: "格擋率+20%、DEF+15，持續3回合。",
  cooldownTurns: 4,
  condition: {},
  procEffects: [
    { key: "block_chance_up", target: "self", params: { value: 20, duration: { mode: "turns", value: 3 } } },
    { key: "def_up", target: "self", params: { value: 15, mode: "flat", duration: { mode: "turns", value: 3 } } }
  ]
}
```

技能二刻意留在一般隨機池，讓劍聖不會兩個技能都是條件觸發、節奏太死。

> ⚠️ **做不出來的東西**：`combatLoop.js` 的 `JOB_SKILL_OFFENSIVE` 白名單用 key 推斷目標，`def_down` 一定被判成掛敵方，所以**做不出「自身增益＋自身代價」的技能**（例如「破釜沉舟：ATK+50% 但格擋歸零」）。這條要等白名單改成讀 procEffect 自帶的 `target` 欄位才能做。

---

## 五、爬塔光環

| | 一轉劍士 | 劍聖 |
|---|---|---|
| 光環 | 隊伍受到傷害 −5% | 隊伍受到傷害 **−8%** |

沿用既有的 `party_damage_reduction`，只調數值，不需要新 key。維持防禦系定位，也跟結界師的 −10% 有區隔（結界師是純輔助、劍聖有輸出）。

---

## 六、二轉試煉任務

| 欄位 | 值 |
|---|---|
| cadence | `job`（resetPolicy `once`） |
| type | `block_count`（**既有 metric**，新手任務已在用） |
| target | **300 次成功格擋**（第 2 個二轉 ×2.5 = 750、第 3 個 ×5 = 1500） |
| unlockLevel | 35 |
| 前置 | 持有劍士徽章 `job_swordsman_v1` |
| rewardItemId | `job_swordmaster_t2_v1` |

用 `block_count` 而不是「用劍出戰 N 次」，因為它**直接對應劍聖的玩法**——想轉劍聖就得先去帶盾挨打，任務本身就是在教你這個職業怎麼玩。

---

## 七、預期落點與待驗證

粗估（做完會實測驗證）：

| 情境 | 一轉劍士（盾） | 劍聖 | 對照：雙持 |
|---|---|---|---|
| 慢怪 | 1.00x | **1.05～1.15x** | 1.47x |
| 高攻速王 | 1.00x | **1.25～1.35x** | 1.14x |

三條路線各有明確主場：**雙持刷雜魚最快、大劍中庸爆發、劍聖打王／爬塔／世界王**。

---

## 八、要動的東西

### 新增效果 key（3 個）

| key | 用途 | 落點 |
|---|---|---|
| `block_counter_damage_up` | 格擋反擊傷害倍率 | `combatLoop.js:3848` 的反擊區塊 |
| `stack_on_block_offense` | 格擋疊加攻擊層數 | 比照既有 `stack_on_hit_offense` 的寫法 |
| `extra_block_counter` | 追加一次格擋反擊 | 反擊區塊改成可迴圈 |

四處都要登記：`effectDefinitions.js`、`effectDisplayNames.js`、`admin.effects.js`、combatLoop 實作。

### 新增觸發點

- `on_block`：格擋成功時的技能觸發點（比照為賭徒做的 `on_dice_one`）

### 二轉系統基礎建設（尚未存在，這是第一個二轉，得先蓋）

- `src/shared/jobAdvancement.js` 單一來源（二轉專用，不動既有 10 個一轉的散落硬編碼）
- 二轉徽章的解鎖／裝備流程、上限 3 個的計數、試煉要求遞增 ×2.5/×5
- 「同時只能進行 1 條二轉試煉」的鎖
- Discord／網頁的「二轉」顯示區塊
- 後台補 `jobSkills` 編輯（目前完全不能編，20 個二轉全靠跑 script 會瘋掉）

---

## 九、待你拍板

1. **刷雜魚只有 1.05x，要補償嗎？** 我傾向不補償（三條路線本來就該有取捨，且劍聖有全隊 −8% 的團隊價值）。若要補，建議加「格擋時回血」——只加續航、不加輸出。
2. **格擋 75% 會不會太高？** 一般怪傷害降到 1，等於對雜魚幾乎免疫。數值上安全但「防禦」這條線會失去張力。要壓到 70% 嗎？
3. **屬性總和 12** 當二轉通用基準可以嗎？（一轉是 7～8）
4. **要不要二轉專屬武器？** 目前設計是繼續用單手劍＋盾。也可以給一把二轉專屬的劍（像賭徒的骰子那樣自帶獨立機制），但那是另一條武器線的工作量。
