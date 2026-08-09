# 龍族之領怪物卡重設計 V5

## 實裝現況（2026-08-07 對照 DB）

| 項目 | 狀態 | 位置 |
|---|---|---|
| 10 張卡改為 passiveEffects（本文全部設計） | ✅ 已實裝 | `scripts/apply-dragon-realm-cards-v5.js`；DB 實查 10 張卡 `procEffects` 已清空、passive key 與本文一致 |
| 戰鬥引擎支援各 passive key | ✅ | `src/shared/effectDefinitions.js:153-166`、`src/shared/combatLoop.js:3148-3216`（bonus_vs_burning／bonus_first_hit／execute_under_hp_pct／stack_on_hit_offense 等） |
| 實作順序步驟 5：更新 CARD_EFFECTS_EDIT.md | ✅ 已標 ⛔ 指向本檔（2026-08-07） |
| 實作順序步驟 5：更新 `docs/tsv/monster_card_effects_zh.tsv` | ❌ 未更新 |

註：DB 內王卡名為「**龍王(B)卡**」（本文寫「古龍王(B)卡」）。

## 設計目標

龍族之領是 Lv40-50 的終盤區域，卡片應該從「機率觸發的數值增幅」升級成「能改變配裝與打法的流派核心」。前面區域多半已經涵蓋攻擊命中、燃燒、中毒、吸血、降防、沉默等 proc 卡；龍區若只是提高倍率，玩家會感覺像舊卡的 A 階版本。

V5 建議改為「常駐被動 + 少量條件觸發」的設計。每張卡都要有明確用途：先手、反震、燃燒流、抗控、連擊、打王、續航、殘血斬殺、護盾、成長型王卡。

## 共通規格

- 階級：A
- 裝備槽：special
- 主要形式：passiveEffects
- monsterCardSkill：保留給 UI 顯示，trigger 建議標示為 passive
- procEffects：原則上清空；只有「附加燃燒」這類必要補足可做低強度 on_hit
- 強度原則：單張卡要有存在感，但避免通用卡壓過專門卡

## 1. 飛龍幼崽卡

- 定位：先手連擊卡
- 技能名：俯衝先制
- 玩家描述：[A階 / 飛龍系] 常駐：連擊率 +12，戰鬥第一擊傷害 +20%。
- 實作效果：
  - `combo_up` self value 12 passive
  - `bonus_first_hit` self value 20 passive
- 設計理由：飛龍幼崽不再只是攻擊力提升，而是讓玩家感覺「速度快、起手兇」。適合刷怪與短戰鬥，但長戰鬥價值會自然下降。

## 2. 龍蜥武士卡

- 定位：反震坦卡
- 技能名：龍鱗反震
- 玩家描述：[A階 / 反震系] 常駐：受到攻擊時反彈 22% 傷害，並有 25% 機率立刻反擊一次。
- 實作效果：
  - `reflect_damage` self value 22 passive
  - `counter_attack` self value 25 passive
- 設計理由：從單純防禦提升改成坦克輸出循環。這張卡應該讓高 VIT、重裝玩家有明顯玩法，而不是只多撐幾回合。

## 3. 火翼龍人卡

- 定位：燃燒流核心
- 技能名：龍焰共生
- 玩家描述：[A階 / 火焰系] 常駐：對燃燒中的目標傷害 +30%；攻擊命中回復造成傷害的 5%。
- 實作效果：
  - `bonus_vs_burning` self value 30 passive
  - `on_hit_heal` self value 5 passive
- 設計理由：這張不負責點燃，而是專門放大燃燒流的收益。單卡較普通，但搭配火焰職業、燃燒卡、隊友或怪物狀態時會明顯變強。

## 4. 冰鱗龍人卡

- 定位：穩定抗干擾卡
- 技能名：霜甲護身
- 玩家描述：[A階 / 守護系] 常駐：免疫負面狀態；HP 高於 70% 時造成傷害 +18%。
- 實作效果：
  - `debuff_immunity` self value 1 passive
  - `bonus_when_hp_high` self value 18 passive, thresholdPct 70
- 設計理由：冰系不再只是降 AGI，而是「保持節奏不被拖慢」。適合高續航、高防禦、或能維持血線的玩家。

## 5. 雷霆飛龍卡

- 定位：連擊暴擊卡
- 技能名：雷霆連擊
- 玩家描述：[A階 / 連擊系] 常駐：連擊傷害 +22%，爆擊率 +10。
- 實作效果：
  - `combo_damage_up` self value 22 passive
  - `crit_rate_up` self value 10 passive
- 設計理由：和飛龍幼崽分工。飛龍幼崽強在起手與連擊率，雷霆飛龍強在連擊後的爆發品質。

