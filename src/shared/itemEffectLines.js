// 道具「特效簡易說明」列產生器（背包詳細視窗、戰鬥掉落氣泡共用）。
// 卡片 → monsterCardSkill 技能名＋描述（同 DC 已裝備卡片區格式）；
// 裝備 → passive/combat/proc 效果的中文名＋數值（優先用 notes 文案）。
const { EFFECT_NAME_ZH } = require("./effectDisplayNames");

// 身上特效數值單位表 — 依 src/shared/combatLoop.js / effectEngine.js 引擎實際語意，
// 只列「語意上明確是百分比」的 key（各種率、倍率、吸血、DOT、減傷）。
// 有歧義的固定屬性（atk_up/def_up/str_up… 被動裝備是固定值）一律不加 %。
const PCT_VALUE_EFFECT_KEYS = new Set([
  // 倍率類（引擎 mode "mul"，value 視為 +X%）
  "atk_multiplier_up", "def_multiplier_up", "max_hp_multiplier_up",
  "final_damage_up", "final_damage_down", "damage_taken_up",
  "crit_damage_up", "crit_damage_down",
  // 率類（0~100 百分點）
  "crit_rate_up", "crit_rate_down", "combo_up", "combo_damage_up",
  "dodge_up", "dodge_down", "hit_up", "hit_down",
  "block_chance_up", "execute_chance_up", "stun_chance_up",
  // 比例類（佔傷害/血量百分比）
  "lifesteal", "life_steal_strong", "counter",
  "damage_reduction", "physical_damage_reduction", "magic_damage_reduction",
  "def_ignore", "heal_over_time", "enemy_heal_reduction",
  "bonus_vs_poisoned", "bonus_vs_debuffed", "bonus_vs_boss",
  "bonus_vs_def_broken", "bonus_vs_burning"
]);
// 這些 key 引擎不使用 value（純開關/觸發），不顯示數字
const NO_VALUE_EFFECT_KEYS = new Set(["invincible_short", "cleanse_self"]);

// 顯示用數值格式化：依引擎語意決定 %；params.mode 明確指定時優先採用
function formatEffectValueText(key, params = {}) {
  if (NO_VALUE_EFFECT_KEYS.has(key)) return "";
  const v = Number(params?.value);
  if (!Number.isFinite(v)) return "";
  if (params?.mode === "flat") return `${v > 0 ? "+" : ""}${v}`;
  const isPct = params?.mode === "pct" || params?.mode === "mul" || PCT_VALUE_EFFECT_KEYS.has(key);
  return `${v > 0 ? "+" : ""}${v}${isPct ? "%" : ""}`;
}

