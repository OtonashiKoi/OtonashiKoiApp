# Phase 0 執行藍圖 — Godot 4 + 像素風垂直切片

> 母文件：[NATIVE_GAME_ROADMAP.md](NATIVE_GAME_ROADMAP.md)
> 引擎：**Godot 4**　美術：**像素風**　目標級距：**1～2 週**
> 撰寫時點：2026-05-30

---

## 1. Phase 0 要證明什麼

一條最小但完整的鏈路，跑得通、會動、好看：

> **登入 → 顯示我的角色 → 選區域出戰 → 看一場「會動的像素戰鬥」（揮劍、史萊姆受擊、血條下降、傷害數字、暴擊特效、勝負）→ 結束畫面**

跑通它，就代表「Godot 順不順手、戰鬥演出好不好看、技術鏈路通不通」全部驗證完畢，再決定是否進 Phase 1 全力投入。

### 驗收標準（Definition of Done）

- [ ] Godot 客戶端能用 mock 登入拿到 JWT
- [ ] 能拉 `/api/me/profile` 顯示等級、職業、HP、金幣
- [ ] 能 POST `/api/combat/quick-battle` 並拿到**結構化 battleScript**
- [ ] 戰鬥場景照 battleScript 播放像素動畫，雙方血條與傷害數字正確
- [ ] 勝負結果與後端一致（按記憶：用**真實戰鬥流程**驗證，不另寫測試腳本下結論）

---

## 2. battleScript 格式（Phase 0 精簡版）

後端 `quick-battle` 回應**新增一個 `battleScript` 欄位**（現有 `roundLogs` 文字戰報保留，向後相容）：

```json
{
  "battleScript": {
    "version": 1,
    "outcome": "win",
    "player":  { "name": "玩家", "job": "swordsman", "weaponType": "sword_1h", "maxHp": 5200 },
    "monster": { "name": "史萊姆", "maxHp": 700, "spriteKey": "slime", "imageUrl": "..." },
    "events": [
      { "seq": 0, "actor": "player",  "type": "attack", "damage": 320, "crit": false, "combo": false, "monsterHpAfter": 380, "playerHpAfter": 5200 },
      { "seq": 1, "actor": "monster", "type": "attack", "damage": 90,  "dodged": false,                "monsterHpAfter": 380, "playerHpAfter": 5110 },
      { "seq": 2, "actor": "player",  "type": "attack", "damage": 600, "crit": true,                   "monsterHpAfter": 0,   "playerHpAfter": 5110 },
      { "seq": 3, "type": "end", "outcome": "win" }
    ]
  }
}
```

- 客戶端照 `events` 順序播放，每個事件配一個固定演出時長（沿用後端既有的 `ROUND_MS` 概念）。
- **Phase 0 只埋「主幹事件」**：`attack`（含 `crit` / `combo` / `dodged` / `blocked` 旗標）與 `end`。受擊融入對方攻擊事件的 `*HpAfter`。
- 複雜事件（技能 `skill`、中毒 `dot`、暈眩 `status`、治療 `heal`、Boss 階段）**留待 Phase 1 逐步加** —— 格式是往 `events` 增加 `type` 即可，不需重設計。

---

## 3. 任務看板

三條線並行，其中**後端 + 美術完全不依賴 Godot，可立刻開工**。