## 6. 黑曜龍騎卡

- 定位：Boss 破甲卡
- 技能名：黑曜碎甲
- 玩家描述：[A階 / 破甲系] 常駐：對 BOSS 傷害 +25%；對破防或防禦下降中的目標額外傷害 +18%。
- 實作效果：
  - `bonus_vs_boss` self value 25 combat
  - `bonus_vs_def_broken` self value 18 combat
- 設計理由：舊版對暈眩目標增傷太依賴 stun 來源，這版改成「Boss + 破甲」主題，和黑曜騎士形象更合。

## 7. 黃金幼龍(稀)卡

- 定位：長線續航卡
- 技能名：黃金祝福
- 玩家描述：[A階 / 救護系] 常駐：每 3 回合回復 10% MaxHP；擊殺敵人時回復 18% MaxHP；戰鬥結束後回復 30% MaxHP。
- 實作效果：
  - `life_regen` self value 10 passive, interval 3
  - `on_kill_heal` self value 18 passive
  - `post_battle_heal` self value 30 passive
- 設計理由：稀有卡應該有「拿到後生活品質改變」的感覺。它不一定最高傷害，但非常適合自動刷怪、續航與穩定推進。

## 8. 暗影龍將卡

- 定位：殘血斬殺卡
- 技能名：影襲斬殺
- 玩家描述：[A階 / 狂血系] 常駐：HP 低於 30% 時造成傷害 +25%、受到傷害 -20%；攻擊 HP 低於 20% 的敵人時，有 25% 機率直接斬殺。
- 實作效果：
  - `bonus_when_hp_low` self value 25 passive, thresholdPct 30
  - `bonus_reduction_when_hp_low` self value 20 passive, thresholdPct 30
  - `execute_under_hp_pct` self value 25 passive, thresholdPct 20
- 設計理由：這張要讓玩家願意玩危險血線。它應該是高風險高爽度，不是普通吸血卡。

## 9. 龍翼魔法師卡

- 定位：護盾法卡
- 技能名：龍語魔盾
- 玩家描述：[A階 / 守護系] 常駐：開戰獲得 20% MaxHP 護盾；擁有護盾時造成傷害 +20%；免疫控制效果。
- 實作效果：
  - `shield` self value 20 battle_start
  - `bonus_while_shielded` self value 20 passive
  - `control_immunity` self value 1 passive
- 設計理由：從沉默敵人改成保護自身施法節奏。這張很適合法師、弓手、低防但需要穩定輸出的流派。

## 10. 古龍王(B)卡

- 定位：成長型王卡
- 技能名：龍王戰意
- 玩家描述：[A階 / 龍王系] 常駐：每次出手獲得 STR/DEX +3，最高 +15；每次受擊獲得 VIT/AGI +3，最高 +15；物理傷害 -15%、魔法傷害 -15%。
- 實作效果：
  - `stack_on_hit_offense` self value 3 passive, cap 15
  - `stack_on_taken_defense` self value 3 passive, cap 15
  - `physical_damage_reduction` self value 15 passive
  - `magic_damage_reduction` self value 15 passive
- 設計理由：Boss 卡應該越打越像王。這張不靠單次大爆發，而是長戰鬥逐步成形，適合打王、塔、持久戰。

## 平衡注意

- 火翼龍人卡不自帶燃燒，需確認玩家在同階段有合理燃燒來源，否則它會偏向搭配卡而非泛用卡。
- 黃金幼龍卡會顯著改善續航，應用實戰跑分確認它不會讓玩家跨太多區域無損刷怪。
- 暗影龍將卡的斬殺機率建議先保守，因為斬殺類效果體感非常強。
- 古龍王(B)卡應該在長戰鬥強，但短戰鬥不一定贏飛龍幼崽或雷霆飛龍，這樣各卡才有用途分層。
- 黑曜龍騎卡的 BOSS 特攻與破甲特攻都寫在 `combatEffects`，方便後台戰鬥特效區檢視。

## 實作順序（✅ 已執行，見文首「實裝現況」；步驟 5 的 tsv 尚未更新）

1. 先確認目前 combatLoop 已支援的 passive key。
2. 將已支援的 9 張先改成 passiveEffects。
3. 補或替代黑曜龍騎卡的 `bonus_vs_def_broken`。
4. 用 Lv40 玩家對古龍王(B)與一般龍區怪各跑 50-100 場，檢查 DPR、受傷量、陣亡率。
5. 更新 `docs/CARD_EFFECTS_EDIT.md` 與 `docs/tsv/monster_card_effects_zh.tsv`。