function buildItemEffectLines(lib) {
  const lines = [];
  const skill = lib?.monsterCardSkill;
  if (skill?.name) {
    lines.push(`🎴 ${skill.name}${skill.description ? `（${skill.description}）` : ""}`);
  }
  const TRIGGER_ZH = { passive: "被動", combat: "戰鬥", proc: "觸發" };
  const groups = [
    ["passive", lib?.passiveEffects],
    ["combat", lib?.combatEffects],
    ["proc", lib?.procEffects],
  ];
  for (const [trigger, arr] of groups) {
    for (const eff of arr || []) {
      if (!eff?.key) continue;
      const name = EFFECT_NAME_ZH[eff.key] || eff.definitionName || eff.key;
      const valueText = formatEffectValueText(eff.key, eff?.params);
      const chance = Number(eff.chance ?? 100);
      const chanceText = chance < 100 ? `（${chance}%機率）` : "";
      const body = eff.notes || `${name}${valueText ? ` ${valueText}` : ""}`;
      lines.push(`✦ ${TRIGGER_ZH[trigger] || trigger}：${body}${chanceText}`);
    }
  }
  // 職業徽章主動技能（踢到桌腳/死亡意志等）— DC 個人資料有列，網頁比照補上，
  // 讓玩家不用把徽章裝上去再開 DC 才看得到技能詳情。
  const jobSkills = Array.isArray(lib?.jobSkills) ? lib.jobSkills : [];
  if (jobSkills.length > 0) {
    const normal = jobSkills.filter((sk) => sk?.name && !sk.trigger);
    const custom = jobSkills.filter((sk) => sk?.name && sk.trigger);
    const fmt = (sk) => {
      const cd = Number(sk.cooldownTurns) > 0 ? `（CD ${sk.cooldownTurns} 回合）` : "";
      const wt = sk?.condition?.weaponType;
      const need = wt ? `〔需${Array.isArray(wt) ? wt.join("/") : wt}〕` : "";
      const stunOnly = sk?.condition?.targetStunned ? "〔敵方暈眩中〕" : "";
      const stance = sk?.condition?.stance ? `〔${sk.condition.stance === "defense" ? "防禦" : "攻擊"}姿態〕` : "";
      const desc = sk.description ? String(sk.description).trim() : "";
      return `・${sk.name}${need}${stance}${stunOnly}：${desc}${cd}`;
    };
    if (normal.length > 0) {
      lines.push(`⚔️ 主動技能（每回合約 35% 從可用技能中發動 1 個）：`);
      for (const sk of normal) lines.push(fmt(sk));
    }
    // 帶自訂 trigger 的技能不吃 35% 閘門，條件成立就必定發動 → 分開說明，避免玩家誤會
    if (custom.length > 0) {
      lines.push(`💥 特殊技能（條件成立必定發動，不佔上面的隨機名額）：`);
      for (const sk of custom) lines.push(fmt(sk));
    }
  }
  // 二轉專屬機制（姿態／連段／集氣／暈眩專精）——這些不在 passiveEffects 也不在 jobSkills，
  // 而是寫在 jobAdvancement 的分支設定裡，不特別撈出來玩家就完全看不到。
  for (const line of buildT2MechanicLines(lib)) lines.push(line);
  return lines;
}

/**
 * 二轉徽章的專屬機制說明。
 * 資料來源是 jobAdvancement 的分支設定（不是道具欄位），所以要另外組。
 * 非二轉徽章回空陣列。
 */
