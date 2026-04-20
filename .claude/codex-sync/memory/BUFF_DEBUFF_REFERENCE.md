---
name: Buff/Debuff 效果參考表
description: 系統支持的所有Buff/Debuff effect key 及參數格式
type: reference
originSessionId: 5a6f9748-887c-4122-8659-6a7a14e57109
---
# ⚡ Buff/Debuff 效果參考表

**重要**: 設計任何涉及Buff/Debuff的NPC、物品、技能時，**必須**使用此表中的key，否則效果無效。

---

## 📋 NPC Effect 支持的類型

```javascript
// NPC事件支持的effect類型
const NPC_EFFECT_TYPES = [
  "grant_currency",      // 發放貨幣
  "grant_item",          // 發放道具
  "grant_equipment",     // 發放裝備
  "take_item",           // 消耗道具（交換）
  "grant_temporary_quest", // 發放限時任務
  "grant_buff"           // 給予 Buff ✓ 最常用
];
```

---

## 🎯 Buff Effect 格式

### 標準格式
```javascript
{
  type: "grant_buff",
  payload: {
    effect: {
      key: "final_damage_up",           // ← 必須使用表中的key
      params: { value: 1.15 },          // value = 1.15 表示 +15%
      duration: { 
        mode: "battle",                 // "battle", "turns", "permanent"
        value: 1                        // 模式為battle時 value=1表示整場戰鬥
      },
      stackMode: "refresh"              // "refresh", "stack", "replace", "ignore"
    }
  }
}
```

### Percent 類效果（百分比類）
這些效果的 `value` 以百分比計算：
- `value: 1.15` = +15% (倍率)
- `value: 0.8` = -20% (倍率)
- `value: 30` = +30% (百分點)

---

## 📊 完整的 Buff Key 表

### 傷害類
| Key | 中文 | 作用 | 參數例 |
|-----|------|------|--------|
| `final_damage_up` | 最終傷害提升 | 增加最終傷害 | `1.15` (+15%) |
| `final_damage_down` | 最終傷害降低 | 減少最終傷害 | `0.8` (-20%) |
| `atk_up` | 攻擊提升 | 增加攻擊力 | 10 (+10) |
| `atk_down` | 攻擊降低 | 減少攻擊力 | -10 (-10) |

### 防禦類
| Key | 中文 | 作用 | 參數例 |
|-----|------|------|--------|
| `def_up` | 防禦提升 | 增加防禦力 | 5 (+5) |
| `def_down` | 防禦降低 | 減少防禦力 | -5 (-5) |
| `mdef_up` | 魔防提升 | 增加魔法防禦 | 5 (+5) |
| `mdef_down` | 魔防降低 | 減少魔法防禦 | -5 (-5) |
| `damage_reduction` | 傷害減免 | 減少所有傷害 | 0.15 (15%) |
| `physical_damage_reduction` | 物理減免 | 減少物理傷害 | 0.2 (20%) |
| `magic_damage_reduction` | 魔法減免 | 減少魔法傷害 | 0.2 (20%) |

### 收益類（掉落、經驗、金幣）
| Key | 中文 | 作用 | 參數例 |
|-----|------|------|--------|
| `exp_gain_up` | 經驗加成 | 增加經驗獲得 | `1.3` (+30%) |
| `gold_gain_up` | 金幣加成 | 增加金幣獲得 | `1.2` (+20%) |
| `drop_rate_up` | 掉落率提升 | 增加掉落率 | `1.08` (+8%) |
| `rare_drop_rate_up` | 稀有掉落率提升 | 增加稀有掉落 | `1.1` (+10%) |
| `monster_reward_up` | 怪物獎勵提升 | 增加怪物獎勵 | `1.15` (+15%) |

### 命中類
| Key | 中文 | 作用 | 參數例 |
|-----|------|------|--------|
| `hit_up` | 命中提升 | 增加命中率 | 8 (+8) |
| `hit_down` | 命中降低 | 減少命中率 | -8 (-8) |
| `dodge_up` | 閃避提升 | 增加閃避率 | 8 (+8) |
| `dodge_down` | 閃避降低 | 減少閃避率 | -8 (-8) |