| # | 任務 | 負責 | 依賴 Godot？ | 狀態 |
| --- | --- | --- | --- | --- |
| **後端（地基，與引擎無關）** | | | | |
| T1 | `combatLoop.js` 加主幹事件收集（`options.collectEvents` → 回傳 `events`），**不改任何戰鬥數值**，完全向後相容 | 我 | ❌ 否 | 待開工 |
| T2 | `quick-battle` 端點把 `events` 組成 `battleScript` 放進 response（[playerAppRoutes.js:1829](../src/api/routes/playerAppRoutes.js#L1829) 附近） | 我 | ❌ 否 | 待開工 |
| T3 | Phase 0 登入：沿用現有 `mock:` 後門拿 JWT（正式 Discord 登入留 Phase 1） | 我 | ❌ 否 | 待開工 |
| **像素美術（Aseprite，與引擎無關）** | | | | |
| A1 | 玩家劍士 sprite：`idle`(4幀) + `attack`(6幀) + `hit`(2幀) | 我（Aseprite） | ❌ 否 | 待開工 |
| A2 | 史萊姆怪物 sprite：`idle`(4幀) + `hit`(2幀) | 我（Aseprite） | ❌ 否 | 待開工 |
| A3 | 打擊特效：斬擊(4幀) + 暴擊星花(4幀) | 我（Aseprite） | ❌ 否 | 待開工 |
| A4 | 匯出 spritesheet + Godot 可 import 的動畫資料 | 我 | ❌ 否 | 待開工 |
| **Godot 客戶端（你主導，我給骨架）** | | | | |
| G1 | Godot 4 專案 + 目錄結構 | 你 + 我給範本 | ✅ 是 | 待裝引擎 |
| G2 | `Api` autoload：`HTTPRequest` 封裝 + JWT 保存 | 我給程式 + 你整合 | ✅ 是 | — |
| G3 | Login 場景（mock 登入） | 我給程式 + 你整合 | ✅ 是 | — |
| G4 | Home 場景（顯示角色資料） | 我給程式 + 你整合 | ✅ 是 | — |
| G5 | Battle 場景（播 battleScript → 像素動畫 + 血條 + 傷害數字） | 我給程式 + 你整合 | ✅ 是 | — |

---

## 4. 執行順序

```
第 1 步（現在就能做，不等 Godot）：
   我：T1 → T2 → T3（後端戰鬥腳本 + mock 登入）
   我：A1 → A2 → A3 → A4（像素素材）
   你：下載安裝 Godot 4 + Aseprite

第 2 步（Godot 到位後）：
   我給 G1～G5 的腳本與場景說明 → 你在 Godot 編輯器整合
   （T2 必須先完成，G5 才有 battleScript 可吃）

第 3 步：
   端到端跑一場真實戰鬥，對驗收清單逐項確認
```

---

## 5. Godot 專案結構（建議）

```text
equipmentgame-client/
├── project.godot
├── autoload/
│   └── api.gd               # 單例：HTTPRequest 封裝 + JWT + base_url
├── scenes/
│   ├── login.tscn / .gd     # mock 登入
│   ├── home.tscn / .gd      # 角色面板（/api/me/profile）
│   └── battle.tscn / .gd    # 戰鬥演出（播 battleScript）
├── actors/
│   ├── player.tscn          # AnimatedSprite2D：idle/attack/hit
│   └── monster.tscn         # AnimatedSprite2D：idle/hit
├── ui/
│   ├── hp_bar.tscn
│   └── damage_number.tscn   # 跳字動畫
└── assets/sprites/          # A1～A4 的像素素材
```

- 網路：Godot 內建 `HTTPRequest`（REST）即可，Phase 0 不需要 WebSocket。
- `base_url` 用 export 變數，方便切本機 / 線上。

---

## 6. 美術風格基準（像素風）

- 解析度先定 **角色約 48×48 或 64×64**、怪物視體型，整體統一一套像素網格與調色盤。
- 動畫採逐幀（frame-by-frame），Phase 0 求「會動、讀得懂動作」，不追求精緻。
- 我用 Aseprite 產出後，會附上調色盤與規格，方便日後你或美術接手量產其他角色/怪物時風格一致。

---

## 7. 我現在就能獨立開始的（不依賴 Godot）

1. **T1～T3 後端**：戰鬥腳本輸出 + mock 登入確認 —— 純新增、向後相容、不動玩家資料與戰鬥數值，對你現有網頁版戰鬥動畫也有益。
2. **A1～A4 像素素材**：第一隻劍士 + 史萊姆 + 打擊特效。

> 這兩塊做完，等你 Godot 裝好，G1～G5 就能很快串起來看到「會動的戰鬥」。
