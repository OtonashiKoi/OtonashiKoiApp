# 敗北傷勢系統實裝

## 概述

實裝「自爆流派懲罰機制」——當玩家在怪物戰鬥中死亡時，若同一隻怪物還未被擊倒，玩家會帶著傷勢進場下一次戰鬥。

### 機制規則

1. **觸發條件**
   - 玩家等級 >= 5（低等玩家免疫）
   - 戰鬥失敗（死亡）
   - 怪物仍活著（HP > 0）

2. **效果**
   - 玩家身上施加 `final_damage_down` debuff
   - 傷害降低 70%（最終傷害 × 0.3）
   - 持續時間：永久，直到面對下一隻怪物時自動清除

3. **提示方式**
   - DC 戰鬥訊息中顯示：`⚠️ 你帶著 **傷勢**（傷害 -70%）進場，直到面對下一隻怪物。`

---

## 實裝細節

### 1. 新增輔助函式：`clearDefeatDebuff(discordId)`

**位置**：[monsterZoneHandlers.js:118-138](src/bot/handlers/monsterZoneHandlers.js#L118-L138)

清除玩家身上由敗北造成的傷勢 debuff。檢查 sourceId 是否以 `defeat_by_` 開頭：

```javascript
// 只清除來自敗北的傷勢 debuff，保留其他效果
prog.activeEffects = prog.activeEffects.filter((eff) => {
  if (!eff || eff.key !== 'final_damage_down') return true;
  const sourceId = eff.sourceId || '';
  return !sourceId.startsWith('defeat_by_');
});
```

### 2. 戰鬥失敗時施加 Debuff

**位置**：[monsterZoneHandlers.js:897-923](src/bot/handlers/monsterZoneHandlers.js#L897-L923)

在 `outcome === "lose"` 分支中：

```javascript
if (playerLevel >= 5 && monsterStillAlive && currentProg) {
  const defeatDebuff = normalizeActiveEffect({
    key: 'final_damage_down',
    params: { value: 70 },  // 70% 傷害降低
    duration: { mode: 'permanent' },
    sourceType: 'monster_zone',
    sourceId: `defeat_by_${monster.seq}`
  });
  if (defeatDebuff) {
    currentProg.activeEffects.push(defeatDebuff);
    await sc.progressRepository.save(currentProg);
    debuffApplied = true;
  }
}
```

### 3. DC 訊息提示

**位置**：[monsterZoneHandlers.js:925-932](src/bot/handlers/monsterZoneHandlers.js#L925-L932)

```javascript
rewardLines = [
  `你被 **${session.monsterName}** 擊倒了！`,
  session.entryFee > 0 ? `入場費 **${session.entryFee}** 🪙 已損失，下次加油！` : "下次加油！",
  debuffApplied ? `⚠️ 你帶著 **傷勢**（傷害 -70%）進場，直到面對下一隻怪物。` : ""
].filter(Boolean);
```

### 4. 怪物死亡後清除 Debuff

**位置**：[monsterZoneHandlers.js:869-873](src/bot/handlers/monsterZoneHandlers.js#L869-L873)

在 `outcome === "win"` 分支後執行（怪物被擊倒）：

```javascript
// 怪物死亡，清除所有參戰者的敗北傷勢 Debuff
const participants = rewardLines._participants || [];
if (Array.isArray(participants)) {
  await Promise.all(participants.map((pid) => clearDefeatDebuff(pid)));
}
```

### 5. 怪物替換時清除 Debuff

**位置**：[monsterZoneHandlers.js:561-566](src/bot/handlers/monsterZoneHandlers.js#L561-L566)

NPC 事件結束、怪物替換時清除所有參戰者的傷勢 debuff：

```javascript
// 怪物替換時，清除所有參戰者的敗北傷勢 Debuff
if (Array.isArray(state.participants)) {
  await Promise.all(state.participants.map((discordId) => clearDefeatDebuff(discordId)));
}
```

---

## 技術細節

### Debuff 持久化機制

- **Duration Mode**：`permanent`（永久持續）
- **不受 decrementActiveEffects 影響**：戰鬥後調用 `decrementActiveEffects(effects, "battle", 1)` 只會移除 `remaining.mode === "battle"` 的效果，永久 debuff 會被保留
- **Source ID 格式**：`defeat_by_{monster.seq}` 用於清除時識別

### Debuff 清除時機

1. **怪物被擊倒**：調用 `handleMonsterKill` 後，清除所有參戰者的傷勢
2. **怪物替換**：任何原因導致 `activeMonsterSeq` 改變時清除（NPC 事件、怪物輪換等）

### 多人協作場景

- 若多人同時對同一隻怪物戰鬥，每人各自管理自己的 debuff
- 怪物被任何一人擊倒時，所有參戰者的傷勢都被清除

---

## 測試建議

### 1. 單人敗北測試
- 玩家 Lv5+ 與怪物戰鬥
- 故意讓玩家死亡
- 驗證：
  - ✅ 收到傷勢 debuff 提示訊息
  - ✅ `activeEffects` 中有 `final_damage_down` 效果
  - ✅ 下一場戰鬥中傷害降低 70%

### 2. 怪物擊倒後清除
- 玩家帶著傷勢狀態
- 任何人擊倒該怪物
- 驗證：✅ 傷勢 debuff 被清除

### 3. 怪物替換後清除
- 玩家帶著傷勢狀態
- 等待 NPC 事件或怪物自然替換
- 驗證：✅ 傷勢 debuff 被清除

### 4. 低等級免疫
- 玩家 Lv1-4 死亡
- 驗證：✅ 不施加 debuff

### 5. 多人協作
- 多名玩家同時對怪物戰鬥
- 一人死亡獲得傷勢、其他人擊倒怪物
- 驗證：✅ 死亡者的傷勢被清除

---

## 改動文件

- `src/bot/handlers/monsterZoneHandlers.js`
  - 新增 `clearDefeatDebuff()` 函式
  - 新增 import `normalizeActiveEffect`
  - 在戰鬥結束邏輯中增加 debuff 施加與清除邏輯