function buildT2MechanicLines(lib) {
  const id = String(lib?.itemId || lib?.id || "");
  if (!id) return [];
  let branch = null;
  try {
    branch = require("./jobAdvancement").getT2Branch(id);
  } catch (_) { return []; }
  if (!branch) return [];

  const out = [`🔱 二轉專屬（${branch.name}）：`];

  // 戰鬥姿態（聖劍士／大元素師…）
  if (branch.stances) {
    const btnCount = Array.isArray(branch.battleActions) ? branch.battleActions.length : Object.keys(branch.stances).length;
    out.push(`・開打前選擇姿態，整場適用（戰鬥畫面 ${btnCount} 顆按鈕）`);
    for (const [key, st] of Object.entries(branch.stances)) {
      const bits = [];
      if (Number.isFinite(Number(st.blockChance))) bits.push(`格擋率 ${st.blockChance}%`);
      if (st.guaranteedElement) {
        const ge = st.guaranteedElement;
        bits.push(`保證站在屬性相剋優勢方（武器屬性 ≥${ge.upgradeFromWeaponLevel ?? 2} 級→以 ${ge.upgradedLevel ?? 4} 級相剋出手 +${(ge.upgradedLevel ?? 4) * 10}%，否則 ${ge.baseLevel ?? 2} 級 +${(ge.baseLevel ?? 2) * 10}%；怪物無屬性不生效）`);
      }
      if (Number(st.shieldBashPct) > 0) bits.push(`格擋成功追加盾擊（ATK ${st.shieldBashPct}%）`);
      if (st.requiresShield) bits.push(`需裝備盾牌`);
      // 元素師三姿態
      if (st.fireCircle) bits.push(`怪物每回合受到你攻擊力 ${st.fireCircle.matkPct}% 的火傷（開場就燒；世界王所有部位一起燒）`);
      if (st.stormVolley) bits.push(`每回合固定 ${st.stormVolley.hits} 段法術彈（每段 ${st.stormVolley.pctPerHit}%、各段獨立爆擊；無視連擊／三元牌／骰子多段，雙持追擊保留單追擊）`);
      if (st.freezeCharge) {
        try {
          const zf = require("./zoneFreezeGauge");
          bits.push(`出戰累積該區域冰凍值（量＝戰鬥回合數）；滿 ${zf.DEFAULT_THRESHOLD} → 區域冰封 ${Math.round(zf.FREEZE_WINDOW_MS / 1000)} 秒內出戰全程免傷，之後免疫 ${Math.round(zf.IMMUNE_MS / 60000)} 分鐘`);
        } catch (_) { bits.push(`出戰累積該區域冰凍值，凍滿全區冰封`); }
      }
      if (st.stanceElement) {
        const _elZh = { earth: "土", fire: "火", water: "水", wood: "木", metal: "金", sun: "日", moon: "月" };
        bits.push(`攻擊帶${_elZh[st.stanceElement.element] || st.stanceElement.element}屬性 ${st.stanceElement.level} 級（與武器同屬性→等級相加封頂 4、不同屬性→取最高）`);
      }
      out.push(`　◦ ${st.label || key}：${bits.length ? bits.join("、") : "無附加效果（一般攻擊）"}`);
    }
  }

  // 區域連段＋氣力格（劍鬼）
  if (branch.combo) {
    try {
      const zc = require("./zoneCombo");
      out.push(`・區域連段（COMBO・被動）：同一區每打完一場 +1；只有換區／10 分鐘沒打會歸零`);
      out.push(`　◦ 死鬥：陣亡也照樣 +1、連段不歸零——被王打死是修羅的修行`);
      out.push(`　◦ 階梯加成（${zc.COMBO_BUFF_MAX_AT} 段吃滿）：${zc.COMBO_TIERS.map((t) => `${t.at}→${t.label}`).join("、")}`);
      out.push(`・斬（自動施放）：氣力 3 格——每回合有攻擊到對手 +1 格（每回合最多 1），滿 3 格下回合自動施放`);
      out.push(`　◦ 斬的倍率＝1＋0.1×min(連段,${zc.COMBO_BUFF_MAX_AT})（連段 ${zc.COMBO_BUFF_MAX_AT} 時 ×${(1 + 0.1 * zc.COMBO_BUFF_MAX_AT).toFixed(0)}）；無視防禦與等級差、可爆擊`);
      out.push(`　◦ 氣力同一場域跨場沿用（換區／10 分鐘沒打歸零）；滿格時戰鬥先結束 → 帶去下一場開場就斬`);
    } catch (_) { /* 模組讀不到就略過 */ }
  }

  // 連擊氣條（影舞者）
  if (branch.shadowGauge) {
    try {
      const sg = require("./shadowGauge");
      out.push(`・連擊氣條（被動）：${sg.GAUGE_MAX} 格——本回合有出現連擊 +1 格（每回合最多 1）`);
      out.push(`　◦ 滿 ${sg.GAUGE_MAX} 格全部消耗 → 下一回合固定 ${sg.BURST_HITS} 連擊（殘影亂舞；該回合不累氣）`);
      out.push(`　◦ 氣條同一場域跨場沿用（換區／10 分鐘沒打歸零）；滿格時戰鬥先結束 → 帶去下一場開場施放`);
    } catch (_) { /* 模組讀不到就略過 */ }
  }

  // 血怒／血祭／戰意集氣（狂戰士）
  if (branch.bloodRage) {
    out.push(`・血怒（被動）：每缺 1% HP → 攻擊力 +${branch.bloodRage.perMissPct}%，最高 +${branch.bloodRage.capPct}%`);
  }
  if (branch.sacrifice) {
    out.push(`・血祭（戰鬥畫面按鈕）：開場自傷最大 HP 的 ${branch.sacrifice.hpCostPct}%，換整場攻擊力 +${branch.sacrifice.atkUpPct}%`);
  }
  if (branch.gauge) {
    out.push(`・戰意集氣（被動）：每打完一場 +1 格，集滿 ${branch.gauge.max} 格的下一戰爆擊率 +${branch.gauge.critRateBonus}，之後歸零重集`);
  }

  // 日之精靈（聖靈師）
  if (branch.sunSpirit) {
    const sp = branch.sunSpirit;
    out.push(`・日之精靈（被動・召喚）：開場自動召喚，怪物的攻擊**先由精靈承受**（精靈倒下後你才會受傷）`);
    out.push(`　◦ 精靈血量＝你的最大 HP、防禦＝你的 DEF（不繼承閃避與格擋）；血量同區跨場沿用，倒下 → 下一場以 50% 血量重召`);
    out.push(`　◦ 協攻：每回合追加一擊，攻擊力＝你的 ${sp.atkRatio}%、自帶日屬性 ${sp.elementLevel} 級（單發、不爆擊）`);
    out.push(`　◦ 精靈在場時：你給隊伍的光環效果 ×${sp.auraMult}`);
    out.push(`・大治療術（被動）：每 ${sp.healEveryRounds} 個有出手的回合施放，回復最大 HP 的 ${sp.healPct}%——精靈在場先回精靈，否則回自己`);
  }

  // 兵聖三件套
  if (branch.sage) {
    const sg = branch.sage;
    out.push(`・三十六計（被動・計謀值 3 格）：每個有攻擊的回合 +1 格，滿 3 → 隨機施展一計（跨場沿用）`);
    out.push(`　◦ 🔥 火攻之計：一擊 ATK ${sg.fire?.hitPct ?? 150}%＋灼燒 ${sg.fire?.burnTurns ?? 3} 回合`);
    out.push(`　◦ 🪨 落石之計：一擊 ATK ${sg.rock?.hitPct ?? 120}%＋暈眩 1 回合（世界王吃既有上限/免疫規則）`);
    out.push(`　◦ 🌫️ 瞞天過海：下回合對手必定打空、你的攻擊必中`);
    out.push(`　◦ ⛓️ 連環之計：下回合固定 ${sg.chain?.hits ?? 3} 連擊`);
    out.push(`　◦ 🚩 破釜沉舟：接下來 ${sg.allin?.rounds ?? 2} 回合傷害 ×${sg.allin?.mult ?? 3}，期間無法迴避格擋、受傷 +50%`);
    out.push(`・知彼（被動）：怪物圖鑑的傷害加成效果 ×${sg.knowledgeMult ?? 2}（上限 25% → ${25 * (sg.knowledgeMult ?? 2)}%）`);
  }

  // 吟遊詩人（演奏判定）
  if (branch.bardSong) {
    try {
      const bs = require("./bardSong");
      const lv = bs.LEVELS; // [簡單, 普通, 困難]
      out.push(`・演奏判定（動作玩法）：戰後待命時畫面出現方向箭頭（${lv.map((t) => `${t.name}${t.len}鍵`).join("／")}），${Math.round(bs.TIME_LIMIT_MS / 1000)} 秒內輸入（鍵盤方向鍵／手機滑動）；完成即自動排隊下一場`);
      out.push(`　◦ 每按對 1 鍵：下一場傷害 +${lv[0].perHitPct}~${lv[lv.length - 1].perHitPct}%（依難度），按錯扣同值；倍率範圍 ×0.7~×2.0`);
      out.push(`　◦ 完美演奏：完美連奏 +1（上限 ${bs.STREAK_MAX} 層，每層再 +${bs.STREAK_PCT}%）；另觸發「完美和弦」開場追擊 ×(${lv[0].chordBasePct}~${lv[lv.length - 1].chordBasePct}% + 連奏×${bs.CHORD_PER_STREAK_PCT}%)`);
      out.push(`　◦ 難度升降：連奏 ${lv[1].minStreak} 升普通、${lv[2].minStreak} 升困難；沒全對降一級；陣亡／換區／閒置 10 分回簡單`);
      out.push(`　◦ 演奏加持：隊伍光環 ×(1 + 連奏×${bs.AURA_PER_STREAK_PCT}%)——滿連奏光環兩倍（斷奏自然回落）`);
      out.push(`　◦ 連奏同區跨場沿用；沒演奏＝不加不減但連奏中斷；DC 出戰無演奏`);
    } catch (_) { /* noop */ }
  }

  // 聖域師（符文結界／聖域展開）
  if (branch.sanctum) {
    const sc = branch.sanctum;
    out.push(`・符文結界：開場展開護盾（最大 HP ${sc.barrierBasePct}% ＋ INT×${sc.barrierPerInt}），受傷先扣結界再扣血`);
    out.push(`　◦ 共鳴反爆：結界吸收的傷害累積，引爆時轟出 **吸收量 ×${sc.detonateMult} ×(引爆回合/全場回合)** 的無視防禦傷害`);
    out.push(`　◦ 三個引爆時機：提前引爆（這一爆剛好收頭）／結界被打爆（當回合爆、倍率打折）／撐到最後一回合（滿倍率最痛）`);
    out.push(`・聖域展開：出戰累積區域聖域值（每場 +1，滿 4 格）→ 區域聖域 20 秒：任何人出戰受傷 -${sc.sanctumDamageCutPct}%、每回合回復 ${sc.sanctumHealPct}% HP`);
    out.push(`　◦ 聖域期間自己的隊伍光環 ×${sc.auraMult}；聖域結束後免疫 2 分鐘再重新累積`);
  }

  // 賭神三件套
  if (branch.diceGod) {
    const dg = branch.diceGod;
    out.push(`・魔法骰：骰子傷害視為魔法——常駐無視 25% DEF（與雙手法杖同級）`);
    out.push(`・命運骰：${dg.gaugeMax} 格集氣（有攻擊的回合 +1），滿的那回合改丟 **3 顆骰子**——第三顆骰出幾點＝當回合幾連擊，每一擊都是前兩顆骰子的傷害`);
    out.push(`・手氣正旺：每回合兩顆傷害骰平均 >3 → 手氣 +1 層（每層傷害 +${dg.luckPerStackPct}%、上限 ${dg.luckMaxStacks} 層＝+${dg.luckPerStackPct * dg.luckMaxStacks}%）；平均 <3 → 歸零；跨場沿用（只有手氣轉冷會掉）`);
    out.push(`・賭徒技能（將大局逆轉吧／千術）綁定骰子武器——沒拿骰子不發動`);
  }

  // 神射手三件套
  if (branch.sniper) {
    const sn = branch.sniper;
    out.push(`・掩護射擊（被動・團隊）：你在區域內時，區內其他玩家出戰，每回合替他們補一箭（你 ATK 的 ${sn.supportShotPct}%、吃你的爆擊）；世界王時箭傷計入你的貢獻排名`);
    out.push(`・神速反擊（被動）：這回合對手沒打到你——揮空／被你閃過／來不及出手／被暈眩／被冰封——就追加一箭（ATK ${sn.counterShotPct}%）`);
    out.push(`・震盪射擊（被動・震盪值 4 格）：每個有攻擊的回合 +1 格，滿 4 → 立刻一箭（ATK ${sn.shockShotPct}%）並震退對手——下回合對手構不到你（又觸發神速反擊）`);
    out.push(`　◦ 震盪值同一場域跨場沿用（換區／10 分鐘沒打歸零）`);
  }

  // 暈眩專精（矮人戰士長）
  if (branch.stunMastery) {
    out.push(`・山碎（被動）：對暈眩中的目標無視防禦（固定防禦仍在）`);
    out.push(`・巨神之握（被動）：世界王對你的暈眩上限 1 → ${branch.stunMastery.bossStunCap} 回合`);
  }
  if (branch.stunGauge) {
    try {
      const dsg = require("./dwarfStunGauge");
      out.push(`・巨神震擊（被動・團隊）：只有你敲得動世界王的暈眩條，敲擊量＝該場實際有攻擊到的回合數`);
      out.push(`　◦ 敲滿 ${dsg.DEFAULT_THRESHOLD} → 全服 ${Math.round(dsg.STUN_WINDOW_MS / 1000)} 秒內出戰的人整場免傷，之後王免疫 ${Math.round(dsg.IMMUNE_MS / 60000)} 分鐘`);
    } catch (_) { /* noop */ }
  }

  // 爬塔光環
  if (branch.towerAura?.notes) out.push(`・${branch.towerAura.notes}`);
  return out.length > 1 ? out : [];
}

module.exports = {
  buildT2MechanicLines,
  PCT_VALUE_EFFECT_KEYS,
  NO_VALUE_EFFECT_KEYS,
  formatEffectValueText,
  buildItemEffectLines,
};
