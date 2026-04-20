---
name: AGI 攻速機制
description: 六大屬性上限、AGI 與戰鬥回合演出速度的對應關係
type: project
---

# AGI 攻速機制

## 核心設定
- **六大屬性上限**：STR / AGI / VIT / INT / DEX / LUK 各 **60**
- **回合演出速度（攻速）**：由 AGI 決定，AGI 40 達最快上限
- **代碼位置**：`src/bot/handlers/monsterZoneHandlers.js`（`calculateTickDelay` 函式）

## 數值對照表

| AGI | 延遲 (ms) | 延遲 (s) | 速度倍率 | 15回合耗時 |
|-----|----------|---------|---------|----------|
| 1   | 1500     | 1.50s   | 1.00×   | 22.5 秒  |
| 10  | 1269     | 1.27s   | 1.18×   | 19.0 秒  |
| 20  | 1013     | 1.01s   | 1.48×   | 15.2 秒  |
| 30  | 756      | 0.76s   | 1.98×   | 11.3 秒  |
| 40  | 500      | 0.50s   | 3.00×   | 7.5 秒   |
| 60  | 500      | 0.50s   | 3.00×   | 7.5 秒   |

## 計算公式

```javascript
const calculateTickDelay = (agi = 1) => {
  const baseDelay = 1500;  // AGI 1 時，每回合 1.5 秒
  const minDelay  = 500;   // AGI 40+ 時，最快每回合 0.5 秒
  const capAgi    = 40;    // AGI 40 達到最快上限（即使 AGI 60 也是 0.5 秒）
  const capped = Math.min(Math.max(1, agi), capAgi);
  return Math.round(baseDelay - ((capped - 1) / (capAgi - 1)) * (baseDelay - minDelay));
};
```

## AGI 的其他影響
- **連擊機率**：`Math.min(80, 3 + AGI * 0.5 + comboBonus)`（combatStats.js:166）
- **迴避率**：`Math.min(50, AGI * 0.5) + dodgeBonus`（combatStats.js:163）

## Why
玩家投資 AGI 不只影響戰鬥機率，也影響戰鬥「演出節奏感」，AGI 高的玩家視覺上感覺更快。

## How to apply
每次設計涉及 AGI 數值的功能（裝備、技能、Buff）時，都要考慮對攻速的影響範圍。AGI 60 封頂，但攻速在 AGI 40 就已達最快。