### 暴擊類
| Key | 中文 | 作用 | 參數例 |
|-----|------|------|--------|
| `crit_rate_up` | 暴擊率提升 | 增加暴擊率 | 5 (+5%) |
| `crit_rate_down` | 暴擊率降低 | 減少暴擊率 | -5 (-5%) |
| `crit_damage_up` | 暴擊傷害提升 | 增加暴擊傷害 | `1.2` (+20%) |
| `crit_damage_down` | 暴擊傷害降低 | 減少暴擊傷害 | `0.8` (-20%) |

### 速度類
| Key | 中文 | 作用 | 參數例 |
|-----|------|------|--------|
| `speed_up` | 速度提升 | 增加行動速度 | 10 (+10) |
| `speed_down` | 速度降低 | 減少行動速度 | -10 (-10) |
| `slow` | 緩速 | 減少對手速度 | - |

### 連擊類
| Key | 中文 | 作用 | 參數例 |
|-----|------|------|--------|
| `combo_up` | 連擊率提升 | 增加連擊率 | 5 (+5%) |
| `proc_extra_hit` | 機率追加攻擊 | 追加攻擊機率 | - |
| `proc_chain_hit` | 機率連鎖攻擊 | 連鎖攻擊機率 | - |

### 控制類 (CC)
| Key | 中文 | 作用 |
|-----|------|------|
| `stun` | 暈眩 | 令目標暈眩 |
| `freeze` | 冰凍 | 令目標冰凍 |
| `sleep` | 睡眠 | 令目標睡眠 |
| `silence` | 沉默 | 令目標無法施法 |
| `root` | 定身 | 令目標無法移動 |
| `confuse` | 混亂 | 令目標混亂 |
| `disarm` | 繳械 | 解除目標武器 |
| `taunt` | 嘲諷 | 強制目標攻擊 |
| `fear` | 恐懼 | 令目標恐懼逃離 |

### 狀態異常
| Key | 中文 | 作用 |
|-----|------|------|
| `poison` | 中毒 | 造成持續傷害 |
| `burn` | 燃燒 | 造成持續傷害 |
| `bleed` | 流血 | 造成持續傷害 |
| `shock_dot` | 感電 | 造成持續傷害 |
| `curse_dot` | 詛咒 | 造成持續傷害 |

### 防禦技能
| Key | 中文 | 作用 |
|-----|------|------|
| `shield` | 護盾 | 吸收傷害 |
| `barrier` | 屏障 | 減少傷害 |
| `invincible_short` | 短暫無敵 | 完全免疫傷害 |
| `death_prevent_once` | 免死一次 | 保留 1 HP |
| `last_stand` | 背水一戰 | 血量越低傷害越高 |

### 回復類
| Key | 中文 | 作用 |
|-----|------|------|
| `heal_over_time` | 持續回血 | 每回合回復 HP |
| `life_regen` | 生命回復 | 自動回復生命 |
| `mana_regen` | 魔力回復 | 自動回復魔力 |
| `on_hit_heal` | 命中回血 | 命中時回血 |
| `on_crit_heal` | 暴擊回血 | 暴擊時回血 |

### 反擊類
| Key | 中文 | 作用 |
|-----|------|------|
| `counter_attack` | 反擊 | 被攻擊時反擊 |
| `counter_on_dodge` | 迴避後反擊 | 閃避後必定反擊 |
| `thorns` | 反傷 | 被攻擊時回傷 |
| `reflect_magic` | 魔法反射 | 反射法術傷害 |

### 吸取類
| Key | 中文 | 作用 |
|-----|------|------|
| `lifesteal` | 吸血 | 傷害的一部分轉為 HP |
| `manasteal` | 吸魔 | 傷害的一部分轉為 MP |

### 特殊加成
| Key | 中文 | 作用 |
|-----|------|------|
| `bonus_vs_boss` | 對Boss增傷 | 對Boss型敵人增傷 |
| `bonus_vs_poisoned` | 對中毒目標增傷 | 對中毒敵人增傷 |
| `bonus_vs_burning` | 對燃燒目標增傷 | 對燃燒敵人增傷 |
| `bonus_vs_stunned` | 對暈眩目標增傷 | 對暈眩敵人增傷 |
| `bonus_vs_debuffed` | 對減益目標增傷 | 對有debuff敵人增傷 |
| `bonus_when_hp_high` | 高血量增傷 | 血量高時增傷 |
| `bonus_when_hp_low` | 低血量增傷 | 血量低時增傷 |
| `bonus_first_hit` | 首擊增傷 | 第一下攻擊增傷 |

### 機率類
| Key | 中文 | 機率效果 |
|-----|------|--------|
| `proc_stun` | 機率暈眩 | 攻擊時暈眩敵人 |
| `proc_poison` | 機率中毒 | 攻擊時中毒敵人 |
| `proc_burn` | 機率燃燒 | 攻擊時燃燒敵人 |
| `proc_bleed` | 機率流血 | 攻擊時流血敵人 |
| `proc_slow` | 機率緩速 | 攻擊時緩速敵人 |
| `proc_def_down` | 機率降防 | 攻擊時降敵人防禦 |
| `proc_atk_down` | 機率降攻 | 攻擊時降敵人攻擊 |
| `proc_execute` | 機率斬殺 | 機率秒殺敵人 |
| `proc_heal` | 機率回血 | 攻擊時回自己血 |
| `proc_shield` | 機率護盾 | 攻擊時獲得護盾 |
| `proc_cleanse` | 機率淨化 | 攻擊時淨化自己 |
| `proc_dispel` | 機率驅散 | 攻擊時驅散敵人 |
| `proc_gain_buff` | 機率獲得增益 | 攻擊時獲得Buff |
| `stun_chance_up` | 擊暈機率提升 | 增加擊暈機率 |
| `execute_chance_up` | 斬殺機率提升 | 增加斬殺機率 |

### 免疫類
| Key | 中文 | 作用 |
|-----|------|------|
| `debuff_immunity` | Debuff免疫 | 免疫所有Debuff |
| `control_immunity` | 控制免疫 | 免疫所有CC |

### 其他
| Key | 中文 | 作用 |
|-----|------|------|
| `cleanse` | 淨化 | 移除自己的Debuff |
| `damage_to_heal` | 受傷轉治療 | 受到傷害時回血 |
| `execute_under_hp_pct` | 斬殺 | 低於血量%時秒殺 |
| `enhance_success_up` | 強化成功率提升 | 增加強化成功率 |
| `event_trigger_rate_up` | 事件觸發率提升 | 增加事件觸發 |
| `checkin_bonus_up` | 打卡獎勵提升 | 增加簽到獎勵 |
| `block_chance_up` | 格擋機率提升 | 增加格擋率 |
| `execute_threshold_up` | 斬殺閾值提升 | 提高斬殺血量 |

---

## ✅ 正確用法範例

### 經驗加成 (+30%)
```javascript
{
  type: "grant_buff",
  payload: {
    effect: {
      key: "exp_gain_up",
      params: { value: 1.3 },  // 1.3 = +30%
      duration: { mode: "battle", value: 1 },
      stackMode: "refresh"
    }
  }
}
```

### 傷害減免 (-20%)
```javascript
{
  type: "grant_buff",
  payload: {
    effect: {
      key: "final_damage_down",
      params: { value: 0.8 },  // 0.8 = -20%
      duration: { mode: "battle", value: 1 },
      stackMode: "refresh"
    }
  }
}
```

### 掉落率提升 (+8%)
```javascript
{
  type: "grant_buff",
  payload: {
    effect: {
      key: "drop_rate_up",
      params: { value: 1.08 },  // 1.08 = +8%
      duration: { mode: "battle", value: 1 },
      stackMode: "refresh"
    }
  }
}
```

---

## ⚠️ 常見錯誤

❌ **這些key都不存在**：
- `next_battle_exp` → 應使用 `exp_gain_up`
- `next_battle_damage` → 應使用 `final_damage_up` 或 `final_damage_down`
- `next_battle_drop_rate` → 應使用 `drop_rate_up`
- `battle_damage_multiplier` → 應使用 `final_damage_up`

---

**系統來源**: `src/web/public/admin.effects.js` 第 84-180 行  
**最後更新**: 2026-04-16  
**重要**: 設計任何Buff/Debuff前請查閱此表
