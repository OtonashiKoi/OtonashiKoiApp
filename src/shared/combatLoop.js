"use strict";

/**
 * 共用戰鬥迴圈
 * 供 playerAppRoutes（quick-battle）與 monsterZoneHandlers（Discord 戰鬥）共用
 *
 * @param {object} pStats   calcPlayerStats() 的回傳值
 * @param {object} mCalc    monster.calc（effectiveCalc 的回傳值）
 * @param {string} mName    怪物名稱
 * @param {number} mHpInit  怪物起始 HP
 * @param {number} MAX_ROUNDS 最大回合數
 * @returns {{ outcome, roundLogs, totalDamage, finalMonsterHp, finalPlayerHp, combatStats }}
 */
const { collectEquipmentEffects, isEffectConditionMet } = require("./effectEngine");
const { calcHitChance } = require("./hitChance");
const {
  TURTLE_TIDE_EFFECT_KEY,
  normalizeTurtleTideConfig,
  turtleTidePhase,
  isTurtleTideTransitionRound,
} = require("./turtleSet");

// 吸血總量上限（2026-08-04）：吸血來源可疊加（A階吸血戒 15＋錨點 15＋怪物卡…），
// 舊制無上限時理論可疊到 75%＝造成傷害的四分之三變回血。
const LIFESTEAL_CAP_PCT = 25;

// ── 回復型／護盾型原型：治療與護盾吃 INT 斜率（2026-08-05）──
// 問題：治療量與護盾吸收原本全掛在 `maxHp × 百分比` 上 → 玩家堆 INT、換法杖、升徽章，
// 生存力一點都不會變強，只有堆血量有用（那是重甲型的玩法）。這是下季四原型只有
// 重甲與閃避成立、回復型與護盾型 0 職業可行的直接原因。
// 作法：沿用既有聖域（二轉）的公式形狀 `maxHp×基礎% + INT×每點係數`，
//       採「加算」而非取代——既有道具的 %maxHp 底值原封不動，INT 斜率疊加在上面
//       （拉底不壓頂，且不需要為現有道具寫遷移）。
// 係數出處：docs/SEASON_NEXT_SURVIVAL_15R_DESIGN.md 四原型反推表
//   回復型需 ~180/回合（≈17% maxHp）、護盾型需每 3 回合 ~1000 吸收。
const HEAL_INT_SCALE = 2.5;    // 每 1 點 INT → 每回合額外治療量
const SHIELD_INT_SCALE = 12;   // 每 1 點 INT → 每次展盾額外吸收量
function intHealBonus(pStats) {
  return Math.max(0, Math.round((Number(pStats?.int) || 0) * HEAL_INT_SCALE));
}
function intShieldBonus(pStats) {
  return Math.max(0, Math.round((Number(pStats?.int) || 0) * SHIELD_INT_SCALE));
}
const {
  normalizeElement, normalizeElementLevel, getElementMultiplier,
  resolveWeaponElement,
  getSameElementResist, getElementLabel, getElementRelation,
} = require("./elementSystem");
const {
  calcAttackTierProbs,
  calcDefenseTierProbs,
  rollAttackTier,
  rollDefenseTier,
  ATTACK_TIER_MULT,
  DEFENSE_TIER_MULT,
  getWeaponConfig,
} = require("./combatStats");

const WEAPON_PHRASE_BANK = {
  default: ["揮拳猛擊", "飛腿踢出", "怒拳轟擊", "突刺重擊", "橫掃一擊", "沉肩衝撞"],
  sword_1h: ["揮劍斬擊", "劍鋒突刺", "斜斬破風", "連續快斬", "踏步橫掃", "收劍再斬"],
  sword_2h: ["重劍劈落", "雙手斬下", "劍身破空", "大開大闔地橫斬", "蓄力重劈", "狂斬壓制"],
  dagger: ["迅捷刺出", "連環割襲", "貼身突刺", "趁隙猛刺", "回身偷切", "影步短刃連擊"],
  mace_1h: ["重錘猛砸", "迴旋錘擊", "震地一擊", "猛力橫掃", "錘面直落", "寸勁敲擊"],
  mace_2h: ["巨錘轟落", "雙手錘擊", "地裂重鎚", "全力震擊", "狂猛砸落", "鐵鎚破陣"],
  axe_1h: ["斧刃劈砍", "破甲一擊", "側身橫斬", "旋身揮砍", "碎盾斜切", "怒斧下劈"],
  axe_2h: ["巨斧狂劈", "雙手劈落", "開山斬擊", "裂地重砍", "狂暴橫掃", "全力破陣"],
  staff: ["施展魔法", "吟唱咒語", "釋放法術", "引導魔力", "凝聚咒陣", "驅使元素"],
  bow: ["拉弓射擊", "瞄準放箭", "急速連射", "精準狙擊", "拉弦破空", "連珠齊射"],
  dice: ["擲出命運之骰", "甩手一擲", "骰子在空中翻轉落下", "把運氣賭上這一擊", "指尖彈出骰子", "隨手一擲定生死"]
};
const DICE_PIPS = ["【1】", "【2】", "【3】", "【4】", "【5】", "【6】"];
const CRIT_PHRASES = ["會心一擊", "致命一擊", "弱點命中", "完美命中", "要害洞穿", "破綻捕捉"];
const COMBO_PHRASES = ["連擊！", "殘影連斬！", "急速追打！", "趁勢猛攻！", "流暢追擊！", "壓迫連段！"];
const DODGE_PHRASES = ["身形一閃", "靈巧側移", "急速後撤", "俐落閃身", "錯步避開", "滑步拉開距離"];
const MONSTER_DODGE_PHRASES = ["及時閃避", "往旁一跳", "後退一步", "扭身躲開", "側翻避過", "驚險卸力"];
const MONSTER_ATK_PHRASES = ["猛力衝撞", "揮爪攻擊", "重擊落下", "怒吼突進", "野蠻撲擊", "全身壓來"];
const BLOCK_PHRASES = ["以盾格擋", "舉盾抵擋", "盾牌格開", "穩穩架住", "橫盾卸力", "硬生生擋下"];
const STUN_PHRASES = ["被重擊擊暈", "失去平衡", "陷入眩暈", "腦中一陣空白", "身形踉蹌", "暫時失去反應"];
const COUNTER_PHRASES = ["抓準破綻", "順勢回擊", "趁勢反撲", "借力反打", "逆勢追擊", "回敬一擊"];
const EXECUTE_PHRASES = ["一擊終結", "致命收尾", "毫不留情地帶走", "斬落最後一口氣", "乾脆俐落收場", "直接送回老家"];
const PARTY_HEAL_PHRASES = ["暖流湧上", "生命回到體內", "治癒波動拂過", "體力稍微回穩", "來自隊伍的守護生效", "你穩住了陣腳"];
const PARTY_DAMAGE_PHRASES = ["隊伍氣勢高漲", "攻勢被推上頂點", "同伴的鬥志加持在身", "戰意一路飆升", "你感到火力被放大", "鋒芒更盛"];

// AGI 優勢敘述
const AGI_FIRST_STRIKE_PHRASES = ["反應不及，你太快了", "無法跟上你的速度", "被你的敏捷完全壓制", "你的速度超乎預料", "來不及反應"];
const AGI_SLOWED_ATTACK_PHRASES = ["有點跟不上節奏", "被你的速度牽著鼻子走", "招架不住你的敏捷", "無力應對你的攻勢"];

function pickWeaponPhrases(weaponType) {
  if (!weaponType) return WEAPON_PHRASE_BANK.default;
  if (weaponType.startsWith("staff")) return WEAPON_PHRASE_BANK.staff;
  if (weaponType === "bow") return WEAPON_PHRASE_BANK.bow;
  if (weaponType === "dice") return WEAPON_PHRASE_BANK.dice;
  if (weaponType === "dagger") return WEAPON_PHRASE_BANK.dagger;
  if (weaponType === "mace_1h") return WEAPON_PHRASE_BANK.mace_1h;
  if (weaponType === "mace_2h") return WEAPON_PHRASE_BANK.mace_2h;
  if (weaponType === "axe_1h") return WEAPON_PHRASE_BANK.axe_1h;
  if (weaponType === "axe_2h") return WEAPON_PHRASE_BANK.axe_2h;
  if (weaponType === "sword_2h") return WEAPON_PHRASE_BANK.sword_2h;
  if (weaponType === "sword_1h") return WEAPON_PHRASE_BANK.sword_1h;
  return WEAPON_PHRASE_BANK.default;
}

function detectJobBattleProfile(equipped = {}, inventory = []) {
  const jobEq = equipped?.job_eq || null;
  const context = { equipped, inventory };
  const allJobEffects = [
    ...(Array.isArray(jobEq?.passiveEffects) ? jobEq.passiveEffects : []),
    ...(Array.isArray(jobEq?.procEffects) ? jobEq.procEffects : []),
    ...(Array.isArray(jobEq?.combatEffects) ? jobEq.combatEffects : [])
  ];
  const activeJobEffects = allJobEffects.filter((effect) => isEffectConditionMet(effect, context));
  // ⭐ 戰報敘述用的職業原型：一律走 jobAdvancement.resolveJobKey（唯一入口），
  //    二轉徽章會解析回一轉 key（劍鬼→swordsman、狂戰士→warrior…），敘述才不會變成 default。
  //    只採用 JOB_FLAVOR 真的有敘述庫的 key（軍師/詩人/結界師沒有 → 落回武器判斷）。
  let archetype = "default";
  try {
    const k = require("./jobAdvancement").resolveJobKey(jobEq);
    if (k && Object.prototype.hasOwnProperty.call(JOB_FLAVOR, k)) archetype = k;
  } catch (_) { archetype = "default"; }
  if (archetype === "default") {
    const weaponType = equipped?.weapon?.weaponType || "";
    if (weaponType.startsWith("staff")) archetype = activeJobEffects.some((e) => e.target === "party") ? "healer" : "mage";
    else if (weaponType === "dice") archetype = "gambler";
    else if (weaponType === "bow") archetype = "archer";
    else if (weaponType === "dagger") archetype = "rogue";
    else if (weaponType.startsWith("mace")) archetype = "dwarf_warrior";
    else if (weaponType.startsWith("axe")) archetype = "warrior";
    else if (weaponType.startsWith("sword")) archetype = "swordsman";
  }

  return {
    jobId: jobEq?.itemId || jobEq?.id || null,
    jobName: jobEq?.itemName || jobEq?.name || null,
    archetype,
    activeJobEffects
  };
}

const JOB_FLAVOR = {
  default: {
    intro: ["戰意升起，準備迎擊。", "氣息收束，正面迎戰。", "握緊武器，進入戰鬥狀態。"],
    hit: ["硬碰硬地壓上去", "全力施壓", "不留空隙地攻擊"],
    crit: ["抓住破綻，狠狠補上一擊", "以精準一擊撕開防線", "將破綻直接放大"],
    combo: ["趁勢追打", "連續壓上", "不給喘息機會"],
    dodge: ["輕巧避開", "側身閃過", "拉開距離重整架勢"],
    block: ["穩穩擋下", "用防線吃住", "將攻擊卸開"],
    counter: ["立刻反咬回去", "順著破口追擊", "抓準時機反手一擊"],
    execute: ["直接收掉", "乾脆終結", "不留活口"],
    lowHp: ["越戰越兇", "開始拼命反撲", "火力不減反增"]
  },
  swordsman: {
    intro: ["劍鋒出鞘，節奏俐落。", "腳步一沉，劍路已定。", "鋒芒收束，準備斬出第一線。"],
    hit: ["以劍鋒劃破攻勢", "利落斬開空氣", "劍路直取要害"],
    crit: ["劍光一閃，乾淨俐落地切入破綻", "刀口般的劍鋒直接命中死角", "斬擊精準到讓人無法反應"],
    combo: ["劍勢連段不斷壓上", "連斬像浪潮一樣逼近", "劍光接續收割空隙"],
    dodge: ["以步法閃過", "收劍側身避開", "劍士身法俐落轉位"],
    block: ["橫劍格開", "穩穩架住攻擊", "劍身硬吃下衝擊"],
    counter: ["劍尖立刻回敬", "斬勢順著破綻追上", "反手一劍逼退對方"],
    execute: ["一劍斬落", "收劍收尾，直接終結", "以最短的劍路結束戰鬥"],
    lowHp: ["劍意反而更冷", "在壓力下越斬越準", "進入決勝節奏"]
  },
  warrior: {
    intro: ["斧刃壓陣，戰線向前推進。", "戰士踏步向前，氣勢先行。", "斧光與殺意一起壓來。"],
    hit: ["以斧勢硬壓", "斧刃猛然劈落", "靠蠻力正面開路"],
    crit: ["斧鋒直接破開防守", "一斧砸出致命空隙", "把破綻砍成裂口"],
    combo: ["斧勢接續碾壓", "連砍逼得對方連退", "攻擊像風暴一樣續上"],
    dodge: ["厚重身形硬是錯開", "踏步讓過攻擊", "以戰士節奏避開"],
    block: ["硬生生擋下", "靠身體與武器接住", "把攻勢頂回去"],
    counter: ["立刻甩斧回敬", "抓著空檔反劈", "順勢反打得很兇"],
    execute: ["一斧收割", "乾脆劈落", "把戰鬥直接砍停"],
    lowHp: ["越危險越兇猛", "進入血性狂潮", "斧鋒反而更重"]
  },
  dwarf_warrior: {
    intro: ["鐵錘沉沉落地，震得地面發麻。", "矮人戰士抬錘，這一擊不是開玩笑。", "工具與武器合一，準備重錘破陣。"],
    hit: ["用錘面把對手砸回去", "重鎚轟得對方站不穩", "以工匠般精準的力量敲擊要點"],
    crit: ["一錘敲進骨節與破綻之間", "鍛造般的重擊直接定型勝負", "震盪過後只剩倒地聲"],
    combo: ["重錘接重錘，壓得對方喘不過氣", "每一下都像在打鐵", "錘擊連續落下，節奏無法阻擋"],
    dodge: ["用厚實步伐避開", "側身讓開重擊", "靠重心轉移卸掉衝撞"],
    block: ["把攻擊硬頂回去", "像鐵砧一樣接下", "用厚重防線扛住"],
    counter: ["回敬一記更沉的", "趁對方失衡直接補錘", "反手就是工匠級重擊"],
    execute: ["一錘定音", "敲碎最後一口氣", "重錘收工"],
    lowHp: ["越接近極限越狂", "鐵匠之魂全面燃起", "進入不講理的敲擊模式"]
  },
  archer: {
    intro: ["弓弦拉滿，目標已鎖定。", "箭袋與呼吸同步，等待放箭。", "弓手站位穩住，下一箭不會落空。"],
    hit: ["精準放箭", "箭矢直奔破綻", "拉弓射出俐落一擊"],
    crit: ["箭頭穿過防線的瞬間幾乎聽不見聲音", "一箭命中最脆弱的位置", "像獵人一樣精準收網"],
    combo: ["連珠齊射，逼得對方連喘都難", "箭雨一路追上", "追射不給空隙"],
    dodge: ["箭步退開", "輕快地拉開距離", "利用身位閃避"],
    block: ["用臨機反應卸掉衝擊", "弓身與步伐一起格開", "以流動身法化解"],
    counter: ["迴避後立刻回射", "趁對方失位補上一箭", "以反擊箭雨回敬"],
    execute: ["一箭封喉", "箭落定勝負", "乾淨俐落地射穿結局"],
    lowHp: ["冷靜到更像獵手", "越危急越能穩住準星", "呼吸一沉，箭更準了"]
  },
  healer: {
    intro: ["治癒的氣息先穩住了戰線。", "聖光與呼吸同步，節奏慢下來了。", "治療師站位穩定，隊伍像被縫合起來。"],
    hit: ["以杖光推進", "溫和卻不退讓地擊出", "用祝福與力道一起向前"],
    crit: ["光芒忽然收束成刺點", "治癒之中帶出精準打擊", "安定的節奏裡藏著致命一擊"],
    combo: ["連續施壓，讓對方無法亂動", "治療節奏帶動攻勢", "隊伍氣息越來越穩"],
    dodge: ["以平穩步伐退開", "在光暈中滑過攻擊", "穩穩錯開來勢"],
    block: ["靠祝福把衝擊擋下", "把攻勢化成震盪", "用聖光緩衝傷害"],
    counter: ["守住後順勢反推", "把節奏拉回自己手上", "反擊像替隊伍重新接線"],
    execute: ["替戰局劃下句點", "穩穩收尾", "把局面安放到結束"],
    lowHp: ["越緊張越把大家拉回來", "治療本能完全啟動", "守護慾望變得更強"]
  },
  mage: {
    intro: ["元素已經在指尖聚攏。", "咒語起伏，戰場開始失衡。", "法師抬手，魔力順著空氣流轉。"],
    hit: ["把魔力直接推進去", "讓元素在目標身上炸開", "以術式切開距離"],
    crit: ["咒陣瞬間收縮，爆出一口元素風暴", "魔力壓縮成最精準的一擊", "術式找到最脆的那一點"],
    combo: ["連續咒文像迴圈一樣壓來", "元素串連爆發", "魔法追擊層層堆疊"],
    dodge: ["法袍一轉錯開攻擊", "借元素推開身位", "滑步拉出安全距離"],
    block: ["用法力障壁接住", "術式偏轉衝擊", "讓能量在周圍散開"],
    counter: ["立刻補上下一段咒式", "順著破綻再丟一輪元素", "把反擊寫進術式裡"],
    execute: ["元素完成終章", "術式直接封死退路", "把對方燒成結局"],
    lowHp: ["危局反而讓咒式更亮", "魔力進入高速運轉", "術式開始不講理地爆發"]
  },
  rogue: {
    intro: ["腳步壓低，影子先一步進場。", "匕首在暗處閃了一下。", "盜賊已經站在看不見的位置。"],
    hit: ["匕首快速切入", "趁縫隙貼身一刺", "以短刃連續偷襲"],
    crit: ["命中陰影裡的要害", "短刃像消失一樣穿過破綻", "把對方的反應直接切斷"],
    combo: ["連環偷襲像細雨一樣落下", "影子追著影子進攻", "節奏越來越快"],
    dodge: ["身影一晃就不見了", "貼地滑開", "利用視線死角消失"],
    block: ["短刃一橫卸掉力道", "以最小動作接下", "把衝擊轉進步伐裡"],
    counter: ["從背後補上一刀", "順著空隙反咬", "一口氣把距離吃回來"],
    execute: ["乾淨地收尾", "匕首落下，戰鬥停在這裡", "影子直接劃開終局"],
    lowHp: ["越危險越冷靜", "本能進入狩獵狀態", "殺意反而更靜了"]
  },
  gambler: {
    intro: ["骰子在掌心轉了一圈。", "賭桌已經開了，籌碼是命。", "運氣站在誰那邊，擲了才知道。"],
    hit: ["骰面翻出一個好數字", "把賠率壓在這一擊上", "運氣順著手勁砸過去"],
    crit: ["六點朝上，全押命中", "骰子停在最狠的那一面", "這一把賭贏了，代價由對方付"],
    combo: ["連續開出大點", "手氣正燙，停不下來", "一把接一把地翻牌"],
    dodge: ["運氣替你擋了一下", "剛好賭對了方向", "骰子偏了半格，你活下來了"],
    block: ["賭一把硬接", "壓下注碼吃住這擊", "拿運氣頂在前面"],
    counter: ["莊家翻臉，反手加注", "把輸的一把立刻討回來", "換你發牌了"],
    execute: ["一把梭哈收場", "骰子落定，牌局結束", "運氣在最後一刻站到你這邊"],
    lowHp: ["越輸越敢押", "把剩下的全部推上桌", "沒有退路的賭局最好玩"]
  }
};

function getJobFlavor(jobProfile = {}, pStats = {}) {
  const archetype = jobProfile.archetype || "default";
  const bank = JOB_FLAVOR[archetype] || JOB_FLAVOR.default;
  const weaponBank = pickWeaponPhrases(pStats.weaponType);
  return {
    intro: bank.intro,
    hit: bank.hit,
    crit: bank.crit,
    combo: bank.combo,
    dodge: bank.dodge,
    block: bank.block,
    counter: bank.counter,
    execute: bank.execute,
    lowHp: bank.lowHp,
    atkVerbs: weaponBank
  };
}

// 應用怪物 activeEffects 到屬性計算
function applyMonsterEffects(mCalc, activeEffects = [], currentRound = 1) {
  const adjusted = { ...mCalc };

  for (const effect of activeEffects) {
    if (!effect || !effect.key) continue;

    const params = effect.params || {};
    const duration = params.duration || {};

    // 檢查持續時間（"turns" 模式）
    if (duration.mode === 'turns') {
      const appliedRound = effect.appliedAt || 1;
      const endRound = appliedRound + (duration.value || 1);
      if (currentRound > endRound) continue; // 效果已過期
    }

    // 應用各種 Buff 效果
    switch (effect.key) {
      case 'str_up':
        // STR 提升（百分比，value=30 表示 ATK +30%）
        adjusted.atk = Math.round((adjusted.atk || 0) * (1 + Math.abs(params.value || 0) / 100));
        break;
      case 'atk_up':
        // ATK 提升（百分比）
        adjusted.atk = Math.round((adjusted.atk || 0) * (1 + (params.value || 0) / 100));
        break;
      case 'final_damage_up':
        adjusted.finalDamageMultiplier = (adjusted.finalDamageMultiplier || 1) * (1 + Math.abs(params.value || 0) / 100);
        break;
      case 'final_damage_down':
        adjusted.finalDamageMultiplier = (adjusted.finalDamageMultiplier || 1) * (1 - Math.min(95, Math.abs(params.value || 0)) / 100);
        break;
      case 'damage_taken_up':
        adjusted.damageTakenMultiplier = (adjusted.damageTakenMultiplier || 1) * (1 + Math.abs(params.value || 0) / 100);
        break;
      case 'def_up':
        // DEF 提升（百分比，value=25 表示 +25%）
        if (params.mode === 'flat') adjusted.def = (adjusted.def || 0) + Math.abs(params.value || 0);
        else adjusted.def = Math.round((adjusted.def || 0) * (1 + Math.abs(params.value || 0) / 100));
        break;
      case 'dodge_up':
        // 迴避提升（百分比）
        adjusted.dodge = Math.min(100, (adjusted.dodge || 0) + (params.value || 0));
        break;
      case 'agi_up':
        adjusted.agi = (adjusted.agi || 0) + Math.abs(params.value || 0);
        adjusted.dodge = Math.min(100, (adjusted.dodge || 0) + Math.abs(params.value || 0) * 0.5);
        break;
      case 'speed_up':
        // AGI 提升 → 提升迴避率
        adjusted.dodge = Math.min(100, (adjusted.dodge || 0) + (params.value || 0) * 4); // AGI 1 = dodge 4
        break;
      case 'block_chance_up':
        adjusted.blockChance = Math.min(95, Math.max(0,
          Number(adjusted.blockChance || 0) + Math.abs(Number(params.value) || 0)
        ));
        break;
      case 'crit_rate_up':
        // 爆擊率提升（百分比，value=20 表示 +20% 爆擊率）
        adjusted.crit = Math.min(100, (adjusted.crit || 0) + Math.abs(params.value || 0));
        break;
      case 'hit_up':
        // 命中提升
        adjusted.hit = Math.min(100, (adjusted.hit || 0) + Math.abs(params.value || 0));
        break;
      case 'crit_damage_up':
        adjusted.critDamageMultiplier = (adjusted.critDamageMultiplier || 1) * (1 + Math.abs(params.value || 0) / 100);
        break;
      case 'lifesteal':
        // 吸血：記錄百分比，戰鬥攻擊時處理
        adjusted.lifestealPct = (adjusted.lifestealPct || 0) + Math.abs(params.value || 0);
        break;
      case 'life_steal_strong':
        // 強力吸血：記錄百分比，戰鬥攻擊時處理
        adjusted.lifestealPct = (adjusted.lifestealPct || 0) + Math.abs(params.value || 0);
        break;
      case 'counter':
        // 反擊：記錄反擊機率，被擊中時處理
        adjusted.counterChance = (adjusted.counterChance || 0) + Math.abs(params.value || 0);
        break;
      case 'damage_reduction':
        adjusted.damageReductionPct = (adjusted.damageReductionPct || 0) + Math.abs(params.value || 0);
        break;
      case 'def_ignore':
        adjusted.defIgnorePct = (adjusted.defIgnorePct || 0) + Math.abs(params.value || 0);
        break;
      case 'ancient_power':
        // 遠古力量：怪物增強自身 ATK value%
        adjusted.atk = Math.round((adjusted.atk || 0) * (1 + Math.abs(params.value || 0) / 100));
        break;
      case 'atk_down':
        // 攻擊力下降（百分比，value 為正數代表降低）
        adjusted.atk = Math.max(0, Math.round((adjusted.atk || 0) * (1 - Math.abs(params.value || 0) / 100)));
        break;
      case 'def_down':
        // 防禦力下降（百分比，value 為正數代表降低）
        adjusted.def = Math.max(0, Math.round((adjusted.def || 0) * (1 - Math.abs(params.value || 0) / 100)));
        break;
      case 'hit_rate_down':
        // 麻痺：命中率下降（固定值）
        adjusted.hit = Math.max(0, (adjusted.hit || 0) - Math.abs(params.value || 0));
        break;
      case 'hit_down':
        adjusted.hit = Math.max(0, (adjusted.hit || 0) - Math.abs(params.value || 0));
        break;
      case 'dodge_down':
        adjusted.dodge = Math.max(0, (adjusted.dodge || 0) - Math.abs(params.value || 0));
        break;
      case 'agi_down':
        adjusted.agi = Math.max(0, (adjusted.agi || 0) - Math.abs(params.value || 0));
        adjusted.dodge = Math.max(0, (adjusted.dodge || 0) - Math.abs(params.value || 0) * 0.5);
        break;
      case 'charm':
        // 魅惑：怪物攻擊力降低 value%（混亂）
        adjusted.atk = Math.max(0, Math.round((adjusted.atk || 0) * (1 - Math.abs(params.value || 0) / 100)));
        break;
    }
  }

  return adjusted;
}

// 清理過期的 activeEffects
function cleanExpiredEffects(activeEffects = [], currentRound = 1) {
  return activeEffects.filter((effect) => {
    if (!effect || !effect.key) return false;

    const params = effect.params || {};
    const duration = params.duration || {};

    // 檢查持續時間（"turns" 模式）
    if (duration.mode === 'turns') {
      const appliedRound = effect.appliedAt || 1;
      const endRound = appliedRound + (duration.value || 1);
      if (currentRound > endRound) return false; // 效果已過期，移除
    }

    return true;
  });
}

function addOrStackCardEffect(activeEffects = [], effectEntry = {}) {
  if (!effectEntry || !effectEntry.key) return activeEffects;
  const next = Array.isArray(activeEffects) ? [...activeEffects] : [];
  const params = effectEntry.params || {};
  const stackMode = params.stackMode || effectEntry.stackMode || "refresh";
  const existingIndex = next.findIndex((entry) => {
    if (entry?.key !== effectEntry.key) return false;
    // sourceId 都有值時精確比對，避免不同技能的相同 key 互相覆蓋
    if (entry.sourceId && effectEntry.sourceId) return entry.sourceId === effectEntry.sourceId;
    return entry.source === effectEntry.source || entry.sourceType === effectEntry.sourceType;
  });

  if (existingIndex < 0 || stackMode === "stack_instance") {
    next.push(effectEntry);
    return next;
  }

  if (stackMode === "ignore") return next;

  if (stackMode === "stack_value") {
    const existing = next[existingIndex] || {};
    const existingParams = existing.params || {};
    const addValue = Number(params.stackAdd ?? params.value ?? 0);
    const baseValue = Number(existingParams.value ?? 0);
    const maxValue = Number(params.maxValue ?? params.maxPct ?? params.maxStackValue ?? NaN);
    let nextValue = baseValue + addValue;
    if (Number.isFinite(maxValue)) {
      if (nextValue >= 0) nextValue = Math.min(maxValue, nextValue);
      else nextValue = Math.max(-Math.abs(maxValue), nextValue);
    }
    next[existingIndex] = {
      ...existing,
      ...effectEntry,
      params: {
        ...existingParams,
        ...params,
        value: nextValue
      }
    };
    return next;
  }

  next[existingIndex] = effectEntry;
  return next;
}

function effectIsActive(effect, currentRound) {
  if (!effect || !effect.key) return false;
  const duration = effect.params?.duration || {};
  if (duration.mode !== "turns") return true;
  const appliedRound = effect.appliedAt || 1;
  const endRound = appliedRound + (duration.value || 1);
  return currentRound <= endRound;
}

function procEffectApplies(effect, ownerHpPct, targetHpPct) {
  if (!effect || !effect.key) return false;
  const params = effect.params || {};
  if (Number.isFinite(Number(params.ownerHpAbovePct)) && ownerHpPct <= Number(params.ownerHpAbovePct)) return false;
  if (Number.isFinite(Number(params.ownerHpBelowPct)) && ownerHpPct >= Number(params.ownerHpBelowPct)) return false;
  if (Number.isFinite(Number(params.targetHpBelowPct)) && targetHpPct >= Number(params.targetHpBelowPct)) return false;
  if (Number.isFinite(Number(params.targetHpAbovePct)) && targetHpPct <= Number(params.targetHpAbovePct)) return false;
  return true;
}

function effectHasHpThreshold(effect) {
  if (!effect || typeof effect !== "object") return false;
  const params = effect.params || {};
  return [
    "ownerHpAbovePct",
    "ownerHpBelowPct",
    "targetHpBelowPct",
    "targetHpAbovePct"
  ].some((key) => Number.isFinite(Number(params[key])));
}

const CARD_EFFECT_KEY_ALIASES = Object.freeze({
  proc_stun: "stun",
  proc_poison: "poison",
  proc_def_down: "def_down"
});

function normalizeCardProcEffect(procEffect) {
  if (!procEffect || typeof procEffect !== "object") return procEffect;
  const normalizedKey = CARD_EFFECT_KEY_ALIASES[procEffect.key] || procEffect.key;
  return normalizedKey === procEffect.key ? procEffect : { ...procEffect, key: normalizedKey };
}

const IMMEDIATE_DAMAGE_EFFECT_KEYS = new Set([
  "burn",
  "poison",
  "bleed",
  "lightning",
  "shock_dot",
  "curse_dot"
]);

const IMMEDIATE_HEAL_EFFECT_KEYS = new Set([
  "heal_over_time",
  "life_regen",
  "mana_regen",
  "on_hit_heal",
  "on_crit_heal"
]);
const IMMEDIATE_LOG_SUPPRESS_KEYS = new Set([
  ...IMMEDIATE_DAMAGE_EFFECT_KEYS,
  ...IMMEDIATE_HEAL_EFFECT_KEYS
]);

function hasMultiTurnDuration(procEffect) {
  const duration = procEffect?.duration || procEffect?.params?.duration || null;
  return duration?.mode === "turns" && Number(duration.value || 0) > 1;
}

function shouldApplyAsImmediateDamage(procEffect) {
  return IMMEDIATE_DAMAGE_EFFECT_KEYS.has(procEffect?.key) && !hasMultiTurnDuration(procEffect);
}

function shouldApplyAsImmediateHeal(procEffect) {
  return IMMEDIATE_HEAL_EFFECT_KEYS.has(procEffect?.key) && !hasMultiTurnDuration(procEffect);
}

function shouldSuppressImmediateLog(procEffect) {
  return shouldApplyAsImmediateDamage(procEffect) || shouldApplyAsImmediateHeal(procEffect);
}

// G6（V0.5 生存地基）：終局王單發拆段。
// 門檻＝25% 標準血池（Lv50 中庸配 G1 後約 1075 → 270）。
// 一刀 500 對「格擋/減傷/回復」的數學無意義（半條命直接消失）；拆成 2~3 段各自
// 獨立判定後，這些生存機制才有介入空間。只砍怪物端，玩家輸出不設任何上限。
const G6_SEG_REF = 270;
const G6_MAX_SEGS = 3;

function applyImmediateCardDamageEffect({
  procEffect,
  ownerLabel = "怪物",
  skillName = "卡片",
  skillDescription = "",
  targetLabel = "目標",
  sourceAtk = 1,
  targetMaxHp = 1,
  applyTargetDamage = null,
  mitigate = null,
  g6 = null,
  log = []
}) {
  if (!procEffect || !shouldApplyAsImmediateDamage(procEffect) || typeof applyTargetDamage !== "function") {
    return false;
  }

  const params = procEffect.params || {};
  const labelMap = {
    burn: "灼燒",
    poison: "毒素",
    bleed: "流血",
    lightning: "雷電",
    shock_dot: "震盪",
    curse_dot: "詛咒"
  };
  const damageLabel = labelMap[procEffect.key] || "傷害";
  const base = params.mode === "caster_atk_pct"
    ? Math.max(1, Number(params.casterAtk || sourceAtk || 1))
    : targetMaxHp;
  const pct = Number.isFinite(Number(params.value))
    ? Math.abs(Number(params.value))
    : (
      procEffect.key === "lightning" ? 0.2 :
      procEffect.key === "bleed" ? 0.1 :
      0.5
    );
  const rawDamage = params.mode === "flat"
    ? Math.max(1, Math.round(Number.isFinite(Number(params.value)) ? Number(params.value) : 1))
    : Math.max(1, Math.round(base * (pct / 100)));
  // G6（V0.5 生存地基）：怪物技能巨額單發拆段——技能核彈原本無格擋無迴避一口氣落下
  // （古龍王逆鱗焚天 200% ATK ≈ 540＝半條命），拆段後各段獨立格擋（同 BOSS 格擋規則：
  // 擋住卸去 70%）、各段獨立吃 flatDef → 格擋/重甲的數學對技能傷害也成立。
  // 只有「怪物→玩家」的呼叫端會傳 g6；玩家打怪的即時傷害不拆（拉底不壓頂）。
  if (g6 && rawDamage > (Number(g6.threshold) || 0)) {
    const segs = Math.min(Number(g6.maxSegs) || 3, Math.max(2, Math.ceil(rawDamage / (Number(g6.threshold) || 1))));
    let total = 0, blockedSegs = 0;
    let remainingHp = null;
    for (let i = 0; i < segs; i++) {
      let part = Math.max(1, Math.round(rawDamage / segs));
      if (typeof mitigate === "function") part = Math.max(1, Math.round(mitigate(part)));
      if (Number(g6.blockChance) > 0 && Math.random() * 100 < Number(g6.blockChance)) {
        part = Math.max(1, Math.round(part * 0.3));
        blockedSegs++;
      }
      const applied = applyTargetDamage(part);
      remainingHp = applied && typeof applied === "object" ? applied.remainingHp : applied;
      total += applied && typeof applied === "object" && Number.isFinite(Number(applied.actualDamage))
        ? Math.max(0, Number(applied.actualDamage))
        : part;
    }
    const blockNote = blockedSegs > 0 ? `，🛡️ 其中 **${blockedSegs} 段**被格擋卸去 70%` : "";
    const remainText = remainingHp != null && Number.isFinite(Number(remainingHp))
      ? `（${targetLabel} 剩 ${Math.max(0, Math.round(Number(remainingHp)))} HP）`
      : "";
    log.push(`🎴 **${ownerLabel}** 發動【${skillName}】！${skillDescription || ""} 威能拆成 **${segs} 段**襲來${blockNote}，共對 **${targetLabel}** 造成 **${total}** 點${damageLabel}傷害！${remainText}`);
    return true;
  }
  // 即時技能傷害也走目標防禦減免(由呼叫端提供 mitigate,例如 applyDefense)
  const damage = typeof mitigate === "function" ? Math.max(1, Math.round(mitigate(rawDamage))) : rawDamage;
  const applied = applyTargetDamage(damage);
  const remainingHp = applied && typeof applied === "object" ? applied.remainingHp : applied;
  const actualDamage = applied && typeof applied === "object" && Number.isFinite(Number(applied.actualDamage))
    ? Math.max(0, Number(applied.actualDamage))
    : damage;
  const remainText = remainingHp != null && Number.isFinite(Number(remainingHp))
    ? `（${targetLabel} 剩 ${Math.max(0, Math.round(Number(remainingHp)))} HP）`
    : "";
  log.push(`🎴 **${ownerLabel}** 發動【${skillName}】！${skillDescription || ""} 對 **${targetLabel}** 造成 **${actualDamage}** 點${damageLabel}傷害！${remainText}`);
  return true;
}

function applyImmediateCardHealEffect({
  procEffect,
  ownerLabel = "怪物",
  skillName = "卡片",
  skillDescription = "",
  targetLabel = "自己",
  sourceAtk = 1,
  targetMaxHp = 1,
  applyTargetHeal = null,
  log = []
}) {
  if (!procEffect || !shouldApplyAsImmediateHeal(procEffect) || typeof applyTargetHeal !== "function") {
    return false;
  }

  const params = procEffect.params || {};
  const healLabelMap = {
    heal_over_time: "回復",
    life_regen: "回復",
    mana_regen: "回復",
    on_hit_heal: "治癒",
    on_crit_heal: "治癒"
  };
  const healLabel = healLabelMap[procEffect.key] || "回復";
  const base = params.mode === "caster_atk_pct"
    ? Math.max(1, Number(params.casterAtk || sourceAtk || 1))
    : targetMaxHp;
  const pct = Number.isFinite(Number(params.value))
    ? Math.abs(Number(params.value))
    : 5;
  const heal = params.mode === "flat"
    ? Math.max(1, Math.round(Number.isFinite(Number(params.value)) ? Number(params.value) : 1))
    : Math.max(1, Math.round(base * (pct / 100)));
  const applied = applyTargetHeal(heal);
  const remainingHp = applied && typeof applied === "object" ? applied.remainingHp : applied;
  const actualHeal = applied && typeof applied === "object" && Number.isFinite(Number(applied.actualHeal))
    ? Math.max(0, Number(applied.actualHeal))
    : heal;
  const remainText = Number.isFinite(Number(remainingHp)) ? `（${targetLabel} 剩 ${Math.max(0, Math.round(Number(remainingHp)))} HP）` : "";
  log.push(`🎴 **${ownerLabel}** 發動【${skillName}】！${skillDescription || ""} 回復 **${actualHeal}** HP！${remainText}`);
  return true;
}

function hasAnyDebuff(activeEffects = [], currentRound = 1) {
  const debuffKeys = new Set([
    "atk_down", "def_down", "hit_down", "hit_rate_down", "dodge_down",
    "poison", "burn", "bleed", "shock_dot", "curse_dot",
    "stun", "freeze", "silence", "slow", "blind", "charm", "dark_curse"
  ]);
  return (activeEffects || []).some((effect) => effectIsActive(effect, currentRound) && debuffKeys.has(effect.key));
}

function hasEquippedNames(equipped = {}, requiredNames = []) {
  if (!Array.isArray(requiredNames) || requiredNames.length === 0) return false;
  const equippedNames = new Set();
  for (const item of Object.values(equipped || {})) {
    if (!item || typeof item !== "object") continue;
    for (const value of [item.name, item.itemName, item.id, item.itemId]) {
      if (value) equippedNames.add(String(value));
    }
  }
  return requiredNames.every((name) => equippedNames.has(String(name)));
}

function hasAnyEquippedName(equipped = {}, names = []) {
  if (!Array.isArray(names) || names.length === 0) return false;
  const equippedNames = new Set();
  for (const item of Object.values(equipped || {})) {
    if (!item || typeof item !== "object") continue;
    for (const value of [item.name, item.itemName, item.id, item.itemId]) {
      if (value) equippedNames.add(String(value));
    }
  }
  return names.some((name) => equippedNames.has(String(name)));
}

function makeCardEffectEntry(procEffect, round, sourceType, overrides = {}, sourceId = null) {
  const params = { ...(procEffect.params || {}) };
  if (Object.prototype.hasOwnProperty.call(overrides, "value")) params.value = overrides.value;
  const duration = procEffect.duration || params.duration;
  if (duration && !params.duration) params.duration = duration;
  if (Object.prototype.hasOwnProperty.call(overrides, "sourceName")) params.sourceName = overrides.sourceName;
  return {
    key: procEffect.key,
    params,
    stackMode: procEffect.stackMode,
    appliedAt: round,
    source: sourceType,
    sourceType,
    sourceId: sourceId ? String(sourceId) : null
  };
}

function applyCardProcEffects({
  procEffects = [],
  ownerHpPct = 100,
  targetHpPct = 100,
  round = 1,
  sourceType = "monster_skill",
  cardName = "卡片",
  skillName = "",
  skillDescription = "",
  cooldownBucket = null,
  cooldownKey = null,
  cooldownTurns = 0,
  ownerActiveEffects = [],
  targetActiveEffects = [],
  ownerEquipped = {},
  ownerLabel = "怪物",
  sourceAtk = 1,
  ownerMaxHp = 1,
  targetMaxHp = 1,
  applyTargetDamage = null,
  applyOwnerHeal = null,
  targetLabel = "目標",
  buffKeys = new Set(),
  debuffKeys = new Set(),
  sourceId = null,
  triggerChance = 100,
  applySpecialEffect = null,
  deferOwnerEffects = false,
  // 本函式原本只負責「帶血量門檻」的效果(on_hit 路徑會先把效果拆兩堆,一般效果走別的分支)。
  // on_dodge 路徑沒有那個分支、把全部效果丟進來 → 沒帶血量條件的效果被這裡靜默丟棄
  //   (魅影潛襲者卡【暗影急襲】crit_rate_up 因此完全不生效,實測 60 場 0 觸發)。
  // 加這個開關讓 on_dodge 能把一般效果也交給本函式處理；預設 true 保持既有呼叫端行為不變。
  requireHpGate = true,
  log = []
}) {
  let nextOwnerActiveEffects = Array.isArray(ownerActiveEffects) ? ownerActiveEffects : [];
  let nextTargetActiveEffects = Array.isArray(targetActiveEffects) ? targetActiveEffects : [];
  const hpGatedEffects = requireHpGate ? procEffects.filter(effectHasHpThreshold) : procEffects;
  if (hpGatedEffects.length === 0) {
    return {
      ownerActiveEffects: nextOwnerActiveEffects,
      targetActiveEffects: nextTargetActiveEffects,
      applied: false,
      appliedHpGatedOnly: false
    };
  }

  const currentCooldown = cooldownBucket && cooldownKey != null ? Number(cooldownBucket[cooldownKey] || 0) : 0;
  if (currentCooldown > 0) {
    return {
      ownerActiveEffects: nextOwnerActiveEffects,
      targetActiveEffects: nextTargetActiveEffects,
      applied: false,
      appliedHpGatedOnly: true
    };
  }

  const matchedEffects = hpGatedEffects.filter((procEffect) => procEffectApplies(procEffect, ownerHpPct, targetHpPct));
  if (matchedEffects.length === 0) {
    return {
      ownerActiveEffects: nextOwnerActiveEffects,
      targetActiveEffects: nextTargetActiveEffects,
      applied: false,
      appliedHpGatedOnly: true
    };
  }

  const normalizedTriggerChance = Math.min(100, Math.max(0, Number(triggerChance) || 0));
  if (Math.random() * 100 >= normalizedTriggerChance) {
    return {
      ownerActiveEffects: nextOwnerActiveEffects,
      targetActiveEffects: nextTargetActiveEffects,
      applied: false,
      appliedHpGatedOnly: true
    };
  }

  let appliedAny = false;
  let loggedImmediate = false;
  for (const rawProcEffect of matchedEffects) {
    if (!rawProcEffect || !rawProcEffect.key) continue;
    const procChance = Number.isFinite(Number(rawProcEffect.chance))
      ? Math.min(100, Math.max(0, Number(rawProcEffect.chance)))
      : 100;
    if (Math.random() * 100 >= procChance) continue;
    const procEffect = normalizeCardProcEffect(rawProcEffect);

    if (typeof applySpecialEffect === "function" && applySpecialEffect(procEffect) === true) {
      appliedAny = true;
      continue;
    }

    if (applyImmediateCardHealEffect({
      procEffect,
      ownerLabel,
      skillName: skillName || cardName,
      skillDescription,
      targetLabel: ownerLabel,
      sourceAtk,
      targetMaxHp: ownerMaxHp,
      applyTargetHeal: applyOwnerHeal,
      log,
    })) {
      appliedAny = true;
      loggedImmediate = true;
      continue;
    }

    const effectEntry = makeCardEffectEntry(
      procEffect,
      round,
      sourceType,
      {},
      sourceId
    );

    if (applyImmediateCardDamageEffect({
      procEffect,
      ownerLabel,
      skillName: skillName || cardName,
      skillDescription,
      targetLabel,
      sourceAtk,
      targetMaxHp,
      applyTargetDamage,
      log,
    })) {
      appliedAny = true;
      loggedImmediate = true;
      continue;
    }

    if (procEffect.target === 'self' || buffKeys.has(procEffect.key)) {
      if (sourceType === 'player_card' && !deferOwnerEffects) effectEntry.appliedAt = round - 1;
      nextOwnerActiveEffects = addOrStackCardEffect(nextOwnerActiveEffects, effectEntry);
      appliedAny = true;
    } else if (procEffect.target === 'enemy' || debuffKeys.has(procEffect.key)) {
      if (sourceType === 'monster_skill') effectEntry.appliedAt = round - 1;
      nextTargetActiveEffects = addOrStackCardEffect(nextTargetActiveEffects, effectEntry);
      appliedAny = true;
    }
  }

  if (appliedAny && Number(cooldownTurns) > 0 && cooldownBucket && cooldownKey != null) {
    cooldownBucket[cooldownKey] = Number(cooldownTurns);
  }

  if (appliedAny && !loggedImmediate) {
    log.push(`🎴 **${ownerLabel}** 發動【${skillName || cardName}】！${skillDescription || ""}`);
  }

  return {
    ownerActiveEffects: nextOwnerActiveEffects,
    targetActiveEffects: nextTargetActiveEffects,
    applied: appliedAny,
    appliedHpGatedOnly: true
  };
}

function upsertActiveEffectBySource(activeEffects = [], effectEntry = {}) {
  if (!effectEntry || !effectEntry.key) return Array.isArray(activeEffects) ? activeEffects : [];
  const next = Array.isArray(activeEffects) ? [...activeEffects] : [];
  const sameSource = (entry) => {
    if (!entry || entry.key !== effectEntry.key) return false;

    const effectSourceId = effectEntry.sourceId ?? null;
    const entrySourceId = entry.sourceId ?? null;
    if (effectSourceId !== null && entrySourceId !== null) {
      return String(effectSourceId ?? "") === String(entrySourceId ?? "");
    }

    const effectSourceType = effectEntry.sourceType ?? null;
    const entrySourceType = entry.sourceType ?? null;
    if (effectSourceType !== null && entrySourceType !== null) {
      return String(effectSourceType ?? "") === String(entrySourceType ?? "");
    }

    return String(effectEntry.source || "") === String(entry.source || "");
  };

  const existingIndex = next.findIndex(sameSource);
  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], ...effectEntry };
    return next;
  }
  next.push(effectEntry);
  return next;
}

function runCombatLoop(pStats, mCalc, mName, mHpInit, MAX_ROUNDS = 15, options = {}) {
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const playerBattleName = options.playerName || "你";

  // ── 等級壓制（非對稱）─────────────────────────────────────────────
  //   每差 1 級 ±LEVEL_DIFF_PCT%
  //   高打低：+0% ~ +CAP_UP%（最高 120%）
  //   低打高：-0% ~ -CAP_DOWN%（最低 50%）
  const LEVEL_DIFF_PCT = 2;
  const LEVEL_DIFF_CAP_UP = 20;
  // G5（V0.5 生存地基）：怪打玩家方向的等級壓制上限單獨壓到 +10%
  // （終局怪全都比玩家高 10 級以上＝全額吃滿；玩家打低級怪的 +20% 不動）
  const LEVEL_DIFF_CAP_UP_MONSTER = 10;
  const LEVEL_DIFF_CAP_DOWN = 50;
  const calcLevelMult = (atkLv, dstLv, capUp = LEVEL_DIFF_CAP_UP) => {
    const diff = Math.max(1, atkLv || 1) - Math.max(1, dstLv || 1);
    if (diff >= 0) return 1 + Math.min(capUp, diff * LEVEL_DIFF_PCT) / 100;
    return 1 - Math.min(LEVEL_DIFF_CAP_DOWN, -diff * LEVEL_DIFF_PCT) / 100;
  };
  const playerLevel = Math.max(1, Number(options.playerLevel || pStats.level || 1));
  const monsterLevel = Math.max(1, Number(mCalc?.level || options.monsterLevel || 1));
  const playerAttackLevelMult = calcLevelMult(playerLevel, monsterLevel);
  const monsterAttackLevelMult = calcLevelMult(monsterLevel, playerLevel, LEVEL_DIFF_CAP_UP_MONSTER); // G5

  // 🐺 狼王・連牙亂舞：連段卡技 → 每段傷害 90%（開戰前一次縮放 atk，段數由下方連段控制）
  const _hellfangCombo = options.monsterEquipped?.special_1?.monsterCardSkill?.key === "hellfang_combo";
  if (_hellfangCombo && mCalc && Number(mCalc.atk) > 0) {
    mCalc = { ...mCalc, atk: Math.max(1, Math.round(Number(mCalc.atk) * 0.9)) };
  }

  // 傷害浮動：min~1.3，INT 縮小下限
  const rollDmg = (base) => {
    const roll = pStats.dmgMin + Math.random() * (pStats.dmgMax - pStats.dmgMin);
    return Math.max(1, Math.round(base * roll));
  };
  // 怪物攻擊浮動：與玩家對齊，0.7~1.0；怪 INT 每點 +0.01 抬高下限
  // G4（V0.5 生存地基）：INT 抬浮動下限 cap 1.0 → 0.85——
  // 終局怪 INT 70+ 原本把下限頂滿＝每刀都是理論最大值，玩家零波動保命空間
  const mDmgMin = (typeof mCalc?.dmgMin === 'number')
    ? mCalc.dmgMin
    : Math.min(0.85, 0.7 + Math.max(0, Number(mCalc?.int) || 0) * 0.01);
  const mDmgMax = (typeof mCalc?.dmgMax === 'number') ? mCalc.dmgMax : 1.0;
  const rollMDmg = (base) => Math.max(1, Math.round(base * (mDmgMin + Math.random() * Math.max(0, mDmgMax - mDmgMin))));

  // ── 新傷害計算（加減算式 + 等級壓制） ──
  // 玩家 → 怪物（攻擊端是玩家）：
  //   max(1, (atk × playerAttackLevelMult − monsterFlatDef) × (1 − monsterPctDef/100))
  // 怪物 → 玩家（攻擊端是怪物）：
  //   max(1, (matk × monsterAttackLevelMult − playerFlatDef) × (1 − playerPctDef/100))
  // flatDef 用「攻擊者方向」的版本（玩家身上的 flatDef 在怪打玩家時生效）
  // 新公式 B：flatDef 在 ATK 階段壓制，等同被攻擊乘數放大
  // (atk × M − flatDef × M) × (1 − DEF%) = ((atk − flatDef) × M) × (1 − DEF%)
  const applyDefense = (rawDmg, flatDef, pctDef, rawAtk = null) => {
    let effectiveFlatDef = Math.max(0, flatDef || 0);
    if (rawAtk && rawAtk > 0 && rawDmg > rawAtk) {
      effectiveFlatDef *= (rawDmg / rawAtk);
    }
    const afterFlat = Math.max(0, rawDmg - effectiveFlatDef);
    const finalPct = Math.max(0, Math.min(95, pctDef || 0));
    return Math.max(1, Math.round(afterFlat * (1 - finalPct / 100)));
  };

  // 攻擊描述詞
  const wt = pStats.weaponType;
  const jobProfile = detectJobBattleProfile(options.equipped || {}, options.inventory || []);
  const jobFlavor = getJobFlavor(jobProfile, pStats);
  const atkVerbs = jobFlavor.atkVerbs || pickWeaponPhrases(wt);
  const critPhrases = CRIT_PHRASES;
  const comboPhrases = COMBO_PHRASES;
  const dodgePhrases = DODGE_PHRASES;
  const mDodgePhrases = MONSTER_DODGE_PHRASES;
  const mAtkPhrases = MONSTER_ATK_PHRASES;
  const blockPhrases = BLOCK_PHRASES;
  const stunPhrases = STUN_PHRASES;
  const agiFirstStrikePhrases = AGI_FIRST_STRIKE_PHRASES;
  const agiSlowedAttackPhrases = AGI_SLOWED_ATTACK_PHRASES;

  // 世界王分階段技能（僅在 options.worldBossPhase 存在時啟用）
  const worldBossPhaseNo = Math.max(0, Math.floor(Number(options?.worldBossPhase?.phase || 0)));
  const worldBossHasLightning = worldBossPhaseNo >= 2;
  const worldBossHasAgiSuppress = worldBossPhaseNo >= 3;
  const worldBossLightningHitChance = Math.max(0, Math.min(100, Number(options?.worldBossPhase?.lightningHitChance ?? 20)));
  const worldBossLightningHpPct = Math.max(0, Number(options?.worldBossPhase?.lightningDamagePct ?? 25));
  const worldBossAgiBonus = worldBossHasAgiSuppress
    ? Math.max(0, Math.floor(Number(options?.worldBossPhase?.agiBonus ?? 0)))
    : 0;
  let worldBossAgiAnnounced = false;

  // ── AGI 優勢判定 ──
  const playerAgi = pStats.agi || 1;
  const monsterAgi = (mCalc.agi || 1) + worldBossAgiBonus;
  const agiDiff = playerAgi - monsterAgi;
  const hasAgiFirstStrike = agiDiff > 2;   // 第1回合玩家先手，怪物無法反擊
  const hasAgiSlowedMonster = agiDiff > 5; // 怪物只在偶數回合反擊
  const bossAgiDiff = monsterAgi - playerAgi;
  const hasBossAgiFirstStrike = worldBossHasAgiSuppress && bossAgiDiff > 2;   // 第1回合怪物壓制，玩家無法行動
  const hasBossAgiTurnSuppress = worldBossHasAgiSuppress && bossAgiDiff > 5;  // 玩家奇數回合被壓制

  // options.startMonsterHp：攻塔多人輪流時，從上一位打完的殘血繼續
  let mHp = (options.startMonsterHp != null)
    ? Math.max(0, Math.min(mHpInit, Number(options.startMonsterHp) || 0))
    : mHpInit;
  let pHp = options.startPlayerHp != null
    ? Math.max(0, Math.min(pStats.maxHp, Number(options.startPlayerHp) || 0))
    : pStats.maxHp;
  // 隊伍光環 party_max_hp_up（如錨點「共鳴之鏈」）：戰鬥開始一次性提高本人 MaxHP 與當前 HP（不逐回合疊加）
  try {
    const _pmh = (Array.isArray(options.partyEffects) ? options.partyEffects : [])
      .filter((pe) => pe && pe.key === "party_max_hp_up")
      .reduce((mx, pe) => Math.max(mx, Number(pe.params?.value ?? pe.value ?? 0) || 0), 0);
    if (_pmh > 0 && pStats.maxHp > 0) {
      const _mult = 1 + _pmh / 100;
      pStats.maxHp = Math.round(pStats.maxHp * _mult);
      pHp = Math.round(pHp * _mult);
    }
  } catch (_) { /* noop */ }
  // ── build 錨點共用：承傷累積 / 回血攔截。預設路徑＝與原本完全相同，未裝這些錨點者不受任何影響。──
  let _totalDmgTaken = 0;   // 沒苦硬吃：累積承受總傷害
  let _endureBurst = null;  // 沒苦硬吃：{ everyRounds, mult }——每 N 回合反彈一次期間累積承傷
  let _endureTakenSinceBurst = 0;  // 上次反彈之後累積的承受傷害
  let _healToDamage = 0;    // 聖人比拳頭：回血→對敵傷害倍率(0=關)
  // 回血化刃不是固定真傷：名目治療轉成原始傷害後，仍須套用目標當回合的
  // flat DEF、DEF%、減傷、易傷與單次承傷上限。光環在回合前段結算，因此沿用
  // 上一回合的隊伍扣防／穿防快照（與玩家 DOT 相同）；本回合效果解析完後會刷新。
  let _healDamageTargetStats = mCalc || {};
  let _healDamageDefDownPct = 0;
  let _healDamageDefIgnorePct = Math.max(0, Number(pStats.bypassMonsterDefPct) || 0);
  const _mitigateHealDamage = (rawDamage) => {
    const target = _healDamageTargetStats || mCalc || {};
    const effectiveDef = Math.max(0, Number(target.def) || 0)
      * (1 - Math.min(95, Math.max(0, _healDamageDefDownPct)) / 100)
      * (1 - Math.min(100, Math.max(0, _healDamageDefIgnorePct)) / 100);
    // 回血化刃：治療量 × 錨點倍率形成原始傷害，正常吃一次怪物防禦後，最終傷害減半。
    // 原始傷害不以 ATK 為基底，因此 flat DEF 不再按 ATK 比例額外放大。
    let damage = applyDefense(rawDamage, target.flatDef || 0, effectiveDef, rawDamage);
    damage = Math.max(1, Math.round(damage / 2));
    if (Number(target.damageReductionPct) > 0) {
      damage = Math.max(1, Math.round(damage * (1 - Math.min(95, Number(target.damageReductionPct)) / 100)));
    }
    if (Number(target.damageTakenMultiplier) > 0 && Number(target.damageTakenMultiplier) !== 1) {
      damage = Math.max(1, Math.round(damage * Number(target.damageTakenMultiplier)));
    }
    if (Number(target.incomingDamageCap) > 0 && damage > Number(target.incomingDamageCap)) {
      damage = Number(target.incomingDamageCap);
    }
    // 終傷層倍率（世界王部位弱點／屬性相剋／演奏加成／龜王詠唱等）：回血化刃是玩家輸出，
    // 必須與主擊吃同一層，否則詠唱減傷等機制對它完全無效（2026-08-12 線上回報）。
    // applyBossVuln 宣告在後面，但本函式只在回合迴圈內被呼叫，屆時已完成初始化。
    damage = applyBossVuln(damage);
    return Math.max(1, Math.round(damage));
  };
  let _healImmune = false;  // 對鮮血的渴望：無法被治療(自身吸血除外)
  let _extendRounds = 0;    // 時間管理大師：回合上限改為此值(0=不變)
  let _noPlayerAtk = options.skipPlayerAttack === true; // 外部回合軸可只結算怪物行動；沒苦硬吃也會沿用此旗標
  let _totalHealDone = 0, _totalLifestealDone = 0; // 任務指標：實際治療／實際吸血（滿血溢補不算）
  // ── 聖域師（結界師二轉）────────────────────────────────────────────
  // 符文結界：開場展開，厚度＝maxHp×basePct% + INT×perInt；所有受傷先扣結界（_hurt 內）。
  // 吸收累積 → 共鳴反爆（回合尾三時機引爆，見回合結尾區塊）。
  // 聖域窗口（區域聖域值滿）：options.sanctuaryCutPct/sanctuaryHealPct——任何職業都吃得到。
  let sanctumCfg = null;
  try { sanctumCfg = require("./jobAdvancement").getSanctum(options.equipped?.job_eq); } catch (_) { sanctumCfg = null; }
  const _sanctumMax = sanctumCfg
    ? Math.max(1, Math.round(
      (pStats.maxHp || 1) * (Number(sanctumCfg.barrierBasePct) || 25) / 100
      + Math.max(0, Number(pStats.int) || 0) * (Number(sanctumCfg.barrierPerInt) || 25)
    ))
    : 0;
  let _sanctumBarrier = _sanctumMax;
  let _sanctumAcc = 0;          // 本場吸收累積（反爆基數）
  let _sanctumRoundAbsorb = 0;  // 本回合吸收（戰報行用）
  let _sanctumBroke = false;    // 結界剛被打爆 → 回合尾破碎引爆
  let _sanctumDetonated = false;
  const _sanctuaryCutPct = Math.max(0, Math.min(90, Number(options.sanctuaryCutPct) || 0));
  const _sanctuaryHealPct = Math.max(0, Math.min(50, Number(options.sanctuaryHealPct) || 0));

  // ── 龜甲庇護（島島龜王卡・兩段式）────────────────────────────────
  // 殼在：受傷 −drPct%＋先扣殼；殼破：破殼而出，剩餘戰鬥傷害 +breakDmgPct%（使用者定案 2026-07-29）
  let _tshellCfg = null;      // 由裝備效果 key "turtle_shell" 註冊（見效果註冊迴圈）
  let _tshellMax = 0, _tshellHp = 0;
  let _tshellBroken = false;      // 破殼＝傷害加成開啟（打到就生效）
  let _tshellBrokeThisRound = false; // 回合尾宣告用
  let _turtleSetTideCfg = null;   // 龜王套裝 4 件：漲潮／退潮每 2 回合輪替

  // ── 賭神（賭徒二轉）────────────────────────────────────────────────
  // 命運骰：6 格（有攻擊的回合 +1），滿的那回合改丟 3 顆——第三顆骰出 N ＝ 當回合 N 連擊；
  // 手氣正旺：兩顆傷害骰平均 >3 → +1 層（每層 +2%）、<3 → 歸零、=3 → 維持；跨場由呼叫端持久化。
  let diceGodCfg = null;
  try { diceGodCfg = require("./jobAdvancement").getDiceGod(options.equipped?.job_eq); } catch (_) { diceGodCfg = null; }
  const _diceGaugeMax = diceGodCfg ? Math.max(1, Number(diceGodCfg.gaugeMax) || 6) : 6;
  const _diceLuckCap = diceGodCfg ? Math.max(1, Number(diceGodCfg.luckMaxStacks) || 25) : 25;
  const _diceLuckPct = diceGodCfg ? Math.max(0, Number(diceGodCfg.luckPerStackPct) || 2) : 2;
  let _diceGrids = diceGodCfg ? Math.max(0, Math.min(_diceGaugeMax, Math.floor(Number(options.diceGaugeGrids) || 0))) : 0;
  let _diceLuck = diceGodCfg ? Math.max(0, Math.min(_diceLuckCap, Math.floor(Number(options.diceLuckStacks) || 0))) : 0;
  const _hurt = (d) => {
    let x = Math.max(0, Number(d) || 0);
    // 聖域護佑：受傷減免（先減再給結界吃，兩者可疊）
    if (_sanctuaryCutPct > 0 && x > 0) x = Math.max(0, Math.round(x * (1 - _sanctuaryCutPct / 100)));
    // 龜甲庇護（最外層的殼）：殼在＝受傷減免＋先扣殼；殼破＝開啟破殼而出
    if (_tshellCfg && _tshellHp > 0 && x > 0) {
      x = Math.max(0, Math.round(x * (1 - _tshellCfg.drPct / 100)));
      const eat = Math.min(_tshellHp, x);
      _tshellHp -= eat;
      x -= eat;
      if (_tshellHp <= 0) { _tshellBroken = true; _tshellBrokeThisRound = true; }
    }
    // 符文結界：先扣結界再扣血；吸收量累積成反爆基數
    if (_sanctumBarrier > 0 && x > 0) {
      const eat = Math.min(_sanctumBarrier, x);
      _sanctumBarrier -= eat;
      _sanctumAcc += eat;
      _sanctumRoundAbsorb += eat;
      if (_sanctumBarrier <= 0) _sanctumBroke = true;
      x -= eat;
    }
    pHp = pHp - x;
    _totalDmgTaken += x;
    _endureTakenSinceBurst += x;   // 沒苦硬吃：累積到下次反彈
    // 最大單發承傷（爆發條件「單發 ≤ 40% maxHp」的量測欄；含自傷成本，量測時自行留意）
    if (x > _maxHitTaken) _maxHitTaken = x;
    // KDA 影子血量：假設沒有「外部治療」的血量軌跡（救命加成用，見附錄C 第四節）
    if (_shadowHp != null) {
      _shadowHp -= x;
      if (_shadowHp <= 0 && _shadowDeadRound == null) _shadowDeadRound = _curRound;
    }
    return x;
  };
  let _maxHitTaken = 0;

  // ── KDA・A 值歸戶（附錄C v3 定案）────────────────────────────────
  // 他人光環對本場的傷害當量：增傷類＝結算時 總傷害×v/(100+v)；治療＝有效量×1.0＋救命加成；
  // 減傷＝實際擋下量。不可自益（isSelfAura===false 才計）；同 key 呼叫端已取最高＝來源唯一。
  const _kdaHealBySource = new Map();      // sourceDiscordId → 有效治療量
  const _kdaPreventedBySource = new Map(); // sourceDiscordId → 減傷光環實際擋下量
  let _kdaDrSourceId = null;               // party_damage_reduction 提供者
  let _kdaCritDrSourceId = null;           // party_crit_damage_reduction 提供者
  let _shadowHp = null;                    // 進入回合迴圈前初始化＝pHp
  let _shadowDeadRound = null;
  let _kdaStunSkippedRounds = 0;           // 團隊暈眩（巨神震擊/冰封）擋下的敵方回合數
  let _curRound = 1;

  // ── 日之精靈（聖靈師二轉）────────────────────────────────────────────
  // 代承怪物攻勢；精靈只有與主人相同的 maxHp，不套用主人的 DEF、閃避、格擋、
  // 減傷、護盾、抗性或免傷。跨場沿用由呼叫端持久化（options.sunSpiritHpPct 進、result.sunSpirit 出）。
  let sunSpiritCfg = null;
  try { sunSpiritCfg = require("./jobAdvancement").getSunSpirit(options.equipped?.job_eq); } catch (_) { sunSpiritCfg = null; }
  const _spiritMaxHp = sunSpiritCfg ? Math.max(1, Math.round(pStats.maxHp || 1)) : 0;
  let _spiritHp = sunSpiritCfg
    ? Math.max(0, Math.min(_spiritMaxHp, Math.round(_spiritMaxHp * Math.max(0, Math.min(100, Number(options.sunSpiritHpPct ?? 100))) / 100)))
    : 0;
  const _spiritAbsorb = (d) => {
    if (!sunSpiritCfg || _spiritHp <= 0) return false;
    _spiritHp = Math.max(0, _spiritHp - Math.max(0, Number(d) || 0));
    return true;
  };

  // ── 神射手（弓箭手二轉）────────────────────────────────────────────
  // 神速反擊：這回合對手沒打到你（揮空/被閃/來不及出手/被暈眩/被冰封）→ 多一箭；
  // 震盪值：4 格、每個有攻擊的回合 +1，滿 4 → 立刻震盪射擊＋下回合對手構不到你。
  let sniperCfg = null;
  try { sniperCfg = require("./jobAdvancement").getSniper(options.equipped?.job_eq); } catch (_) { sniperCfg = null; }
  let _sniperGrids = sniperCfg
    ? Math.max(0, Math.min(4, Math.floor(Number(options.sniperGaugeGrids) || 0)))
    : 0;
  let _monsterKnockbackRound = 0;

  // ── 兵聖（軍師二轉）────────────────────────────────────────────────
  // 計謀值 3 格（有攻擊的回合 +1），滿 → 隨機施展一計；狀態旗標由各計設定。
  let sageCfg = null;
  try { sageCfg = require("./jobAdvancement").getSage(options.equipped?.job_eq); } catch (_) { sageCfg = null; }
  let _sageGrids = sageCfg
    ? Math.max(0, Math.min(3, Math.floor(Number(options.sageGaugeGrids) || 0)))
    : 0;
  // 盜靈（盜賊二轉 B）：巧手＝大成功倍率覆寫；得手＝大成功以上判定盜取。
  // 設定表在 jobAdvancement.T2_BRANCHES.rogue[1]，沒有徽章 → null → 完全走現況。
  // ⚠️ 每隻怪只能偷一次：呼叫端傳 options.stealUsed（該玩家對「這隻怪」是否已偷過），
  //    戰鬥內偷成功時把 combatStats.stealTriggered 設 true，由呼叫端負責發物品與落地狀態。
  let spiritThiefCfg = null;
  try { spiritThiefCfg = require("./jobAdvancement").getSpiritThief(options.equipped?.job_eq); } catch (_) { spiritThiefCfg = null; }
  let _stealUsed = options.stealUsed === true;

  let _sageMistRound = 0;    // 瞞天過海：這回合怪必打空、你必中
  let _sageChainRound = 0;   // 連環之計：這回合固定 3 連擊
  let _sageAllInFrom = 0;    // 破釜沉舟：區間內傷害×mult、受傷×takenMult、不可閃避格擋
  let _sageAllInUntil = 0;
  // 追加打擊的基準：最近一次主擊的「未爆擊基底」（含武器/徽章/最終傷害等整條倍率鏈）。
  // 沒有這個基準時（開場還沒出手）退回裸 ATK 管線——修正前追加箭少乘半條鏈、只有真擊一半威力。
  let _lastMainBase = 0;
  // 防具同屬抗性。必須在「算完傷害、印進戰報之前」就套用，不能藏在 _hurt 裡——
  //    各處都是 log.push(`造成 ${dmg} 點傷害`) 搭配 _hurt(dmg)，
  //    若在 _hurt 內偷偷打折，戰報數字會與實際扣血不符（＝騙人的戰報）。
  const _applyElementDR = (raw) => {
    const x = Math.max(0, Number(raw) || 0);
    if (x <= 0) return x;
    const mult = sameElementResist.mult;
    if (mult === 1) return x;
    return Math.max(1, Math.round(x * mult));
  };
  const _takePlayerIncomingDamage = (raw, currentRound, { damageType = "magic", useSpirit = true } = {}) => {
    let damage = Math.max(0, Math.round(Number(raw) || 0));
    if (damage <= 0) return 0;
    if (useSpirit && _spiritHp > 0) {
      _spiritAbsorb(damage);
      return damage;
    }

    const active = (options.playerActiveEffects || []).filter((effect) => effectIsActive(effect, currentRound));
    if (active.some((effect) => effect?.key === "invincible_short")) return 0;

    let reductionPct = 0;
    for (const effect of active) {
      const value = Math.abs(Number(effect?.params?.value) || 0);
      if (effect?.key === "damage_reduction") reductionPct += value;
      if (damageType === "physical" && effect?.key === "physical_damage_reduction") reductionPct += value;
      if (damageType === "magic" && effect?.key === "magic_damage_reduction") reductionPct += value;
    }
    if (reductionPct > 0) {
      damage = Math.max(1, Math.round(damage * (1 - Math.min(95, reductionPct) / 100)));
    }

    for (const effect of active) {
      if (!effect || !["shield", "barrier"].includes(effect.key) || damage <= 0) continue;
      const params = effect.params || {};
      const amount = Math.max(0, Number(params.amount ?? params.value ?? 0));
      if (amount <= 0) continue;
      const absorbed = Math.min(amount, damage);
      params.amount = amount - absorbed;
      params.value = params.amount;
      effect.params = params;
      damage -= absorbed;
    }

    if (!deathPreventUsed && pHp - damage <= 0 && active.some((effect) => effect?.key === "death_prevent_once")) {
      damage = Math.max(0, pHp - 1);
      deathPreventUsed = true;
    }
    return _hurt(damage);
  };
  const _healPlayer = (h, opts) => {
    const amt = Math.max(0, Number(h) || 0);
    if (amt <= 0) return pHp;
    // KDA 影子血量：外部隊友治療不計入影子軌跡（＝量出「沒有這口奶會怎樣」）；自身回復照加
    const _shadowAdd = (gain) => {
      if (_shadowHp != null && !(opts && opts.externalAura) && gain > 0) {
        _shadowHp = Math.min(pStats.maxHp, _shadowHp + gain);
      }
    };
    if (opts && opts.lifesteal) { const _b = pHp; pHp = Math.min(pStats.maxHp, pHp + amt); const _actual = pHp - _b; _totalLifestealDone += _actual; _shadowAdd(_actual); return pHp; } // 吸血是自身機制，不受治療攔截影響
    if (_healImmune) return pHp;                          // 對鮮血的渴望：外部治療一律無效
    if (_healToDamage > 0) {
      // 怪已經死了才觸發的回血(擊殺回血/戰後回血)：轉傷害只會灌 totalDamage、汙染世界王傷害榜，
      // 對戰鬥結果毫無意義 → 直接不轉(聖人本來就吃不到這兩種回血)。
      if (opts && opts.postMortem) return pHp;
      const dmg = _mitigateHealDamage(Math.round(amt * _healToDamage));
      mHp -= dmg; totalDamage += dmg; return pHp; // 聖人：回血轉傷後吃敵方防禦、不回血
    }
    { const _b = pHp; pHp = Math.min(pStats.maxHp, pHp + amt); const _actual = pHp - _b; _totalHealDone += _actual; _shadowAdd(_actual); }
    return pHp;
  };
  // 回血 + 戰報（統一出口）。直接寫「回復 N HP」會騙人：聖人(_healToDamage)會把治療轉成傷害、
  // 對鮮血的渴望(_healImmune)會整個吃掉、滿血時也回不進去。這裡一律用「實際回了多少」來決定怎麼寫。
  //   onHealed(actual) → 該情境自己的文案（保留各處原本的措辭/emoji）
  // log 是每回合才建立的區域變數，這裡拿不到 → 由迴圈每回合把當回合的 log 掛上來。
  let _curLog = null;
  const _healLogged = (h, onHealed, { conversionLabel = "" } = {}) => {
    const amt = Math.max(0, Number(h) || 0);
    const beforeHp = pHp;
    const beforeMHp = mHp;
    pHp = _healPlayer(amt);
    const actual = pHp - beforeHp;
    if (actual > 0) { if (_curLog) _curLog.push(onHealed(actual)); return actual; }
    if (_healToDamage > 0) {
      const dealt = beforeMHp - mHp;
      if (dealt > 0 && _curLog) {
        const source = conversionLabel ? `【${conversionLabel}】` : "";
        _curLog.push(`🩸 **聖者・回血化刃**${source}！對 ${mName} 造成 **${dealt}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
      }
    }
    // 其餘(滿血/治療免疫)：不印，避免洗出一堆「恢復 0 HP」
    return 0;
  };
  // 戰報重整批次二：技能說明只印「本場第一次」——同一技能重複觸發只印【名稱】＋數字，
  // 不再每回合重貼整段規則說明（實測一場 15 回合光說明就吃掉 ~25 行）。
  const _skillDescShown = new Set();
  const _descOnce = (name, desc) => {
    const key = String(name || "");
    if (!key || !desc) return desc || "";
    if (_skillDescShown.has(key)) return "";
    _skillDescShown.add(key);
    return desc;
  };
  let outcome = null;
  let totalDamage = 0;
  // 世界王:玩家 DOT 也要吃世界王 def%(含扣防後的有效值)。跨回合保留上一回合的扣防%,
  // 因為玩家 DOT 在回合最前面結算(早於本回合扣防計算)。
  const isWorldBossFight = Boolean(options.isWorldBoss);
  let monsterDefDownCarry = 0;
  let playerDefIgnoreCarry = 0; // 上一回合玩家無視防禦%(法師徽章/魔力爆炎等),供 DOT 穿防
  // 武器主屬性追加傷害:終傷後 +(主屬性 × 1.5)固定點數。主攻擊/連擊/反擊各加一次。
  const weaponMainBonus = Math.max(0, Math.round((pStats.weaponMainStatValue || 0) * 1.5));
  // 世界王部位弱點倍率：玩家對王「每一擊」的傷害倍率(牙狼:同流派×1、不同×0.3)。預設 1 不影響其他戰鬥。
  // 直接乘在玩家傷害上→戰報數字=真實傷害、部位血正常遞減、戰鬥在真的打死時才結束(不提早中止)。
  const bossVulnMult = (options.bossVulnMult != null && Number(options.bossVulnMult) >= 0) ? Number(options.bossVulnMult) : 1;

  // ── 屬性系統（土火水木金日月；裝備單件依階級最多 1~5 洞）──
  // 攻擊側＝武器＋副手，依怪物屬性動態選「剋制＞中性＞被剋」。
  // 攻方剋守方看攻方濃度；守方剋攻方看守方（怪物）濃度。
  // 防禦側＝防具與怪物同屬性才提供抗性；防具不走相剋環。
  // 任一方無屬性/等級 0 → 不生效；現有 69 隻怪與 487 件道具都沒有 element 欄位，既有內容零影響。
  const monsterElement = normalizeElement(options.monsterElement);
  const monsterElementLevel = monsterElement
    ? normalizeElementLevel(options.monsterElementLevel ?? 1)
    : 0;
  // ── 戰鬥姿態（聖劍士／元素師等二轉）：提前到屬性計算之前解析——
  //    元素師的姿態自帶屬性（炎圈火2/凍霜水2），要參與下方的武器屬性疊加。
  //    options.stance 沒給 → battleStance = null → 行為完全同現況。
  let battleStance = null;
  try {
    battleStance = require("./jobAdvancement").resolveStance(options.equipped?.job_eq, options.stance);
  } catch (_) { battleStance = null; }
  // 武器多屬性並存(水3火2...)，姿態自帶屬性也一起進候選池；自動選最佳關係後才決定本場攻擊屬性。
  const _stanceElements = battleStance?.stanceElement?.element
    ? { [battleStance.stanceElement.element]: battleStance.stanceElement.level }
    : null;
  const _weaponEl = resolveWeaponElement(options.equipped || {}, monsterElement, _stanceElements);
  let playerElement = options.playerElement !== undefined
    ? normalizeElement(options.playerElement)
    : _weaponEl.element;
  let playerElementLevel = options.playerElementLevel !== undefined
    ? normalizeElementLevel(options.playerElementLevel)
    : _weaponEl.level;
  const elementMult = getElementMultiplier(playerElement, monsterElement, playerElementLevel, monsterElementLevel);

  // 七屬性抗性（V0.5 生存系統）：防具側「同屬性」濃度 vs 怪物屬性，雙向——
  // 怪物是什麼屬性，防具就用相同屬性抵抗；其他防具屬性不影響這隻怪的傷害。
  const sameElementResist = getSameElementResist(options.equipped || {}, monsterElement);

  // 裝備/卡片的「對特定屬性怪物增傷」(bonus_vs_element)。
  // 只來自裝備被動、整場不變，故在此一次算好；與相剋同層(終傷)相乘，
  // 讓卡片寫 +20% 就真的是 +20%（放在防禦前那層會被稀釋成約 +10%，兩個屬性機制強度不一致）。
  let elementBonusPct = 0;
  if (monsterElement && options.equipped) {
    try {
      const _elemCtx = { equipped: options.equipped, inventory: options.inventory || [], zone: options.zone || null };
      for (const ef of collectEquipmentEffects(options.equipped, "passive", _elemCtx)) {
        if (!ef || ef.key !== "bonus_vs_element") continue;
        if (normalizeElement(ef.params?.element) !== monsterElement) continue;
        elementBonusPct += Math.abs(Number(ef.params?.value) || 0);
      }
    } catch (_) { /* 取不到裝備效果時視為 0，不影響戰鬥 */ }
  }
  const elementBonusMult = 1 + elementBonusPct / 100;

  // ── 戰鬥姿態的非屬性接點（battleStance 已在上方屬性區之前解析）──────
  // 元素師三姿態：炎圈（每回合 MATK% 火傷）／嵐暴（固定 3 段法術）／凍霜（區域冰凍值，累積在呼叫端）
  const fireCircleCfg = battleStance?.fireCircle || null;    // { matkPct }
  const stormVolleyCfg = battleStance?.stormVolley || null;  // { hits, pctPerHit }

  // ── 血怒（狂戰士二轉被動）────────────────────────────────────────────
  // 每缺 1% HP → 該回合 ATK +perMissPct%，封頂 capPct%。逐回合看「當下」HP，
  // 設定表在 jobAdvancement.T2_BRANCHES[*].bloodRage，沒有徽章 → null → 完全走現況。
  let bloodRage = null;
  try {
    bloodRage = require("./jobAdvancement").getBloodRage(options.equipped?.job_eq);
  } catch (_) { bloodRage = null; }
  let _bloodRageAnnounced = false;
  let _berserkAnnounced = false;

  // 攻擊姿態：依「對手被剋制的屬性」出手，也就是保證站在相剋優勢方。
  // 武器已有屬性濃度(>=upgradeFromWeaponLevel) → 直接用 upgradedLevel，否則 baseLevel。
  // 怪物沒有屬性時不生效（無從判斷誰剋誰），維持 ×1。
  let stanceElementMult = null;
  if (battleStance?.guaranteedElement && monsterElement) {
    const ge = battleStance.guaranteedElement;
    const lv = playerElementLevel >= Number(ge.upgradeFromWeaponLevel || 2)
      ? Number(ge.upgradedLevel || 4)
      : Number(ge.baseLevel || 2);
    stanceElementMult = 1 + normalizeElementLevel(lv) * 0.10;
  }

  // 玩家每一擊的總倍率 = 世界王部位弱點 × 屬性相剋 × 對屬性增傷。
  // 三者都是「乘進每一擊終傷」的同類機制，合併成一個乘數即可涵蓋主擊/連擊/三元/反擊/各DOT
  //   （函式名沿用 applyBossVuln 以免動到既有呼叫點）。
  // 演奏加成（吟遊詩人）：上一場的演奏結果 → 本場全部輸出 ×0.7~1.8（乘進 playerHitMult＝主擊/連擊/DOT 全吃）
  const _bardMult = Math.max(0.1, Number(options.bardDamageMult) || 1);
  const playerHitMult = bossVulnMult * (stanceElementMult ?? elementMult) * elementBonusMult * _bardMult;
  const applyBossVuln = (raw) => (playerHitMult === 1 ? raw : Math.max(0, Math.round((Number(raw) || 0) * playerHitMult)));
  let round = Math.max(1, Math.floor(Number(options.startRound || 1)));
  let endRound = round + Math.max(1, Math.floor(Number(MAX_ROUNDS) || 1)) - 1;
  // BOSS 單位判定（世界王/區域王）：暈眩抗性與格擋規則會用到
  const monsterIsBossUnit = Boolean(options.monsterIsBoss || options.isBoss || options.isWorldBoss || mCalc?.isBoss);
  // BOSS 暈眩抗性：被擊暈最多 1 回合（防多段/永暈鏈）；一般怪不受影響
  // 暈眩專精（矮人戰士長）：設定表在 jobAdvancement.T2_BRANCHES[*].stunMastery，
  // 這裡只讀表、不寫死職業。沒有徽章 → null → 行為完全同現況。
  let stunMastery = null;
  try {
    stunMastery = require("./jobAdvancement").getStunMastery(options.equipped?.job_eq);
  } catch (_) { stunMastery = null; }

  // ── 世界王的暈眩規則（使用者定案）────────────────────────────────
  //   ① 任何職業（拿槌等）都能暈王，但**最多 1 回合**
  //   ② 暈完之後王進入**暈眩免疫**，免疫期間再怎麼觸發都暈不動
  //   ③ 矮人戰士長的被動「巨神之握」把自己的上限提高到 **2 回合**（免疫規則相同）
  // 一般怪不受這套限制（維持原本的 3 回合暈眩、無免疫）。
  const _bossStunCap = Math.max(1, Math.floor(Number(stunMastery?.bossStunCap) || 1));
  /** 暈完之後王免疫幾回合（只對 boss 生效） */
  const BOSS_STUN_IMMUNE_ROUNDS = Math.max(0, Math.floor(Number(options.bossStunImmuneRounds ?? 3)));
  const capMonsterStun = (v) => (monsterIsBossUnit ? Math.min(v, _bossStunCap) : v);
  /** 王的暈眩免疫到第幾回合為止（含）；0 = 沒有免疫中 */
  let monsterStunImmuneUntil = 0;
  let stunRoundsLeft = capMonsterStun(Math.max(0, Math.floor(Number(options.stunRoundsLeft || 0)))); // 怪物剩餘擊暈回合數
  // 團隊暈眩（矮人戰士長・巨神震擊）：暈眩窗口內開打 → 怪物整場不出手。
  // 這條**不受上限與免疫管制**——是全服合力敲滿暈眩條換來的 20 秒窗口，
  // 且窗口外有 2 分鐘免疫，與單場戰鬥內的暈眩節奏是兩套獨立機制。
  const _teamStunRounds = Math.max(0, Math.floor(Number(options.teamStunRounds || 0)));
  if (_teamStunRounds > 0) stunRoundsLeft = Math.max(stunRoundsLeft, _teamStunRounds);

  /**
   * 對怪物上暈眩的唯一入口。
   * 回傳 true = 真的暈到了；false = 被免疫擋下。
   * 以前各處各自 `stunRoundsLeft = capMonsterStun(...)`，其中武器 proc 那條還漏了沒 cap，
   * 導致「boss 最多暈 1 回合」形同虛設 → 統一收斂到這裡。
   */
  const applyMonsterStun = (rawRounds, curRound) => {
    const want = Math.max(0, Math.floor(Number(rawRounds) || 0));
    if (want <= 0) return false;
    if (monsterIsBossUnit && curRound <= monsterStunImmuneUntil) return false; // 免疫中
    const dur = capMonsterStun(want);
    if (dur <= 0) return false;
    stunRoundsLeft = Math.max(stunRoundsLeft, dur);
    if (monsterIsBossUnit && BOSS_STUN_IMMUNE_ROUNDS > 0) {
      // 暈眩結束的那一回合之後開始免疫
      monsterStunImmuneUntil = curRound + dur - 1 + BOSS_STUN_IMMUNE_ROUNDS;
    }
    return true;
  };
  let monsterActiveEffects = Array.isArray(options.monsterActiveEffects)
    ? options.monsterActiveEffects.map((effect) => ({ ...effect, params: { ...(effect.params || {}) } }))
    : []; // 怪物的 active effects（Buff/Debuff）
  const cardCooldowns = {
    player: { ...(options.cardCooldowns?.player || {}) },
    monster: { ...(options.cardCooldowns?.monster || {}) },
  };
  const jobSkillCooldowns = {}; // { [skillKey]: remainingTurns }
  // ── 職業技能「成本」通用機制（2026-07-28 新增，所有職業共用）──
  //   技能可帶 cost: { type: "combo" | "hp", value: N }
  //     combo — 消耗區域連段（跨場資源、陣亡歸零）；戰鬥內只累計消耗量，
  //             由呼叫端拿 result.jobSkillComboSpent 扣除並落地
  //     hp    — 消耗當前 HP 的 N%（場內資源，立即扣）
  //   不夠付 → 技能不進池／不觸發（不會欠帳）。
  let _jobSkillComboSpent = 0;
  //   另有通用欄位 oncePerBattle: true —— 一場只發動一次（消耗型技能用，避免一場吃掉數倍資源）
  const _skillUsedThisBattle = new Set();
  const _comboAvailable = () => Math.max(0, (Number(options.zoneComboCount) || 0) - _jobSkillComboSpent);
  /** 這個技能現在付得起嗎（不扣款） */
  const _canAffordSkill = (sk) => {
    if (sk?.oncePerBattle && _skillUsedThisBattle.has(sk.key)) return false;
    const c = sk?.cost;
    if (!c || !(Number(c.value) > 0)) return true;
    if (c.type === "combo") return _comboAvailable() >= Number(c.value);
    if (c.type === "hp") return pHp > Math.max(1, Math.round(pStats.maxHp * (Number(c.value) / 100)));
    return true;
  };
  /** 實際扣款（發動時呼叫）；回傳給戰報用的敘述片段 */
  const _paySkillCost = (sk) => {
    if (sk?.key) _skillUsedThisBattle.add(sk.key);
    const c = sk?.cost;
    if (!c || !(Number(c.value) > 0)) return "";
    if (c.type === "combo") {
      _jobSkillComboSpent += Number(c.value);
      return `（消耗 ${c.value} 連段）`;
    }
    if (c.type === "hp") {
      const cost = Math.max(1, Math.round(pStats.maxHp * (Number(c.value) / 100)));
      _hurt(cost);
      return `（消耗 ${cost} HP）`;
    }
    return "";
  };
  let forceMonsterCritFail = false; // 賭徒「千術」：本回合敵方攻擊必定大失敗
  let _greatChanceBonusRound = 0;   // 盜靈「探囊」：本回合大成功機率 +N（不是必定大成功）
  let _burstUsed = false;           // 劍鬼「斬」：一場只發動一次
  let jobSkillUsedThisRound = false;
  // ── 連擊氣條（影舞者・盜賊二轉）────────────────────────────────────
  // 設定走 jobAdvancement 表；沒有徽章 → null → 行為完全同現況。
  //   累氣：本回合有出現連擊 → +1 格（每回合最多 1）；滿 5 格 → 下一回合固定 5 連擊（該回合不累氣）
  //   氣量跨場沿用由呼叫端持久化（options.shadowGaugeGrids 進、result.shadowGauge 出）
  let shadowCfg = null;
  try {
    const _br = require("./jobAdvancement").getT2Branch(String(options.equipped?.job_eq?.itemId || options.equipped?.job_eq?.id || ""));
    if (_br && _br.shadowGauge) shadowCfg = require("./shadowGauge");
  } catch (_) { shadowCfg = null; }
  let _shadowGrids = shadowCfg ? Math.max(0, Math.min(shadowCfg.GAUGE_MAX, Number(options.shadowGaugeGrids) || 0)) : 0;
  let _shadowBurstNext = false;
  // 帶著滿格進場（上一場滿在結尾）→ 第一回合就是殘影亂舞
  if (shadowCfg && _shadowGrids >= shadowCfg.GAUGE_MAX) { _shadowBurstNext = true; _shadowGrids = 0; }
  let _shadowForcedHits = 0;      // 本回合的固定連擊段數（0 = 無）
  let _shadowChargeThisRound = true; // 殘影亂舞的回合不累氣
  let _shadowChargeRoundMark = 0;    // 本回合已累過氣（每回合最多 +1 格；雙持副手連擊不重複吃）

  // ── 氣力格（劍鬼・斬 2026-07-22 改版）────────────────────────────
  // 3 格、戰鬥內累積：每回合有攻擊到對手 +1 格（每回合最多 1 格），
  // 滿 3 格 → 下一回合**自動施放斬**（無視防禦與等級差、可爆擊），氣力歸零重積。
  // 斬的倍率＝1 + 0.1 × min(當前區域連段, 30)——連段決定斬多痛、氣力決定何時斬。
  let oniCfg = null;
  try {
    const _obr = require("./jobAdvancement").getT2Branch(String(options.equipped?.job_eq?.itemId || options.equipped?.job_eq?.id || ""));
    if (_obr && _obr.combo) oniCfg = require("./zoneCombo");
  } catch (_) { oniCfg = null; }
  // 跨場沿用（A 案）：呼叫端用 options.oniGaugeGrids 帶入上一場剩餘氣量（同區/10 分鐘內），
  // 帶滿格（＝上一場滿了但先結束）→ 第 1 回合就自動斬；戰後由 result.oniGauge 帶出去持久化。
  let _oniGrids = oniCfg ? Math.max(0, Math.min(oniCfg.ONI_GAUGE_MAX, Number(options.oniGaugeGrids) || 0)) : 0;
  let _oniBurstNext = false;
  if (oniCfg && _oniGrids >= oniCfg.ONI_GAUGE_MAX) { _oniGrids = 0; _oniBurstNext = true; }
  const _oniMult = oniCfg ? oniCfg.oniBurstMult(Number(options.zoneComboCount) || 0) : 1;

  // 「目標現在是不是暈眩中」——全遊戲統一口徑：
  //   stunRoundsLeft         ＝ 武器 proc／震地重擊／巨神震擊(時間暈眩) 都寫這裡
  //   monsterActiveEffects   ＝ 卡片/技能掛上去的 stun 效果
  // 以前三處判定各寫各的（矮人那條只查後者），導致巨神震擊時矮人吃不到自己的加成。
  const _targetStunnedNow = (round) => stunRoundsLeft > 0
    || (Array.isArray(monsterActiveEffects) && monsterActiveEffects.some((e) => e && e.key === 'stun' && effectIsActive(e, round)));

  const combatStats = {
    comboCount: 0,
    dodgeCount: 0,
    blockCount: 0,
    stunCount: 0,
    burnTriggerCount: 0,
    supportShotBySource: {}, // 掩護射擊（神射手）：提供者 → 本場箭傷合計（世界王結算歸戶用）
    stealTriggered: false,   // 盜靈「得手」：本場是否成功盜取（呼叫端據此發物品＋標記該怪已被偷）
    greatHitCount: 0,        // 大成功以上的攻擊次數（盜靈數值驗證用）
    attackCount: 0,
    // 「實際有攻擊到的回合數」（同一回合打幾下都只算 1）——
    // 矮人戰士長敲世界王暈眩條用；attackCount 是每一擊都 +1（雙持/骰子會 +2），不能拿來當回合數
    attackRounds: 0
  };
  let _attackRoundMark = 0; // 上一次計入 attackRounds 的回合，避免同回合重複累加
  // ── 一次性效果旗標（一場戰鬥只觸發一次）──
  let deathPreventUsed = false;

  // ── 自動載入「裝備 passive」進 playerActiveEffects（戒指 / 卡片 / 武器防具 passive 才會生效）──
  // 不重複塞純 stat 類（已經被 calcPlayerStats 折進 base stats）
  const STAT_FOLDED_KEYS = new Set([
    "atk_up","def_up","mdef_up","crit_rate_up","crit_rate_down","crit_damage_up","crit_damage_down",
    "speed_up","speed_down","atk_multiplier_up","def_multiplier_up","max_hp_multiplier_up",
    "block_chance_up","combo_damage_up","combo_up","stun_chance_up","execute_chance_up",
    "execute_threshold_up","final_damage_up","final_damage_down","hit_up","dodge_up","agi_up"
  ]);
  // 裝備被動的 final_damage_up/down（含 zone 條件，例：S 龍系武器「龍族之領/龍王巢穴 +20% 屠龍特攻」）的合計倍率，
  // 在所有計算(防禦/爆擊/減傷)之後對最終傷害整體乘上。（圖鑑加成不在此，維持原本在 conditionalBonusMultiplier）
  let equipZoneFinalDmgMult = 1;
  // 逐回合縮放的 final_damage 效果（傳說裝「驟（前置）/滯（後置）」用）：
  // 不折進靜態 equipZoneFinalDmgMult，改成每回合依回合數即時計算（base 帶正負號，每回合 +ramp / −decay，夾在 [min,max]）。
  const roundScaledFinalDmg = [];
  // 骰・命運之輪:方差大爆(放棄一般暴擊,改 LUK 縮放的低機率超高倍)。null = 未裝。
  let varianceCrit = null;
  const roundScaleMult = (rnd) => {
    let m = 1;
    for (const rs of roundScaledFinalDmg) {
      let v = rs.base + rs.step * (Math.max(1, rnd) - 1);
      v = Math.max(rs.minValue, Math.min(rs.maxValue, v));
      m *= v >= 0 ? (1 + v / 100) : (1 - Math.min(95, Math.abs(v)) / 100);
    }
    return m;
  };
  try {
    if (options.equipped) {
      // 帶上 zone：讓「限定龍族之領/龍王巢穴」之類的 zone 條件能被正確判定（context.zone 由戰鬥端傳入）
      const _eqCtx = { equipped: options.equipped, inventory: options.inventory || [], zone: options.zone || null };
      const equipmentPassives = collectEquipmentEffects(options.equipped, "passive", _eqCtx);
      const battleStartEffects = collectEquipmentEffects(options.equipped, "battle_start", _eqCtx);
      const allEquipmentEffects = [...equipmentPassives, ...battleStartEffects];
      if (allEquipmentEffects.length > 0) {
        if (!Array.isArray(options.playerActiveEffects)) options.playerActiveEffects = [];
        // 先移除「上一輪注入的裝備被動」再重注入：
        // 若呼叫端重用同一個 playerActiveEffects 陣列（例如爬塔每次行動都呼叫一次 runCombatLoop 並把 activeEffects 帶著），
        // 原本的 push 會每次再複製一份裝備被動 → 無限累積（吸血%、首擊/高血增傷複利滾大，傷害爆表）。
        // 改成每次呼叫都「清掉舊的 equipment_passive → 重塞當前裝備被動」：冪等、不累積，且仍保留多件裝備的疊加。
        options.playerActiveEffects = options.playerActiveEffects.filter((e) => e && e.sourceType !== "equipment_passive");
        for (const ep of allEquipmentEffects) {
          if (!ep || !ep.key) continue;
          // 骰・命運之輪:登記方差大爆參數(每點 LUK 的大爆機率% + 倍率),實際擲骰在傷害結算處
          if (ep.key === "variance_crit") {
            varianceCrit = {
              chancePerLuk: Number(ep.params?.chancePerLuk) || 0.3,
              mult: Number(ep.params?.mult) || 4,
            };
            continue;
          }
          // 龜甲庇護（島島龜王卡）：兩段式——殼在減傷、殼破增傷
          if (ep.key === "turtle_shell") {
            _tshellCfg = {
              shellPct: Math.max(1, Number(ep.params?.shellPct) || 20),
              drPct: Math.max(0, Math.min(80, Number(ep.params?.drPct) || 25)),
              breakDmgPct: Math.max(0, Number(ep.params?.breakDmgPct) || 20),
            };
            _tshellMax = Math.max(1, Math.round((pStats.maxHp || 1) * _tshellCfg.shellPct / 100));
            _tshellHp = _tshellMax;
            continue;
          }
          if (ep.key === TURTLE_TIDE_EFFECT_KEY) {
            _turtleSetTideCfg = normalizeTurtleTideConfig(ep);
            continue;
          }
          // build 錨點四件（沒苦硬吃 / 聖人比拳頭 / 對鮮血的渴望 / 時間管理大師）
          if (ep.key === "endure_burst") {
            // 2026-08-04 改制：原本「撐到第 15 回合一次反彈 ×5」→ 改成「每 N 回合反彈一次」，
            // 反彈的是「上次反彈之後累積的承傷」，不是整場總和（不然會越滾越誇張）。
            _endureBurst = {
              everyRounds: Math.max(1, Number(ep.params?.everyRounds ?? ep.params?.round) || 3),
              mult: Math.max(1, Number(ep.params?.mult) || 5),
            };
            continue;
          }
          if (ep.key === "heal_to_damage") {
            _healToDamage = Math.max(0, Number(ep.params?.mult) || 0);
            continue;
          }
          if (ep.key === "heal_immune") {
            _healImmune = true;
            continue;
          }
          if (ep.key === "extend_rounds") {
            _extendRounds = Math.max(0, Number(ep.params?.rounds) || 0);
            continue;
          }
          if (ep.key === "no_normal_attack") { // 沒苦硬吃：完全無法造成一般攻擊傷害
            _noPlayerAtk = true;
            continue;
          }
          // final_damage_up/down：折進 equipZoneFinalDmgMult（稍後乘進玩家傷害），讓裝備被動的最終傷害%實際生效
          const _fp = ep.params || {};
          const _isRoundScaled = (ep.key === "final_damage_up" || ep.key === "final_damage_down") && (_fp.decayPerRound != null || _fp.rampPerRound != null);
          if (_isRoundScaled) {
            // 逐回合縮放：用「帶正負號的 value」當起點，每回合 +rampPerRound / −decayPerRound，夾在 [minValue,maxValue]
            roundScaledFinalDmg.push({
              base: Number(_fp.value) || 0,
              step: (Number(_fp.rampPerRound) || 0) - (Number(_fp.decayPerRound) || 0),
              minValue: _fp.minValue != null ? Number(_fp.minValue) : -95,
              maxValue: _fp.maxValue != null ? Number(_fp.maxValue) : 1000,
            });
          }
          else if (ep.key === "final_damage_up") { equipZoneFinalDmgMult *= (1 + Math.abs(Number(ep.params?.value) || 0) / 100); }
          else if (ep.key === "final_damage_down") { equipZoneFinalDmgMult *= (1 - Math.min(95, Math.abs(Number(ep.params?.value) || 0)) / 100); }
          if (STAT_FOLDED_KEYS.has(ep.key)) continue;
          // 整場戰鬥都有效（不設過期回合）
          const epParams = { ...(ep.params || {}) }; // 不放 duration，整場有效
          // 護盾/結界依設計為 %MaxHP，載入時換算成絕對吸收量（與 proc_shield 一致；mode:'flat' 則維持固定值）
          if ((ep.key === "shield" || ep.key === "barrier") && epParams.mode !== "flat") {
            const pct = Math.abs(Number(epParams.value) || 0);
            if (pct > 0 && epParams.amount == null) {
              // %maxHp 底值 + INT 斜率（護盾型原型的成長曲線）
              const amt = Math.max(1, Math.round((pStats.maxHp || 0) * pct / 100) + intShieldBonus(pStats));
              epParams.amount = amt;
              epParams.value = amt;
            }
          }
          options.playerActiveEffects.push({
            key: ep.key,
            target: ep.target || "self",
            trigger: ep.trigger || "passive",
            params: epParams,
            appliedAt: 0,
            sourceType: "equipment_passive",
            sourceId: "equipment_passive:" + ep.key,
            // 保留來源標記：附魔衍生的詞條要跟裝備本身的效果分開（例如吸血上限只作用在裝備效果）
            source: ep.source || null,
          });
        }
      }
    }
  } catch (_) { /* equipment 載入失敗不擋戰鬥 */ }

  // 火翼龍人卡：降低「對方(怪物)」治療效率 %（在所有怪物回血點折減）
  // 降低怪物治療（火翼龍人卡 enemy_heal_reduction）：支援「隊伍光環」——
  // 自身被動(playerActiveEffects)或隊友提供的光環(partyEffects)任一來源皆可生效。
  // 各來源「組內加總」後「跨來源取最大」：保留同源多張疊加，又避免自身被動與自己的光環重複計算。
  const _healRedSum = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((e) => e && e.key === "enemy_heal_reduction")
    .reduce((s, e) => s + Math.abs(Number(e?.params?.value) || 0), 0);
  const playerEnemyHealReductionPct = Math.min(100, Math.max(
    _healRedSum(options.playerActiveEffects),
    _healRedSum(options.partyEffects)
  ));
  const reduceMonsterHeal = (h) => {
    const n = Math.max(0, Math.round(Number(h) || 0));
    return playerEnemyHealReductionPct > 0
      ? Math.max(0, Math.round(n * (1 - playerEnemyHealReductionPct / 100)))
      : n;
  };
  // 龍翼魔法師卡：每回合清除自身負面狀態
  const playerCleanseSelf = (options.playerActiveEffects || []).some((e) => e && e.key === "cleanse_self");
  const PLAYER_DEBUFF_KEYS = ['poison','burn','bleed','shock_dot','curse_dot','stun','freeze','sleep','silence','slow','blind','fear','root','disarm','confuse','charm','dark_curse','atk_down','def_down','hit_down'];
  // debuff_immunity（免疫負面，例如冰鱗龍人卡）擋的「異常類」負面：含沈默/DOT/降攻防/緩速等；
  // 硬控（stun/freeze/sleep/fear/root/blind/disarm/confuse/charm/taunt）仍由 control_immunity 處理。
  const DEBUFF_IMMUNITY_KEYS = ['silence','poison','burn','bleed','shock_dot','curse_dot','slow','dark_curse','atk_down','def_down','hit_down','agi_down'];
  const playerHasDebuffImmunityActive = (round) => (options.playerActiveEffects || []).some((e) => {
    if (!e || e.key !== 'debuff_immunity') return false;
    const d = e.params?.duration || {};
    if (d.mode === 'turns') return round <= (e.appliedAt || 1) + (d.value || 1);
    return true;
  });

  const roundLogs = [];
  const tierDamageMultiplier = Math.max(0.1, Number(pStats.tierDamageMultiplier) || 1);
  const tierFinalDamageMultiplier = Math.max(0.1, Number(pStats.tierFinalDamageMultiplier) || 1);
  const tierBossDamageMultiplier = options.monsterIsBoss ? Math.max(0.1, Number(pStats.tierBossDamageMultiplier) || 1) : 1;
  const tierCritDamageMultiplier = Math.max(0.1, Number(pStats.tierCritDamageMultiplier) || 1);

  // 時間管理大師：回合上限改為指定值（例 30）
  if (_extendRounds > 0) endRound = round + Math.max(1, Math.floor(_extendRounds)) - 1;

  _shadowHp = pHp; // KDA 影子血量起點（與實際血量同步出發，之後只吃「非外部治療」的變化）
  while (round <= endRound && outcome === null) {
    const log = [`**【第 ${round} 回合】**`];
    _curLog = log;   // 讓 _healLogged 能把回血/回血化刃寫進「當回合」的戰報
    _curRound = round; // KDA：影子血歸零回合的記錄基準
    if (_turtleSetTideCfg && isTurtleTideTransitionRound(round, _turtleSetTideCfg)) {
      if (turtleTidePhase(round, _turtleSetTideCfg) === "high_tide") {
        log.push(`🌊 **漲潮**！龜王套裝展開潮甲，本階段受到傷害 **-${_turtleSetTideCfg.highTideDamageReductionPct}%**。`);
      } else {
        log.push(`🏝️ **退潮**！龜王套裝蓄勢反攻，本階段最終傷害 **+${_turtleSetTideCfg.ebbFinalDamagePct}%**。`);
      }
    }
    // 屬性判定只在第一回合印一次。攻擊與防禦刻意分行，避免玩家把
    // 「武器/副手的輸出相剋」和「防具的同屬抗性」誤認成同一套規則。
    if (round === (Number(options.startRound) || 1)) {
      const _rel = getElementRelation(playerElement, monsterElement);
      const _aL = getElementLabel(playerElement);
      const _dL = getElementLabel(monsterElement);
      if (_dL) {
        log.push(`⚜️ **屬性判定**｜敵人：${_dL}${monsterElementLevel}屬性`);

        if (playerElementLevel > 0 && _rel === "advantage") {
          log.push(`⚔️ **攻擊（武器＋副手）**｜${_aL}${playerElementLevel} 剋 ${_dL} → 對敵傷害 **+${Math.round(playerElementLevel * 10)}%**`);
        } else if (playerElementLevel > 0 && _rel === "disadvantage") {
          log.push(`⚔️ **攻擊（武器＋副手）**｜${_dL}${monsterElementLevel} 剋 ${_aL}${playerElementLevel} → 對敵傷害 **−${Math.round(monsterElementLevel * 10)}%**`);
        } else if (playerElementLevel > 0 && _aL) {
          log.push(`⚔️ **攻擊（武器＋副手）**｜自動選擇 ${_aL}${playerElementLevel}（中性） → 對敵傷害 **±0%**`);
        } else {
          log.push("⚔️ **攻擊（武器＋副手）**｜本場沒有相剋效果 → 對敵傷害 **±0%**");
        }

        const _sameDeltaPct = Math.round((sameElementResist.mult - 1) * 100);
        const _sameDeltaText = _sameDeltaPct > 0
          ? `+${_sameDeltaPct}%`
          : _sameDeltaPct < 0 ? `${_sameDeltaPct}%` : "±0%";
        log.push(
          `🛡️ **防禦（同屬抗性）**｜防具 ${_dL}${sameElementResist.level}（${_dL}抗 ${sameElementResist.pct}%）` +
          ` → 受到${_dL}屬性傷害 **${_sameDeltaText}**${sameElementResist.pct >= 100 ? "（滿抗）" : ""}`
        );

        if (sameElementResist.pct === 0) {
          log.push(`💡 防具鑲嵌${_dL}屬性石可提高${_dL}抗；每顆顯示抗性 +10%，並使實際承傷降低 5%。`);
        }
      }
    }
    // 沒苦硬吃：每 N 回合反彈一次「這段期間累積的承受傷害 × 倍率」
    if (_endureBurst && pHp > 0 && round % _endureBurst.everyRounds === 0 && _endureTakenSinceBurst > 0) {
      // 終傷層倍率（部位弱點／屬性相剋／演奏／龜王詠唱）：反彈也是玩家輸出，要與主擊同一層。
      // ⚠️ 這段在回合迴圈中的位置早於 applyMonsterIncomingGuards 的宣告（TDZ），
      //    只能用宣告在迴圈之外的 applyBossVuln。
      const _burst = applyBossVuln(Math.round(_endureTakenSinceBurst * _endureBurst.mult));
      mHp -= _burst;
      totalDamage += _burst;
      log.push(`💥【沒苦硬吃】第 ${round} 回合反擊！這 ${_endureBurst.everyRounds} 回合承受的痛全數奉還——造成 **${_burst}** 傷害（期間承傷 ${_endureTakenSinceBurst} × ${_endureBurst.mult}）`);
      _endureTakenSinceBurst = 0;
    }
    if (options.tickCardCooldowns !== false) {
      for (const bucket of Object.values(cardCooldowns)) {
        for (const key of Object.keys(bucket)) {
          bucket[key] = Math.max(0, Number(bucket[key] || 0) - 1);
        }
      }
    }
    for (const key of Object.keys(jobSkillCooldowns)) {
      jobSkillCooldowns[key] = Math.max(0, Number(jobSkillCooldowns[key] || 0) - 1);
    }
    jobSkillUsedThisRound = false;
    // ── 連擊氣條：決定本回合的固定連擊 ──
    if (shadowCfg) {
      _shadowForcedHits = 0;
      _shadowChargeThisRound = true;
      if (_shadowBurstNext) {
        // 殘影亂舞：滿氣消耗後的固定 5 連擊（不累氣）
        _shadowBurstNext = false;
        _shadowForcedHits = shadowCfg.BURST_HITS;
        _shadowChargeThisRound = false;
        log.push(`🌀 **殘影亂舞**！氣條盡數釋放——本回合固定 **${_shadowForcedHits} 連擊**！`);
      }
    }
    // ── 血祭（狂戰士）：開場真的砍自己一刀 ──
    // 以前用 options.startPlayerHp 讓戰鬥「從 70% 開始」，但前端血條是從滿血播的、
    // 伺服器也沒發出扣血事件 → 玩家看不到扣血、數字還對不上。改成第 1 回合實際扣，
    // 並用「你受到 N 點 …（你剩 X / Y）」這種前端時間軸解析得了的格式輸出。
    if (round === 1 && Number(options.sacrificeHpCostPct) > 0 && pStats.maxHp > 0) {
      const _cost = Math.max(1, Math.round(pStats.maxHp * (Number(options.sacrificeHpCostPct) / 100)));
      const _actual = Math.min(_cost, Math.max(0, pHp - 1)); // 保底留 1 滴血，不會因血祭直接死
      if (_actual > 0) {
        _hurt(_actual);
        log.push(`🩸 **血祭**！你剖開自己獻上祭品——你受到 **${_actual}** 點自傷，整場攻擊力 **+${Math.round(Number(options.sacrificeAtkUpPct) || 0)}%**！（你剩 ${Math.max(0, pHp)} / ${pStats.maxHp}）`);
      }
    }
    if (round === 1 && jobProfile.jobName) {
      log.push(`✨ ${jobProfile.jobName} ${rand(jobFlavor.intro)}`);
    }
    // 演奏加成宣告（吟遊詩人：上一場的演奏結果）
    if (round === 1 && options.bardPerformNote) {
      log.push(String(options.bardPerformNote));
    }
    // 海嘯（島島龜王）：海嘯期間進場＝第 1 回合即死；若詠唱在本場途中完成，
    // 則在換算後的回合開頭直接命中。都是真即死，無視結界／聖域／免死。
    const _tsunamiDeathRound = Math.max(0, Math.floor(Number(options.tsunamiDeathRound) || 0));
    if ((round === 1 && options.tsunamiDeath) || (_tsunamiDeathRound > 0 && round >= _tsunamiDeathRound)) {
      log.push(`🌊🌊🌊 **海嘯吞沒了一切！**`);
      log.push(_tsunamiDeathRound > 1
        ? `💀 海嘯在戰鬥途中完成詠唱，你被巨浪正面吞沒……（無視護盾、聖域與免死）`
        : `💀 你在滔天巨浪前沒有任何抵抗的餘地……（海嘯期間出戰＝即死，等浪退了再上）`);
      pHp = 0;
      outcome = "lose";
      roundLogs.push(log.join("\n"));
      break;
    }
    // 龜甲庇護（島島龜王卡）：開場宣告
    if (round === 1 && _tshellCfg) {
      log.push(`🐢 **龜甲庇護**展開！（殼 ${_tshellHp}）殼在期間受到傷害 −${_tshellCfg.drPct}%`);
    }
    // 符文結界／聖域護佑：開場宣告（前端結界條靠「結界值 N」這行初始化，格式勿改）
    if (round === 1 && sanctumCfg) {
      log.push(`🔷 **符文結界展開**！（結界值 ${_sanctumBarrier}）`);
    }
    if (round === 1 && (_sanctuaryCutPct > 0 || _sanctuaryHealPct > 0)) {
      log.push(`🏛️ **聖域護佑中**——本場受到傷害 -${_sanctuaryCutPct}%、每回合回復 ${_sanctuaryHealPct}% HP！`);
    }
    // 日之精靈登場宣告（格式固定：前端精靈血條靠這行與代承/治療行逐回合更新）
    if (round === 1 && sunSpiritCfg) {
      log.push(_spiritHp > 0
        ? `☀️ **日之精靈**應召而來，守護在你身前！（精靈 ${_spiritHp} / ${_spiritMaxHp}）`
        : `💫 日之精靈尚未甦醒，本場由你獨自作戰。`);
    }

    const monsterIsSilenced = Array.isArray(monsterActiveEffects) && monsterActiveEffects.some(e => {
      if (e?.key !== 'silence') return false;
      const dur = e.params?.duration || {};
      if (dur.mode === 'turns') {
        const end = (e.appliedAt || 1) + (dur.value || 1);
        return round <= end;
      }
      return true;
    });
    const monsterRoundEffects = monsterIsSilenced
      ? monsterActiveEffects.filter((eff) => eff?.sourceType !== 'monster_skill')
      : monsterActiveEffects;

    // ── 應用怪物的 activeEffects（Buff/Debuff） ──
    const adjustedMCalc = applyMonsterEffects(mCalc, monsterRoundEffects, round);
    const applyMonsterIncomingGuards = (rawDamage, {
      damageReduction = true,
      damageTaken = true,
      bossVulnerability = true,
      incomingCap = true,
    } = {}) => {
      let damage = Math.max(0, Math.round(Number(rawDamage) || 0));
      if (damage <= 0) return 0;
      if (damageReduction && Number(adjustedMCalc.damageReductionPct) > 0) {
        damage = Math.max(1, Math.round(damage * (1 - Math.min(95, Number(adjustedMCalc.damageReductionPct)) / 100)));
      }
      if (damageTaken && Number(adjustedMCalc.damageTakenMultiplier) !== 1) {
        damage = Math.max(1, Math.round(damage * Math.max(0, Number(adjustedMCalc.damageTakenMultiplier) || 1)));
      }
      if (monsterActiveEffects.some((effect) => effect?.key === 'invincible_short' && effectIsActive(effect, round))) {
        return 0;
      }
      if (incomingCap && Number(adjustedMCalc.incomingDamageCap) > 0) {
        damage = Math.min(damage, Number(adjustedMCalc.incomingDamageCap));
      }
      return bossVulnerability ? applyBossVuln(damage) : damage;
    };
    // 回合前段的回血化刃（隊伍光環）使用目前怪物狀態，並沿用上一回合已成立的
    // 隊伍扣防／玩家穿防；本回合裝備效果解析完成後會再刷新一次。
    _healDamageTargetStats = adjustedMCalc;
    _healDamageDefDownPct = monsterDefDownCarry;
    _healDamageDefIgnorePct = Math.min(100, Math.max(0,
      (Number(pStats.bypassMonsterDefPct) || 0) + playerDefIgnoreCarry));

    // ── 應用怪物的恢復效果（heal_over_time） ──
    if (Array.isArray(monsterRoundEffects)) {
      for (const healEff of monsterRoundEffects) {
        if (!healEff || !healEff.key) continue;
        const healParams = healEff.params || {};
        const healDuration = healParams.duration || {};

        // 檢查效果是否仍在持續
        if (healDuration.mode === 'turns') {
          const appliedRound = healEff.appliedAt || 1;
          const endRound = appliedRound + (healDuration.value || 1);
          if (round > endRound) continue;
        }

        // 應用怪物恢復
        if (healEff.key === 'heal_over_time') {
          const mode = String(healParams.mode || 'pct').toLowerCase();
          const val = Number(healParams.value ?? 0);
          if (!Number.isFinite(val) || val === 0) continue;
          const heal = reduceMonsterHeal(mode === 'pct' ? Math.max(0, Math.round(mHpInit * (val / 100))) : Math.max(0, Math.round(val)));
          if (heal > 0) {
            const beforeHeal = mHp;
            mHp = Math.min(mHpInit, mHp + heal);
            log.push(`💚 ${mName} 生命力逐漸恢復，回復 **${Math.max(0, mHp - beforeHeal)}** HP！（${mName} 剩 ${mHp} HP）`);
          }
        }
      }
    }

    // 世界王:玩家 DOT 吃世界王「扣防 + 無視防禦後的有效 def%」,與直接攻擊同一套。
    //  adjustedMCalc.def 已折入玩家自身 def_down(如詛咒祭司);monsterDefDownCarry=上一回合隊伍光環扣防;
    //  dotBypassPct = 法杖破防 + 法師徽章/魔力爆炎等無視防禦(playerDefIgnoreCarry,取上一回合值)。
    //  → 有效 def = 王def ×(1−扣防)×(1−無視防禦)。非世界王維持原本(DOT 不吃防禦)。
    const dotBypassPct = isWorldBossFight
      ? Math.min(95, Math.max(0, (pStats.bypassMonsterDefPct || 0) + playerDefIgnoreCarry))
      : 0;
    const wbEffDef = isWorldBossFight
      ? Math.max(0, Math.min(95, (adjustedMCalc.def || 0) * (1 - Math.min(95, monsterDefDownCarry) / 100) * (1 - dotBypassPct / 100)))
      : 0;
    const wbDotMult = 1 - wbEffDef / 100;

    // ── 炎圈（元素師）：怪物每回合受到 MATK×matkPct% 火傷——開場就燒、整場持續 ──
    //    走 DOT 同一套修正（等級壓制／世界王防%／部位弱點）；世界王的「其他部位」
    //    由呼叫端用 combatStats.fireCircleDamage 在戰後鏡射結算。
    if (fireCircleCfg && outcome === null && mHp > 0) {
      let _fcDmg = Math.max(1, Math.round((pStats.atk || 1) * (Number(fireCircleCfg.matkPct) || 10) / 100));
      _fcDmg = Math.max(1, Math.round(_fcDmg * playerAttackLevelMult * wbDotMult));
      if (_noPlayerAtk) _fcDmg = 0;
      _fcDmg = applyMonsterIncomingGuards(_fcDmg);
      if (_fcDmg > 0) {
        mHp -= _fcDmg;
        totalDamage += _fcDmg;
        combatStats.fireCircleDamage = (combatStats.fireCircleDamage || 0) + _fcDmg;
        combatStats.fireCircleTicks = (combatStats.fireCircleTicks || 0) + 1;
        combatStats.burnTriggerCount += 1; // 炎圈也算燃燒觸發（焰獄審判等任務指標）
        log.push(`🔥 **炎圈**灼燒！${mName} 受到 **${_fcDmg}** 點火焰傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
        if (mHp <= 0) { outcome = "win"; roundLogs.push(log.join("\n")); break; }
      }
    }

    // ── 應用怪物的 DOT 效果（燒傷/freeze/麻痺） ──
    let monsterFrozenThisRound = false;
    const _dotM = []; // 戰報重整：怪物身上的 DOT 各自照算，顯示彙總成一行（[標籤, 傷害]）
    if (Array.isArray(monsterRoundEffects)) {
      for (const mEff of monsterRoundEffects) {
        if (!mEff || !mEff.key) continue;
        const mParams = mEff.params || {};
        const mDur = mParams.duration || {};

        if (mDur.mode === 'turns') {
          const appliedRound = mEff.appliedAt || 1;
          const endRound = appliedRound + (mDur.value || 1);
          if (round > endRound) continue;
        }

        // 燒傷：每回合扣怪物最大 HP 的 value%（DB params，預設 0.5%）
        if (mEff.key === 'burn') {
          const burnPct = Number(mParams.value ?? 0.5);
          const burnBase = mParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(mParams.casterAtk || 1))
            : (mParams.mode === 'current' ? mHp : mHpInit);
          let burnDmg = Math.max(1, Math.round(burnBase * (burnPct / 100)));
          if (Number.isFinite(Number(mParams.maxDamage))) burnDmg = Math.min(burnDmg, Number(mParams.maxDamage));
          burnDmg = Math.max(1, Math.round(burnDmg * playerAttackLevelMult * wbDotMult)); // DOT 也吃等級壓制(世界王再吃 def%)
          if (_noPlayerAtk) burnDmg = 0;
          burnDmg = applyMonsterIncomingGuards(burnDmg);
          mHp -= burnDmg;
          totalDamage += burnDmg;
          combatStats.burnTriggerCount += 1; // 焰獄審判任務:玩家施加給怪的燃燒每跳一次算「觸發燃燒」1 次
          _dotM.push(["燒", burnDmg]);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 中毒：每回合扣怪物最大 HP 的 value%（盜賊疊加）
        if (mEff.key === 'poison') {
          const poisonPct = Number(mParams.value ?? 0.5);
          const poisonBase = mParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(mParams.casterAtk || 1))
            : mHpInit;
          let poisonDmg = Math.max(1, Math.round(poisonBase * (poisonPct / 100)));
          if (Number.isFinite(Number(mParams.maxDamage))) poisonDmg = Math.min(poisonDmg, Number(mParams.maxDamage));
          poisonDmg = Math.max(1, Math.round(poisonDmg * playerAttackLevelMult * wbDotMult)); // DOT 也吃等級壓制(世界王再吃 def%)
          if (_noPlayerAtk) poisonDmg = 0;
          poisonDmg = applyMonsterIncomingGuards(poisonDmg);
          mHp -= poisonDmg;
          totalDamage += poisonDmg;
          _dotM.push(["毒", poisonDmg]);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 冰凍：下回合起持續 duration 回合無法攻擊（appliedAt 是觸發回合，效果從下回合起算）
        if (mEff.key === 'freeze') {
          const freezeDur = Number(mEff.params?.duration?.value ?? 1);
          const freezeStart = (mEff.appliedAt ?? round) + 1;
          if (round >= freezeStart && round < freezeStart + freezeDur) {
            monsterFrozenThisRound = true;
          }
        }

        // 擊暈（卡片觸發）：設定 stunRoundsLeft
        if (mEff.key === 'stun') {
          const stunTurns = Number(mParams.duration?.value ?? 1);
          // appliedAt 回合起持續 stunTurns 回合
          const stunEnd = (mEff.appliedAt || 1) + stunTurns;
          if (round <= stunEnd && stunRoundsLeft < stunTurns) {
            applyMonsterStun(stunEnd - round + 1, round);
          }
        }

        // 流血：每回合扣怪物最大 HP 的 value%
        if (mEff.key === 'bleed') {
          const bleedPct = Number(mParams.value ?? 10);
          const bleedBase = mParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(mParams.casterAtk || 1))
            : mHpInit;
          let bleedDmg = Math.max(1, Math.round(bleedBase * (bleedPct / 100)));
          if (Number.isFinite(Number(mParams.maxDamage))) bleedDmg = Math.min(bleedDmg, Number(mParams.maxDamage));
          bleedDmg = Math.max(1, Math.round(bleedDmg * playerAttackLevelMult * wbDotMult)); // DOT 也吃等級壓制(世界王再吃 def%)
          if (_noPlayerAtk) bleedDmg = 0;
          bleedDmg = applyMonsterIncomingGuards(bleedDmg);
          mHp -= bleedDmg;
          totalDamage += bleedDmg;
          _dotM.push(["血", bleedDmg]);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        if (mEff.key === 'shock_dot') {
          const shockPct = Number(mParams.value ?? 15);
          const shockBase = mParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(mParams.casterAtk || 1))
            : mHpInit;
          let shockDmg = Math.max(1, Math.round(shockBase * (shockPct / 100)));
          if (Number.isFinite(Number(mParams.maxDamage))) shockDmg = Math.min(shockDmg, Number(mParams.maxDamage));
          shockDmg = Math.max(1, Math.round(shockDmg * playerAttackLevelMult * wbDotMult)); // DOT 也吃等級壓制(世界王再吃 def%)
          if (_noPlayerAtk) shockDmg = 0;
          shockDmg = applyMonsterIncomingGuards(shockDmg);
          mHp -= shockDmg;
          totalDamage += shockDmg;
          _dotM.push(["電", shockDmg]);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        if (mEff.key === 'curse_dot') {
          const cursePct = Number(mParams.value ?? 10);
          const curseBase = mParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(mParams.casterAtk || 1))
            : mHpInit;
          let curseDmg = Math.max(1, Math.round(curseBase * (cursePct / 100)));
          if (Number.isFinite(Number(mParams.maxDamage))) curseDmg = Math.min(curseDmg, Number(mParams.maxDamage));
          curseDmg = Math.max(1, Math.round(curseDmg * playerAttackLevelMult * wbDotMult)); // DOT 也吃等級壓制(世界王再吃 def%)
          if (_noPlayerAtk) curseDmg = 0;
          curseDmg = applyMonsterIncomingGuards(curseDmg);
          mHp -= curseDmg;
          totalDamage += curseDmg;
          _dotM.push(["影", curseDmg]);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 閃電：每回合對怪物造成 value% 最大 HP 電擊傷害
        if (mEff.key === 'lightning') {
          const lightPct = Number(mParams.value ?? 20);
          const lightBase = mParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(mParams.casterAtk || 1))
            : mHpInit;
          let lightDmg = Math.max(1, Math.round(lightBase * (lightPct / 100)));
          if (Number.isFinite(Number(mParams.maxDamage))) lightDmg = Math.min(lightDmg, Number(mParams.maxDamage));
          lightDmg = Math.max(1, Math.round(lightDmg * playerAttackLevelMult * wbDotMult)); // DOT 也吃等級壓制(世界王再吃 def%)
          if (_noPlayerAtk) lightDmg = 0;
          lightDmg = applyMonsterIncomingGuards(lightDmg);
          mHp -= lightDmg;
          totalDamage += lightDmg;
          _dotM.push(["雷", lightDmg]);
          if (mHp <= 0) { outcome = "win"; break; }
        }

      }
    }
    // 戰報重整：DOT 彙總一行（左敘事右數字；細項｜剩餘 HP）
    if (_dotM.length) {
      const _dt = _dotM.reduce((s, x) => s + x[1], 0);
      log.push(`☠️ 持續傷害侵蝕著 ${mName} —— **${_dt}**（${_dotM.map((x) => `${x[0]} ${x[1]}`).join("＋")}｜怪物剩 ${Math.max(0, mHp)} HP）`);
    }
    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 龍翼魔法師卡：每回合清除自身負面狀態 ──
    if (playerCleanseSelf && Array.isArray(options.playerActiveEffects)) {
      const beforeCleanse = options.playerActiveEffects.length;
      options.playerActiveEffects = options.playerActiveEffects.filter((e) => e && !PLAYER_DEBUFF_KEYS.includes(e.key));
      if (options.playerActiveEffects.length < beforeCleanse) {
        log.push(`✨ 你身上的負面狀態被淨化了！`);
      }
    }

    // ── 免疫負面（debuff_immunity，例如冰鱗龍人卡）：每回合濾掉異常類負面（沈默/中毒/燒傷/流血/降攻防/緩速等）──
    // 在 DOT 結算與沈默判定「之前」濾除，等於這些異常完全不生效；硬控仍由 control_immunity 處理。
    if (Array.isArray(options.playerActiveEffects) && playerHasDebuffImmunityActive(round)) {
      const beforeImmune = options.playerActiveEffects.length;
      options.playerActiveEffects = options.playerActiveEffects.filter((e) => e && !DEBUFF_IMMUNITY_KEYS.includes(e.key));
      if (options.playerActiveEffects.length < beforeImmune) {
        log.push(`🛡️ **免疫負面**！異常狀態被擋下。`);
      }
    }

    // ── 應用玩家的 DOT 效果（如中毒） ──
    // 怪物技能/DoT(雷擊/灼燒/流血/毒/詛咒…)對玩家的傷害，改成走玩家防禦(flatDef + def%)，
    // 與普攻同一條 applyDefense 管線 → 堆防禦對技能也有效，不再無視防禦秒人。
    // DOT 也走玩家防禦管線；末端再套防具同屬抗性（各處都是 mitigateDot 後才 log，故戰報數字正確）
    const mitigateDot = (dmg) => _applyElementDR(applyDefense(dmg, pStats.flatDef || 0, pStats.def || 0, mCalc.atk || 1));
    const _dotP = []; // 戰報重整：玩家承受的 DOT 彙總顯示（[標籤, 傷害]）
    if (Array.isArray(options.playerActiveEffects)) {
      for (const dotEffect of options.playerActiveEffects) {
        if (!dotEffect || !dotEffect.key) continue;
        const dotParams = dotEffect.params || {};
        const dotDuration = dotParams.duration || {};

        // 檢查效果是否仍在持續（"turns" 模式）
        if (dotDuration.mode === 'turns') {
          const appliedRound = dotEffect.appliedAt || 1;
          const endRound = appliedRound + (dotDuration.value || 1);
          if (round > endRound) continue; // 效果已過期
        }

        // 應用 DOT 傷害
        // heal_over_time 一律不在這裡結算：
        //   • target=party（治療師徽章）→ 只走「支援光環」路徑(依 INT 縮放到上限)，
        //     在這裡再算一次的話，光環提供者自己會多吃一份未縮放的 base%。
        //   • target=self（鐵甲衛將卡/城堡魔像卡）→ 統一交給回合末的 playerHotPct 彙總，
        //     那邊有滿血守衛、會和 life_regen 合併成一條戰報。兩邊都算＝卡片效果變成兩倍。
        // 舊版兩條路徑都跑，導致 5%→實際10%、15%→實際30%。

        if (dotEffect.key === 'poison') {
          const damagePercent = Number(dotParams.damagePercent ?? dotParams.value ?? 5);
          const dotBase = dotParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(dotParams.casterAtk || 1))
            : (pStats.maxHp || 1);
          let dotDmg = Math.max(1, Math.round(dotBase * (damagePercent / 100)));
          if (Number.isFinite(Number(dotParams.maxDamage))) dotDmg = Math.min(dotDmg, Number(dotParams.maxDamage));
          dotDmg = mitigateDot(dotDmg);
          dotDmg = _takePlayerIncomingDamage(dotDmg, round, { damageType: "magic", useSpirit: false });
          _dotP.push(["毒", dotDmg]);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
        // 流血 DOT（怪物施加給玩家）
        if (dotEffect.key === 'bleed') {
          const bleedPct = Number(dotParams.value ?? 10);
          const bleedBase = dotParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(dotParams.casterAtk || 1))
            : (pStats.maxHp || 1);
          let bleedDmg = Math.max(1, Math.round(bleedBase * (bleedPct / 100)));
          if (Number.isFinite(Number(dotParams.maxDamage))) bleedDmg = Math.min(bleedDmg, Number(dotParams.maxDamage));
          bleedDmg = mitigateDot(bleedDmg);
          bleedDmg = _takePlayerIncomingDamage(bleedDmg, round, { damageType: "physical", useSpirit: false });
          _dotP.push(["血", bleedDmg]);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
        // 燒傷 DOT（怪物施加給玩家）
        if (dotEffect.key === 'burn') {
          const burnPct = Number(dotParams.value ?? 0.5);
          const burnBase = dotParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(dotParams.casterAtk || 1))
            : (pStats.maxHp || 1);
          let burnDmg = Math.max(1, Math.round(burnBase * (burnPct / 100)));
          if (Number.isFinite(Number(dotParams.maxDamage))) burnDmg = Math.min(burnDmg, Number(dotParams.maxDamage));
          burnDmg = mitigateDot(burnDmg);
          burnDmg = _takePlayerIncomingDamage(burnDmg, round, { damageType: "magic", useSpirit: false });
          _dotP.push(["燒", burnDmg]);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
        // 閃電 DOT（怪物施加給玩家）
        if (dotEffect.key === 'lightning') {
          const lightPct = Number(dotParams.value ?? 20);
          const lightBase = dotParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(dotParams.casterAtk || 1))
            : (pStats.maxHp || 1);
          let lightDmg = Math.max(1, Math.round(lightBase * (lightPct / 100)));
          if (Number.isFinite(Number(dotParams.maxDamage))) lightDmg = Math.min(lightDmg, Number(dotParams.maxDamage));
          lightDmg = mitigateDot(lightDmg);
          lightDmg = _takePlayerIncomingDamage(lightDmg, round, { damageType: "magic", useSpirit: false });
          _dotP.push(["雷", lightDmg]);
          if (pHp <= 0) { outcome = "lose"; break; }
        }

        // 震盪 DOT（怪物施加給玩家）
        if (dotEffect.key === 'shock_dot') {
          const shockPct = Number(dotParams.value ?? 20);
          const shockBase = dotParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(dotParams.casterAtk || 1))
            : (pStats.maxHp || 1);
          let shockDmg = Math.max(1, Math.round(shockBase * (shockPct / 100)));
          if (Number.isFinite(Number(dotParams.maxDamage))) shockDmg = Math.min(shockDmg, Number(dotParams.maxDamage));
          shockDmg = mitigateDot(shockDmg);
          shockDmg = _takePlayerIncomingDamage(shockDmg, round, { damageType: "magic", useSpirit: false });
          _dotP.push(["震", shockDmg]);
          if (pHp <= 0) { outcome = "lose"; break; }
        }

        // 詛咒 DOT（怪物施加給玩家）
        if (dotEffect.key === 'curse_dot') {
          const cursePct = Number(dotParams.value ?? 20);
          const curseBase = dotParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(dotParams.casterAtk || 1))
            : (pStats.maxHp || 1);
          let curseDmg = Math.max(1, Math.round(curseBase * (cursePct / 100)));
          if (Number.isFinite(Number(dotParams.maxDamage))) curseDmg = Math.min(curseDmg, Number(dotParams.maxDamage));
          curseDmg = mitigateDot(curseDmg);
          curseDmg = _takePlayerIncomingDamage(curseDmg, round, { damageType: "magic", useSpirit: false });
          _dotP.push(["詛", curseDmg]);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
      }
    }

    // 戰報重整：玩家承受的 DOT 彙總一行
    if (_dotP.length) {
      const _dt = _dotP.reduce((s, x) => s + x[1], 0);
      log.push(`🩸 傷勢與毒火啃噬著你 —— **${_dt}**（${_dotP.map((x) => `${x[0]} ${x[1]}`).join("＋")}｜你剩 ${Math.max(0, pHp)} HP）`);
    }
    // 玩家被 DOT（中毒/流血/燒傷等）打死時，立刻結束本回合，避免之後的治療光環/世界王技能在死亡訊息後又被寫進戰報
    if (outcome === "lose") { roundLogs.push(log.join("\n")); break; }

    // ── 套用來自隊伍（party）的被動 aura，例如治療師提供的每回合回復 ──
    let roundDmgMultiplier = 1; // 每回合重置，累積本回合所有 party damage aura
    let roundBossDmgMultiplier = 1;
    let roundEliteDmgMultiplier = 1;
    let roundHighHpDmgBoostPct = 0;
    let roundStunnedDmgBoostPct = 0;
    let roundMonsterDefDownPct = 0;
    let roundPartyDefIgnorePct = 0;
    let roundPartyDamageReductionPct = 0;
    let roundPartyCritDamageReductionPct = 0;
    let roundPartyAgiBoostPct = 0; // 詩人 party_agi_up：影響當回合連擊率與閃避
    let roundPartyComboBoostPct = 0;
    let roundPartyCritRateBoostPct = 0; // 賭徒 party_crit_rate_up：影響當回合爆擊率
    try {
      // 光環不疊加:同一效果(key)只保留數值最高的提供者版本(跨 DC/網頁一致),
      // 連帶讓下方戰報「✨ 光環加持」也只列出最高的那個來源,不會每位提供者各列一行疊加。
      const _rawPartyEffects = Array.isArray(options.partyEffects) ? options.partyEffects : [];
      const _bestEffByKey = new Map();
      const _supportShotBySource = new Map();
      let _anonymousSupportShotNo = 0;
      for (const pe of _rawPartyEffects) {
        if (!pe || !pe.key) continue;
        // 聖者的外部治療必須在同 key 取最高前排除，否則隊友的較高值（或同值先入）
        // 會先蓋掉自己的光環，再被外部治療規則取消，連自己的回血化刃也會消失。
        const isHealAura = pe.key === "heal_over_time" || pe.key === "party_heal";
        if (_healToDamage > 0 && isHealAura && pe.isSelfAura !== true) continue;
        // 一般光環同 key 只取最高；掩護射擊則是每名神射手各一箭。
        // 同一提供者可能同時從參戰名單與跨平台光環被收集，仍只保留較強的一份。
        if (pe.key === "support_shot") {
          const sourceKey = String(pe.sourceDiscordId || pe.sourceName || `anonymous:${_anonymousSupportShotNo++}`);
          const score = Math.max(0, Number(pe.params?.casterAtk) || 0)
            * Math.max(0, Number(pe.params?.value ?? pe.value) || 0)
            * Math.max(0.01, Number(pe.params?.casterFinalDamageMult) || 1);
          const prev = _supportShotBySource.get(sourceKey);
          if (!prev || score > prev.score) _supportShotBySource.set(sourceKey, { effect: pe, score });
          continue;
        }
        const v = Math.abs(Number(pe.params?.value ?? pe.value ?? 0));
        const prev = _bestEffByKey.get(pe.key);
        const pv = prev ? Math.abs(Number(prev.params?.value ?? prev.value ?? 0)) : -Infinity;
        if (v > pv) _bestEffByKey.set(pe.key, pe);
      }
      const partyEffects = [
        ..._bestEffByKey.values(),
        ...Array.from(_supportShotBySource.values(), (entry) => entry.effect),
      ];
      const auraDetails = new Map(), auraTickLines = []; // 宣告與每回合實際結算分開，避免前端把說明當回血
      for (const pe of partyEffects) {
        if (!pe || !pe.key) continue;
        const providerName = pe.sourceName || "未知";
        // 分組鍵＝提供者＋來源標籤：同一玩家的「職業光環」與「裝備光環（錨點等）」分開列，
        // 括號標籤才不會張冠李戴（例：錨點光環曾被標成「盜賊徽章」）
        const sourceName = `${providerName}｜${pe.sourceJobName || ""}`;
        if (!auraDetails.has(sourceName)) {
          auraDetails.set(sourceName, {
            providerName,
            jobName: pe.sourceJobName || null,
            heal: 0,
            dmgBoost: 0,
            bossDmgBoost: 0,
            eliteDmgBoost: 0,
            highHpDmgBoost: 0,
            stunnedDmgBoost: 0,
            defDown: 0,
            defIgnore: 0,
            damageReduction: 0,
            critReduction: 0,
            agiBoost: 0,
            comboBoost: 0,
            critRateBoost: 0,
            supportShot: 0
          });
        }

        // 支援治療 over-time 的簡單實作：key 可為 'heal_over_time' 或自訂 'party_heal'
        if (pe.key === 'heal_over_time' || pe.key === 'party_heal') {
          const mode = String(pe.params?.mode || '').toLowerCase();
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (!Number.isFinite(val) || val === 0) continue;
          // 註：這條是「隊友支援光環」路徑，supportAuraScaling 本來就會依提供者 INT 縮放，
          //     不可以在這裡再加一次 INT 斜率（會變雙重縮放）。自己的 HOT 走回合末 playerHotPct。
          const heal = mode === 'pct' ? Math.max(0, Math.round((pStats.maxHp || 0) * (val / 100))) : Math.max(0, Math.round(val));
          if (heal > 0) {
            // 聖者（heal_to_damage）：外部治療已在同 key 取最高前排除；
            // 自己的治療光環照走 _healPlayer → 即使滿血也按錨點設定倍率轉成傷害。
            if (_healToDamage > 0 && pe.isSelfAura === false) continue;
            const _mBefore = mHp;
            const _pBeforeHeal = pHp;
            pHp = _healPlayer(heal, { externalAura: pe.isSelfAura === false }); const _actualHeal = Math.max(0, pHp - _pBeforeHeal);
            // KDA：外部治療光環只歸戶有效量（滿血溢出不計）
            if (pe.isSelfAura === false && pe.sourceDiscordId && _healToDamage <= 0) {
              if (_actualHeal > 0) _kdaHealBySource.set(pe.sourceDiscordId, (_kdaHealBySource.get(pe.sourceDiscordId) || 0) + _actualHeal);
            }
            const detail = auraDetails.get(sourceName);
            if (_healToDamage > 0) {
              // 聖者：自己的治療化為傷害 → 戰報明講（避免玩家看到「回復」誤會）
              const _dealt = _mBefore - mHp;
              if (_dealt > 0) log.push(`🩸 **聖者・回血化刃**！對 ${mName} 造成 **${_dealt}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              detail.healToDmg = (detail.healToDmg || 0) + Math.max(0, _dealt);
            } else {
              detail.heal = heal;
              if (_actualHeal > 0) auraTickLines.push(`💚 **回合開始・${providerName}的治療光環**！回復 **${_actualHeal}** HP！（你剩 ${pHp} / ${pStats.maxHp}）`);
            }
          }
        }
        // 掩護射擊（神射手）：區內神射手每回合替你補一箭——傷害型「光環」，
        // 吃提供者的 ATK/爆擊（出戰當下快照）、目標防禦與部位/屬性倍率；世界王結算時歸戶給提供者
        if (pe.key === 'support_shot') {
          const _ssPct = Number(pe.params?.value ?? 0);
          const _ssAtk = Math.max(0, Number(pe.params?.casterAtk) || 0);
          // 自己出戰時不吃自己的掩護（人在前線就沒人在高處放箭）
          if (pe.isSelfAura !== true && _ssPct > 0 && _ssAtk > 0 && outcome === null && mHp > 0) {
            let ssDmg = Math.max(1, Math.round(_ssAtk * _ssPct / 100));
            ssDmg = Math.max(1, Math.round(applyDefense(ssDmg, adjustedMCalc.flatDef || 0, Math.max(0, Math.min(95, adjustedMCalc.def || 0)), _ssAtk)));
            const ssCrit = Math.random() * 100 < Math.max(0, Number(pe.params?.casterCrit) || 0);
            if (ssCrit) ssDmg = Math.max(1, Math.round(ssDmg * 2));
            // 掩護箭的攻擊者是提供光環的神射手：終傷與武器屬性都必須吃提供者快照，
            // 不能借用正在出戰玩家的武器屬性、屬性卡或吟遊演奏倍率。
            const _ssElement = resolveWeaponElement({ weapon: { elements: pe.params?.casterElements || {} } }, monsterElement);
            const _ssElementMult = getElementMultiplier(_ssElement.element, monsterElement, _ssElement.level, monsterElementLevel);
            const _ssElementBonusPct = Math.max(0, Number(pe.params?.casterBonusVsElement?.[monsterElement]) || 0);
            const _ssFinalMult = Math.max(0.01, Number(pe.params?.casterFinalDamageMult) || 1);
            const _ssTotalMult = bossVulnMult * _ssFinalMult * _ssElementMult * (1 + _ssElementBonusPct / 100);
            if (_ssTotalMult !== 1) ssDmg = Math.max(1, Math.round(ssDmg * _ssTotalMult));
            if (ssDmg > 0) {
              mHp -= ssDmg;
              totalDamage += ssDmg;
              const _srcKey = String(pe.sourceDiscordId || pe.sourceName || "掩護");
              combatStats.supportShotBySource[_srcKey] = (combatStats.supportShotBySource[_srcKey] || 0) + ssDmg;
              log.push(`🏹 ${ssCrit ? "✨**會心**！" : ""}**${providerName}** 的掩護射擊！對 ${mName} 造成 **${ssDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              const detail = auraDetails.get(sourceName);
              if (detail) detail.supportShot = _ssPct;
              if (mHp <= 0) { outcome = "win"; }
            }
          }
        }
        // 支援隊伍傷害加成（每回合生效）
        if (pe.key === 'party_damage_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            roundDmgMultiplier *= (1 + val / 100);
            const detail = auraDetails.get(sourceName);
            detail.dmgBoost = val;
          }
        }
        if (pe.key === 'party_boss_damage_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            if (options.monsterIsBoss) roundBossDmgMultiplier *= (1 + val / 100);
            const detail = auraDetails.get(sourceName);
            detail.bossDmgBoost = val;
          }
        }
        if (pe.key === 'party_elite_damage_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            if (options.monsterIsElite && !options.monsterIsBoss) roundEliteDmgMultiplier *= (1 + val / 100);
            const detail = auraDetails.get(sourceName);
            detail.eliteDmgBoost = val;
          }
        }
        if (pe.key === 'party_high_hp_damage_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            roundHighHpDmgBoostPct += val;
            const detail = auraDetails.get(sourceName);
            detail.highHpDmgBoost = val;
          }
        }
        if (pe.key === 'party_stunned_damage_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            roundStunnedDmgBoostPct += val;
            const detail = auraDetails.get(sourceName);
            detail.stunnedDmgBoost = val;
          }
        }
        if (pe.key === 'party_monster_def_down') {
          const val = Math.abs(Number(pe.params?.value ?? pe.value ?? 0));
          if (Number.isFinite(val) && val !== 0) {
            roundMonsterDefDownPct += val;
            const detail = auraDetails.get(sourceName);
            detail.defDown = val;
          }
        }
        if (pe.key === 'party_def_ignore_up') {
          const val = Math.abs(Number(pe.params?.value ?? pe.value ?? 0));
          if (Number.isFinite(val) && val !== 0) {
            roundPartyDefIgnorePct += val;
            const detail = auraDetails.get(sourceName);
            detail.defIgnore = val;
          }
        }
        if (pe.key === 'party_damage_reduction') {
          const val = Math.abs(Number(pe.params?.value ?? pe.value ?? 0));
          if (Number.isFinite(val) && val !== 0) {
            roundPartyDamageReductionPct += val;
            if (pe.isSelfAura === false && pe.sourceDiscordId) _kdaDrSourceId = pe.sourceDiscordId; // KDA：減傷歸戶對象
            const detail = auraDetails.get(sourceName);
            detail.damageReduction = val;
          }
        }
        if (pe.key === 'party_crit_damage_reduction') {
          const val = Math.abs(Number(pe.params?.value ?? pe.value ?? 0));
          if (Number.isFinite(val) && val !== 0) {
            roundPartyCritDamageReductionPct += val;
            if (pe.isSelfAura === false && pe.sourceDiscordId) _kdaCritDrSourceId = pe.sourceDiscordId; // KDA：爆傷減免歸戶對象
            const detail = auraDetails.get(sourceName);
            detail.critReduction = val;
          }
        }
        if (pe.key === 'party_agi_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            roundPartyAgiBoostPct += val;
            const detail = auraDetails.get(sourceName);
            detail.agiBoost = val;
          }
        }
        if (pe.key === 'party_combo_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            roundPartyComboBoostPct += val;
            const detail = auraDetails.get(sourceName);
            detail.comboBoost = val;
          }
        }
        if (pe.key === 'party_crit_rate_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            roundPartyCritRateBoostPct += val;
            const detail = auraDetails.get(sourceName);
            detail.critRateBoost = val;
          }
        }
      }

      // 第 1 回合宣告全部光環加持（整理成單一區塊，每位提供者一行；後續回合略過）
      if (round === 1) {
        const auraLines = [];
        for (const [, detail] of auraDetails) {
          const parts = [];
          if (detail.dmgBoost !== 0) parts.push(`傷害提升 ${detail.dmgBoost}%`);
          if (detail.bossDmgBoost !== 0) parts.push(`Boss 傷害提升 ${detail.bossDmgBoost}%`);
          if (detail.eliteDmgBoost !== 0) parts.push(`精英傷害提升 ${detail.eliteDmgBoost}%`);
          if (detail.highHpDmgBoost !== 0) parts.push(`對高血量怪物傷害提升 ${detail.highHpDmgBoost}%`);
          if (detail.stunnedDmgBoost !== 0) parts.push(`對暈眩目標傷害提升 ${detail.stunnedDmgBoost}%`);
          if (detail.defDown > 0) parts.push(`怪物防禦降低 ${detail.defDown}%`);
          if (detail.defIgnore > 0) parts.push(`無視防禦 ${detail.defIgnore}%`);
          if (detail.damageReduction > 0) parts.push(`受到傷害降低 ${detail.damageReduction}%`);
          if (detail.critReduction > 0) parts.push(`被暴擊傷害降低 ${detail.critReduction}%`);
          if (detail.agiBoost > 0) parts.push(`AGI +${detail.agiBoost}%（連擊/閃避提升）`);
          if (detail.comboBoost > 0) parts.push(`連擊率 +${detail.comboBoost}%`);
          if (detail.critRateBoost > 0) parts.push(`爆擊率 +${detail.critRateBoost}%`);
          if (detail.heal > 0) parts.push(`治療光環：回合開始時治療 ${detail.heal} HP`); // 「回復 N HP」只給當下的實際數值事件
          if (detail.supportShot > 0) parts.push(`掩護射擊（每回合一箭・ATK ${detail.supportShot}%）`);
          if (detail.healToDmg > 0) parts.push(`🩸 聖者：回血化為傷害（本回合 ${detail.healToDmg}）`);
          if (parts.length === 0) continue;
          const jobTag = detail.jobName ? `（${detail.jobName}）` : "";
          const who = (detail.providerName && detail.providerName !== "未知") ? `${detail.providerName}${jobTag}` : (detail.jobName || "光環");
          auraLines.push(`　• ${who}：${parts.join("、")}`);
        }
        if (auraLines.length > 0) {
          log.push("✨ **光環加持**");
          for (const line of auraLines) log.push(line);
        }
      }
      for (const line of auraTickLines) log.push(line);
    } catch (e) {}
    // 掩護射擊可能在光環階段就終結怪物（低血量雜魚）→ 直接收場
    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 破釜沉舟（兵聖）：區間內全部玩家傷害 ×mult（乘進 roundDmgMultiplier，主擊/反擊全吃）──
    const _sageAllInNow = Boolean(sageCfg) && round >= _sageAllInFrom && _sageAllInFrom > 0 && round <= _sageAllInUntil;
    if (_sageAllInNow) {
      roundDmgMultiplier *= Number(sageCfg.allin?.mult) || 3;
      log.push(`🚩 **破釜沉舟**生效中——本回合傷害 ×${Number(sageCfg.allin?.mult) || 3}！`);
    }

    const monsterIsStunned = stunRoundsLeft > 0;
    const getRoundTargetDamageMultiplier = () => {
      let multiplier = 1;
      if (roundHighHpDmgBoostPct > 0 && mHp > mHpInit * 0.5) {
        multiplier *= (1 + roundHighHpDmgBoostPct / 100);
      }
      if (roundStunnedDmgBoostPct > 0 && _targetStunnedNow(round)) {
        multiplier *= (1 + roundStunnedDmgBoostPct / 100);
      }
      return multiplier;
    };

    // 敏捷壓制代表怪物該回合跟不上玩家的行動節奏，不只不能普攻反擊，
    // 也不能在回合開頭繞過壓制先施放主動卡片技能。
    const monsterActionSuppressedByAgi = (hasAgiFirstStrike && round === 1)
      || (hasAgiSlowedMonster && round % 2 !== 0);

    // 怪物自身的卡片技能
    const monsterEquipped = options.monsterEquipped || {};
    const monsterHasCardSkill = !!(monsterEquipped.special_1?.monsterCardSkill?.key);
    if (monsterIsStunned && monsterHasCardSkill) {
      log.push(`😵 ${mName} 仍處於擊暈狀態，無法發動技能！`);
    } else if (monsterIsSilenced && monsterHasCardSkill) {
      log.push(`🔇 ${mName} 陷入沉默，無法發動技能！`);
    }
    if (options.skipMonsterAttack !== true && !monsterActionSuppressedByAgi && !monsterIsStunned && !monsterIsSilenced && monsterEquipped.special_1 && monsterEquipped.special_1.monsterCardSkill && monsterEquipped.special_1.monsterCardSkill.key) {
      const equippedCard = monsterEquipped.special_1;
      const skill = equippedCard.monsterCardSkill;
      const cardName = equippedCard.itemName || equippedCard.name || '卡片';
      const monsterHpPct = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
      const playerHpPct = pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100;

      // 怪物增益效果（施加給怪物自己）
      const MONSTER_BUFF_KEYS = new Set(['str_up', 'agi_up', 'def_up', 'atk_up', 'lifesteal', 'life_steal_strong', 'crit_rate_up', 'crit_damage_up', 'dodge_up', 'damage_reduction', 'def_ignore', 'final_damage_up', 'atk_multiplier_up', 'counter', 'ancient_power', 'invincible_short']);
      // 怪物DEBUFF效果（施加給玩家）
      const MONSTER_DEBUFF_KEYS = new Set(['poison', 'bleed', 'burn', 'atk_down', 'def_down', 'hit_down', 'hit_rate_down', 'agi_down', 'silence', 'freeze', 'stun', 'charm', 'lightning', 'dark_curse']);

      const cooldownKey = equippedCard.itemId || equippedCard.id || cardName;
      const triggerChance = Math.min(100, Math.max(0, Number(skill.chance ?? equippedCard.cardProcChance ?? 30)));
      const procEffects = Array.isArray(skill.procEffects) ? skill.procEffects : [];
      const hpGatedEffects = procEffects.filter(effectHasHpThreshold);
      const normalProcEffects = hpGatedEffects.length > 0 ? procEffects.filter((effect) => !effectHasHpThreshold(effect)) : procEffects;

      if (hpGatedEffects.length > 0) {
        const result = applyCardProcEffects({
          procEffects: hpGatedEffects,
          ownerHpPct: monsterHpPct,
          targetHpPct: playerHpPct,
          round,
          sourceType: 'monster_skill',
          cardName,
          skillName: skill.name || cardName,
          skillDescription: _descOnce(skill.name, skill.description || ''),
          cooldownBucket: cardCooldowns.monster,
          cooldownKey,
          cooldownTurns: Number(skill.cooldownTurns) || 0,
          triggerChance,
            ownerActiveEffects: monsterActiveEffects,
            targetActiveEffects: options.playerActiveEffects || [],
            ownerLabel: mName,
            sourceAtk: adjustedMCalc.atk || mCalc.atk || 1,
            ownerMaxHp: mHpInit || mHp || 1,
            targetMaxHp: pStats.maxHp || pHp || 1,
            targetLabel: '你',
            // 日之精靈：怪物技能傷害也先由精靈承受（代承是「所有攻擊」，不是只有普攻）
          applyTargetDamage: (damage) => {
            const mitigated = _spiritHp > 0
              ? damage
              : _applyElementDR(applyDefense(damage, pStats.flatDef || 0, pStats.def || 0, mCalc.atk || 1));
            return { remainingHp: pHp, actualDamage: _takePlayerIncomingDamage(mitigated, round, { damageType: "magic" }) };
          },
          applyOwnerHeal: (heal) => {
            const before = mHp;
            mHp = Math.min(mHpInit, mHp + reduceMonsterHeal(heal));
            return { remainingHp: mHp, actualHeal: Math.max(0, mHp - before) };
          },
          applySpecialEffect: (procEffect) => {
            if (!['proc_extra_hit', 'proc_chain_hit'].includes(procEffect.key)) return false;
            const pp = procEffect.params || {};
            const hits = procEffect.key === 'proc_chain_hit'
              ? Math.max(1, Math.floor(Number(pp.chainCount ?? 3)))
              : 1;
            const pct = Number(pp.damageMultiplier ?? pp.value ?? (procEffect.key === 'proc_chain_hit' ? 0.3 : 0.5));
            let total = 0;
            for (let i = 0; i < hits && pHp > 0; i++) {
              const damage = Math.max(1, Math.round((adjustedMCalc.atk || mCalc.atk || 1) * pct));
              const mitigated = _spiritHp > 0
                ? damage
                : _applyElementDR(applyDefense(damage, pStats.flatDef || 0, pStats.def || 0, mCalc.atk || 1));
              total += _takePlayerIncomingDamage(mitigated, round, { damageType: "physical" });
            }
            log.push(`✨ **${mName}** 發動【${skill.name || cardName}】${hits > 1 ? `連擊 ${hits} 次` : '追擊'}，共造成 **${total}** 點傷害！`);
            return true;
          },
          buffKeys: MONSTER_BUFF_KEYS,
          debuffKeys: MONSTER_DEBUFF_KEYS,
          sourceId: equippedCard.uuid || equippedCard.itemId || equippedCard.id || cardName,
          log
        });
        monsterActiveEffects = result.ownerActiveEffects;
        options.playerActiveEffects = result.targetActiveEffects;
      }

      if (normalProcEffects.length > 0 && (cardCooldowns.monster[cooldownKey] || 0) <= 0 && Math.random() * 100 < triggerChance) {
        if (Number(skill.cooldownTurns) > 0) cardCooldowns.monster[cooldownKey] = Number(skill.cooldownTurns);
        let appliedAnyNormalProc = false;
        // 即時傷害/治療效果會自帶「發動【技能】…造成X傷害」的完整 log；
        // 若有此類效果，回合結尾就不再補印通用「發動【技能】」行，避免同一技能顯示兩次（第二次無傷害）。
        let loggedImmediateNormalProc = false;

        for (const rawProcEffect of normalProcEffects) {
          if (!rawProcEffect || !rawProcEffect.key) continue;
          const procEffect = normalizeCardProcEffect(rawProcEffect);
          const currentMonsterHpPct = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
          const currentPlayerHpPct = pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100;
          if (!procEffectApplies(procEffect, currentMonsterHpPct, currentPlayerHpPct)) continue;
          const procChance = Number.isFinite(Number(procEffect.chance))
            ? Math.min(100, Math.max(0, Number(procEffect.chance)))
            : 100;
          if (Math.random() * 100 >= procChance) continue;
          const pp = procEffect.params || {};
          const targetHadDebuff = procEffect.target === 'self'
            ? hasAnyDebuff(monsterActiveEffects, round)
            : hasAnyDebuff(options.playerActiveEffects || [], round);
          const bonusValue = Number(pp.bonusIfTargetDebuffed);
          const equippedBonusValue = Number(pp.bonusIfEquippedValue);
          const hasEquippedBonus = Number.isFinite(equippedBonusValue)
            && (
              hasEquippedNames(monsterEquipped, pp.bonusIfEquippedNames)
              || hasAnyEquippedName(monsterEquipped, pp.bonusIfEquippedAnyNames)
            );
          if (applyImmediateCardDamageEffect({
            procEffect,
            ownerLabel: mName,
            skillName: skill.name || cardName,
            skillDescription: _descOnce(skill.name, skill.description || ''),
            targetLabel: '你',
            sourceAtk: adjustedMCalc.atk || mCalc.atk || 1,
            targetMaxHp: pStats.maxHp || pHp || 1,
            applyTargetDamage: (damage) => {
              return { remainingHp: pHp, actualDamage: _takePlayerIncomingDamage(damage, round, { damageType: "magic" }) };
            }, // 日之精靈代承技能傷害
            // 即時技能也吃玩家防禦＋同屬抗性——王技能＝屬性攻擊，這就是「魔防」
            mitigate: (d) => _spiritHp > 0
              ? d
              : _applyElementDR(applyDefense(d, pStats.flatDef || 0, pStats.def || 0, mCalc.atk || 1)),
            // G6：巨額技能單發拆段（門檻與普攻同一常數；格擋率用姿態/面板基礎值——
            // 本回合的臨時格擋加成在玩家回合才計算，技能先手時尚不存在）
            g6: {
              threshold: G6_SEG_REF,
              maxSegs: G6_MAX_SEGS,
              blockChance: Math.min(95, Number.isFinite(Number(battleStance?.blockChance))
                ? Number(battleStance.blockChance)
                : (pStats.blockChance || 0)),
            },
            log
          })) {
            appliedAnyNormalProc = true;
            loggedImmediateNormalProc = true;
            continue;
          }
          const effectEntry = makeCardEffectEntry(
            procEffect,
            round,
            'monster_skill',
            hasEquippedBonus
              ? { value: equippedBonusValue }
              : (targetHadDebuff && Number.isFinite(bonusValue) ? { value: bonusValue } : {}),
            equippedCard.uuid || equippedCard.itemId || equippedCard.id || cardName
          );
          effectEntry.params.sourceName = mName;
          if (applyImmediateCardHealEffect({
            procEffect,
            ownerLabel: mName,
            skillName: skill.name || cardName,
            skillDescription: _descOnce(skill.name, skill.description || ''),
            targetLabel: mName,
            sourceAtk: adjustedMCalc.atk || mCalc.atk || 1,
            targetMaxHp: mHpInit || mHp || 1,
            applyTargetHeal: (heal) => {
              const before = mHp;
              mHp = Math.min(mHpInit, mHp + reduceMonsterHeal(heal));
              return { remainingHp: mHp, actualHeal: Math.max(0, mHp - before) };
            },
            log
          })) {
            appliedAnyNormalProc = true;
            loggedImmediateNormalProc = true;
            continue;
          }
          if (effectEntry.params.mode === 'caster_atk_pct') effectEntry.params.casterAtk = adjustedMCalc.atk || mCalc.atk || 1;
          // 根據效果類型決定施加對象
          if (procEffect.target === 'self' || MONSTER_BUFF_KEYS.has(procEffect.key)) {
            // 怪物增益 → 施加給怪物（同 key 先清舊的，防止乘法疊加）
            monsterActiveEffects = addOrStackCardEffect(monsterActiveEffects, effectEntry);
            appliedAnyNormalProc = true;
          } else if (procEffect.target === 'enemy' || MONSTER_DEBUFF_KEYS.has(procEffect.key)) {
            effectEntry.appliedAt = round - 1;
            // 怪物DEBUFF → 施加給玩家（同 key 先清舊的，防止 DOT 疊加）
            if (!options.playerActiveEffects) options.playerActiveEffects = [];
            options.playerActiveEffects = addOrStackCardEffect(options.playerActiveEffects, effectEntry);
            appliedAnyNormalProc = true;
          }
        }
        if (appliedAnyNormalProc && !loggedImmediateNormalProc) {
          log.push(`🎴 **${mName}** 發動【${skill.name || cardName}】！${_descOnce(skill.name || cardName, skill.description || '')}`);
        }
      }
    }

    // 玩家被怪物即時技能（如王者雷擊）打到 HP <= 0 → 立刻判定戰敗，避免在負血狀態繼續行動/吸血
    if (pHp <= 0 && outcome === null) {
      outcome = "lose";
      roundLogs.push(log.join("\n"));
      break;
    }

    // ── 世界王雷擊術（第二 / 第三階段）──
    if (options.skipMonsterAttack !== true && worldBossHasLightning) {
      if (Math.random() * 100 < worldBossLightningHitChance) {
        // 生命%傷：算完最大生命 × pct 後，也走玩家防禦(flatDef + def%)，不再無視防禦
        const lightningRaw = Math.max(1, Math.round(Math.max(1, pStats.maxHp || pHp) * (worldBossLightningHpPct / 100)));
        let lightningDmg = _spiritHp > 0
          ? lightningRaw
          : _applyElementDR(applyDefense(lightningRaw, pStats.flatDef || 0, pStats.def || 0, mCalc.atk || 1));
        lightningDmg = _takePlayerIncomingDamage(lightningDmg, round, { damageType: "magic" });
        log.push(`⚡ ${mName} 施放【雷擊術】命中！造成 **${lightningDmg}** 點傷害（最大生命 ${worldBossLightningHpPct}%）！（你剩 ${Math.max(0, pHp)} HP）`);
        if (pHp <= 0) {
          outcome = "lose";
          roundLogs.push(log.join("\n"));
          break;
        }
      } else {
        log.push(`⚡ ${mName} 施放【雷擊術】但未命中。`);
      }
    }
    if (worldBossHasAgiSuppress && !worldBossAgiAnnounced) {
      worldBossAgiAnnounced = true;
      log.push(`💨 ${mName} 進入第三階段，AGI 提升 **+${worldBossAgiBonus}**！`);
    }

    // ── 玩家攻擊 ──
    // （戰報重整 2026-08-02：回合分隔線移除——行首圖示已能分辨敵我，每回合省 2 行）
    const attackCount = pStats.isDualWield ? 2 : 1;
    // 雙持副手那一擊的傷害倍率。原本副手是「完整第二次攻擊」(等於傷害 ×2)，
    // 實測輸出是單手劍+盾的 1.55 倍，遠勝雙手大劍的 1.10 倍 → 副手打折。
    // 倍率套在 attackBase 與武器主屬性追加傷害上，因此主擊/連擊/爆擊/多段全部一起縮放。
    const OFFHAND_DAMAGE_MULT = 0.6;
    // 擊暈中：怪物無法閃避

    // ── 檢查玩家受到的狀態效果（怪物施加的 debuff）──
    let playerIsStunned = false;
    let playerIsFrozen = false;
    let playerIsSilenced = false;
    let playerIsSleeping = false;
    let playerIsFearful = false;
    let playerIsRooted = false;
    let playerIsBlinded = false;
    let playerIsDisarmed = false;
    let playerIsConfused = false;
    let playerHasControlImmunity = false;
    let playerHasDebuffImmunity = false;
    if (Array.isArray(options.playerActiveEffects)) {
      // 先掃免疫
      for (const pEff of options.playerActiveEffects) {
        if (!pEff || !pEff.key) continue;
        const pDur = pEff.params?.duration || {};
        if (pDur.mode === 'turns') {
          const pEnd = (pEff.appliedAt || 1) + (pDur.value || 1);
          if (round > pEnd) continue;
        }
        if (pEff.key === 'control_immunity') playerHasControlImmunity = true;
        if (pEff.key === 'debuff_immunity') playerHasDebuffImmunity = true;
      }
      for (const pEff of options.playerActiveEffects) {
        if (!pEff || !pEff.key) continue;
        const pDur = pEff.params?.duration || {};
        if (pDur.mode === 'turns') {
          const pEnd = (pEff.appliedAt || 1) + (pDur.value || 1);
          if (round > pEnd) continue;
        }
        const isControl = ['stun','freeze','sleep','fear','root','blind','disarm','confuse','taunt','charm'].includes(pEff.key);
        if (isControl && playerHasControlImmunity) continue;
        if (pEff.key === 'stun') {
          const stunChance = Number(pEff.params?.value ?? 100);
          if (Math.random() * 100 < stunChance) playerIsStunned = true;
        } else if (pEff.key === 'freeze') {
          if (round % 2 !== 0) playerIsFrozen = true;
        } else if (pEff.key === 'sleep') {
          playerIsSleeping = true;
        } else if (pEff.key === 'fear') {
          const fearChance = Number(pEff.params?.value ?? 30);
          if (Math.random() * 100 < fearChance) playerIsFearful = true;
        } else if (pEff.key === 'root') {
          playerIsRooted = true;
        } else if (pEff.key === 'blind') {
          playerIsBlinded = true;
        } else if (pEff.key === 'disarm') {
          playerIsDisarmed = true;
        } else if (pEff.key === 'confuse') {
          playerIsConfused = true;
        } else if (pEff.key === 'silence') {
          playerIsSilenced = true;
        }
      }
    }
    // Sleep/fear/confuse 等同 stun（skip action）
    if (playerIsSleeping || playerIsFearful) playerIsStunned = true;
    if (playerIsStunned) {
      log.push(`😵 **擊暈**！你無法行動，此回合無法攻擊！`);
    } else if (playerIsSleeping) {
      log.push(`💤 **沉睡**！你陷入夢中，此回合無法行動！`);
    } else if (playerIsFearful) {
      log.push(`😨 **恐懼**！你嚇得無法動作！`);
    } else if (playerIsFrozen) {
      log.push(`🧊 **冰凍**！行動遲緩，此回合無法攻擊！`);
    } else if (playerIsRooted) {
      log.push(`🌿 **定身**！你被困住，本回合受擊閃避降為 0！`);
    } else if (hasBossAgiFirstStrike && round === 1) {
      playerIsFrozen = true;
      log.push(`💨 ${mName} 速度壓制！你無法搶到先手，本回合無法攻擊！`);
    } else if (hasBossAgiTurnSuppress && round % 2 !== 0) {
      playerIsFrozen = true;
      log.push(`💨 ${mName} 速度全面壓制！你本回合行動被壓制。`);
    }

    // 玩家裝備的卡片技能（special_1/2/3 獨立觸發）
    // 沉默（怪物施加）：玩家無法發動卡片技能
    if (playerIsSilenced) {
      log.push(`🔇 **${playerBattleName}** 陷入沉默，此回合無法發動卡片技能！`);
    }
    // 攻擊型效果（施加給怪物）；其餘增益型效果施加給玩家
    const PLAYER_CARD_OFFENSIVE_KEYS = new Set([
      'atk_down', 'def_down', 'poison', 'bleed', 'burn', 'freeze', 'stun',
      'silence', 'charm', 'lightning', 'freeze_slow', 'hit_down', 'hit_rate_down',
      'agi_down', 'dark_curse'
      // dark_curse / life_steal_strong / ancient_power → 施加給玩家，見下方 playerActiveEffects
    ]);
    const PLAYER_CARD_BUFF_KEYS = new Set([
      'atk_up', 'str_up', 'agi_up', 'vit_up', 'int_up', 'dex_up', 'luk_up',
      'def_up', 'dodge_up', 'hit_up', 'crit_rate_up', 'crit_damage_up',
      'block_chance_up', 'damage_reduction', 'physical_damage_reduction',
      'magic_damage_reduction', 'invincible_short', 'shield', 'barrier',
      'lifesteal', 'life_steal_strong', 'final_damage_up', 'def_ignore',
      'heal_over_time', 'life_regen', 'counter', 'counter_attack',
    ]);
    const specialSlots = ['special_1', 'special_2', 'special_3'];
    for (const slot of specialSlots) {
      const slotItem = options.equipped?.[slot];
      if (!_noPlayerAtk && !playerIsStunned && !playerIsFrozen && !playerIsSilenced && slotItem && slotItem.monsterCardSkill && slotItem.monsterCardSkill.key
          && slotItem.monsterCardSkill.trigger !== 'on_dodge') { // on_dodge 卡改在「玩家閃避」時觸發，不在此回合觸發
        const skill = slotItem.monsterCardSkill;
        const cardName = slotItem.itemName || slotItem.name || '卡片';
        const playerHpPct = pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100;
        const monsterHpPct = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;

        const cooldownKey = slotItem.itemId || slotItem.id || `${slot}:${cardName}`;
        const triggerChance = Math.min(100, Math.max(0, Number(skill.chance ?? slotItem.cardProcChance ?? 5)));
        const procEffects = Array.isArray(skill.procEffects) ? skill.procEffects : [];
        const hpGatedEffects = procEffects.filter(effectHasHpThreshold);
        const normalProcEffects = hpGatedEffects.length > 0 ? procEffects.filter((effect) => !effectHasHpThreshold(effect)) : procEffects;

        let hpGatedAppliedThisRound = false;
        if (hpGatedEffects.length > 0) {
          const result = applyCardProcEffects({
            procEffects: hpGatedEffects,
            ownerHpPct: playerHpPct,
            targetHpPct: monsterHpPct,
            round,
            sourceType: 'player_card',
            cardName,
            skillName: skill.name || cardName,
            skillDescription: _descOnce(skill.name, skill.description || ''),
            cooldownBucket: cardCooldowns.player,
            cooldownKey,
            cooldownTurns: Number(skill.cooldownTurns) || 0,
            triggerChance,
            ownerActiveEffects: options.playerActiveEffects || [],
            targetActiveEffects: monsterActiveEffects,
            ownerLabel: playerBattleName,
            sourceAtk: pStats.atk || 1,
            ownerMaxHp: pStats.maxHp || pHp || 1,
            targetMaxHp: mHpInit || mHp || 1,
            targetLabel: mName,
            // 玩家卡即時傷害要計入總傷害(否則世界王落地會回彈)，且必須與主擊走同一道檢傷：
            // 部位弱點/屬性相剋/演奏加成(playerHitMult) 與怪物減傷/承傷/無敵/單擊上限都要吃到。
            // ⚠️ 一定要回傳 { remainingHp, actualDamage }：呼叫端在拿到非物件時會退回用「檢傷前」的
            //    原始值寫戰報（見 applyImmediateCardDamageEffect），扣血正確但玩家看到的數字是錯的。
            applyTargetDamage: (damage) => {
              const d = applyMonsterIncomingGuards(damage);
              mHp -= d; totalDamage += Math.max(0, Number(d) || 0);
              return { remainingHp: mHp, actualDamage: d };
            },
            applyOwnerHeal: (heal) => {
              const before = pHp;
              pHp = _healPlayer(heal);
              return { remainingHp: pHp, actualHeal: Math.max(0, pHp - before) };
            },
            applySpecialEffect: (procEffect) => {
              if (!['proc_extra_hit', 'proc_chain_hit'].includes(procEffect.key)) return false;
              const pp = procEffect.params || {};
              const hits = procEffect.key === 'proc_chain_hit'
                ? Math.max(1, Math.floor(Number(pp.chainCount ?? 3)))
                : 1;
              const pct = Number(pp.damageMultiplier ?? pp.value ?? (procEffect.key === 'proc_chain_hit' ? 0.3 : 0.5));
              let total = 0;
              for (let i = 0; i < hits && mHp > 0; i++) {
                const damage = applyMonsterIncomingGuards(Math.max(1, Math.round((pStats.atk || 1) * pct)));
                mHp -= damage;
                totalDamage += damage;
                total += damage;
              }
              log.push(`✨ **${playerBattleName}** 發動【${skill.name || cardName}】${hits > 1 ? `連擊 ${hits} 次` : '追擊'}，共對 ${mName} 造成 **${total}** 點傷害！`);
              if (mHp <= 0) outcome = "win";
              return true;
            },
            buffKeys: PLAYER_CARD_BUFF_KEYS,
            debuffKeys: PLAYER_CARD_OFFENSIVE_KEYS,
            sourceId: slotItem.uuid || slotItem.itemId || slotItem.id || cardName,
            log
          });
          options.playerActiveEffects = result.ownerActiveEffects;
          monsterActiveEffects = result.targetActiveEffects;
          if (result.applied) {
            hpGatedAppliedThisRound = true;
            const appliedStun = result.targetActiveEffects.find(e => e.key === 'stun' && e.appliedAt === round);
            if (appliedStun) {
              const stunDur = Number(appliedStun.params?.duration?.value ?? 1);
              applyMonsterStun(stunDur, round);
            }
          }
        }

      if (normalProcEffects.length > 0 && (cardCooldowns.player[cooldownKey] || 0) <= 0 && Math.random() * 100 < triggerChance) {
        if (Number(skill.cooldownTurns) > 0) cardCooldowns.player[cooldownKey] = Number(skill.cooldownTurns);
        const shouldShowGenericSkillLine = !normalProcEffects.some((effect) => shouldSuppressImmediateLog(effect));
        let appliedAnyNormalProc = false;

        for (const rawProcEffect of normalProcEffects) {
          if (!rawProcEffect || !rawProcEffect.key) continue;
          const procEffect = normalizeCardProcEffect(rawProcEffect);
          const currentPlayerHpPct = pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100;
          const currentMonsterHpPct = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
          if (!procEffectApplies(procEffect, currentPlayerHpPct, currentMonsterHpPct)) continue;
          const procChance = Number.isFinite(Number(procEffect.chance))
            ? Math.min(100, Math.max(0, Number(procEffect.chance)))
            : 100;
          if (Math.random() * 100 >= procChance) continue;
          const pp = procEffect.params || {};

          // 卡片型 proc_cleanse / proc_dispel：移除玩家自身 debuff / 敵方 buff
          if (procEffect.key === 'proc_cleanse') {
            if (!options.playerActiveEffects) options.playerActiveEffects = [];
            const before = options.playerActiveEffects.length;
            options.playerActiveEffects = options.playerActiveEffects.filter(e => {
              if (!e) return false;
              return !['poison','burn','bleed','shock_dot','curse_dot','stun','freeze','sleep','silence','slow','blind','fear','root','disarm','confuse','charm','dark_curse','atk_down','def_down','hit_down','agi_down'].includes(e.key);
            });
            if (options.playerActiveEffects.length < before) {
              log.push(`✨ **${playerBattleName}** 發動【${skill.name || cardName}】淨化負面狀態！`);
              appliedAnyNormalProc = true;
            }
            continue;
          }
          if (procEffect.key === 'proc_dispel') {
            const before = monsterActiveEffects.length;
            monsterActiveEffects = monsterActiveEffects.filter(e => {
              if (!e) return false;
              return !['atk_up','def_up','mdef_up','crit_rate_up','crit_damage_up','speed_up','final_damage_up','dodge_up','hit_up','heal_over_time','life_regen','shield','barrier','invincible_short','damage_reduction','agi_up'].includes(e.key);
            });
            if (monsterActiveEffects.length < before) {
              log.push(`🌀 **${playerBattleName}** 發動【${skill.name || cardName}】驅散 ${mName} 的增益效果！`);
              appliedAnyNormalProc = true;
            }
            continue;
          }

          // 卡片型即時動作效果：追擊 / 連鎖 / 斬殺 / 即時回血
          if (procEffect.key === 'proc_extra_hit') {
            const pct = Number(pp.damageMultiplier ?? pp.value ?? 0.5);
            const extraDmg = applyMonsterIncomingGuards(Math.max(1, Math.round((pStats.atk || 1) * pct)));
            mHp -= extraDmg;
            totalDamage += extraDmg;
            log.push(`✨ **${playerBattleName}** 發動【${skill.name || cardName}】追擊，對 ${mName} 造成 **${extraDmg}** 點傷害！（${mName} 剩 ${Math.max(0, mHp)} HP）`);
            appliedAnyNormalProc = true;
            if (mHp <= 0) outcome = "win";
            continue;
          }
          if (procEffect.key === 'proc_chain_hit') {
            const chainCount = Math.max(1, Math.floor(Number(pp.chainCount ?? 3)));
            const chainPct = Number(pp.damageMultiplier ?? pp.value ?? 0.3);
            for (let c = 0; c < chainCount; c++) {
              if (mHp <= 0) break;
              const chainDmg = applyMonsterIncomingGuards(Math.max(1, Math.round((pStats.atk || 1) * chainPct)));
              mHp -= chainDmg;
              totalDamage += chainDmg;
              log.push(`⛓️ **${playerBattleName}** 連鎖打擊！對 ${mName} 造成 **${chainDmg}** 點傷害！`);
              if (mHp <= 0) { outcome = "win"; break; }
            }
            appliedAnyNormalProc = true;
            continue;
          }
          if (procEffect.key === 'proc_execute') {
            const execThr = Number(pp.thresholdPct ?? pp.value ?? 20);
            const monsterHpPctNow = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
            if (monsterHpPctNow <= execThr) {
              log.push(`💀 **${playerBattleName}** 發動【${skill.name || cardName}】斬殺！${mName} 直接被擊殺！`);
              totalDamage += mHp;
              mHp = 0;
              outcome = "win";
              appliedAnyNormalProc = true;
            }
            continue;
          }
          if (procEffect.key === 'proc_heal') {
            const healAmt = Math.max(1, Math.round((pStats.maxHp || 100) * (Number(pp.value ?? 5) / 100)));
            _healLogged(healAmt, (actual) => `💚 **${playerBattleName}** 發動【${skill.name || cardName}】恢復 **${actual}** HP！（剩 ${pHp}）`);
            appliedAnyNormalProc = true;
            continue;
          }

          const targetHadDebuff = (procEffect.target === 'enemy' || PLAYER_CARD_OFFENSIVE_KEYS.has(procEffect.key))
            ? hasAnyDebuff(monsterActiveEffects, round)
              : hasAnyDebuff(options.playerActiveEffects || [], round);
          const bonusValue = Number(pp.bonusIfTargetDebuffed);
          const equippedBonusValue = Number(pp.bonusIfEquippedValue);
          const hasEquippedBonus = Number.isFinite(equippedBonusValue)
            && (
              hasEquippedNames(options.equipped || {}, pp.bonusIfEquippedNames)
              || hasAnyEquippedName(options.equipped || {}, pp.bonusIfEquippedAnyNames)
            );
          if (applyImmediateCardDamageEffect({
            procEffect,
            ownerLabel: playerBattleName,
            skillName: skill.name || cardName,
            skillDescription: _descOnce(skill.name, skill.description || ''),
            targetLabel: mName,
            sourceAtk: pStats.atk || 1,
            targetMaxHp: mHpInit || mHp || 1,
            // 同上:即時傷害計入總傷害，並走同一道檢傷（回傳物件才會讓戰報顯示檢傷後的數字）
            applyTargetDamage: (damage) => {
              const d = applyMonsterIncomingGuards(damage);
              mHp -= d; totalDamage += Math.max(0, Number(d) || 0);
              return { remainingHp: mHp, actualDamage: d };
            },
            log
          })) {
            appliedAnyNormalProc = true;
            continue;
          }
          const effectEntry = makeCardEffectEntry(
            procEffect,
            round,
            'player_card_skill',
            hasEquippedBonus
              ? { value: equippedBonusValue }
              : (targetHadDebuff && Number.isFinite(bonusValue) ? { value: bonusValue } : {}),
            `${slot}:${slotItem.uuid || slotItem.itemId || slotItem.id || cardName}`
          );
          effectEntry.params.sourceName = playerBattleName;
          if (applyImmediateCardHealEffect({
            procEffect,
            ownerLabel: playerBattleName,
            skillName: skill.name || cardName,
            skillDescription: _descOnce(skill.name, skill.description || ''),
            targetLabel: playerBattleName,
            sourceAtk: pStats.atk || 1,
            targetMaxHp: pStats.maxHp || pHp || 1,
            applyTargetHeal: (heal) => {
              const before = pHp;
              pHp = _healPlayer(heal);
              return { remainingHp: pHp, actualHeal: Math.max(0, pHp - before) };
            },
            log
          })) {
            appliedAnyNormalProc = true;
            continue;
          }
          if (effectEntry.params.mode === 'caster_atk_pct') effectEntry.params.casterAtk = pStats.atk || 1;
          // 攻擊型效果 → 施加給怪物；增益型效果 → 施加給玩家
          if (procEffect.target === 'enemy' || PLAYER_CARD_OFFENSIVE_KEYS.has(procEffect.key)) {
            monsterActiveEffects = addOrStackCardEffect(monsterActiveEffects, effectEntry);
            appliedAnyNormalProc = true;
            if (effectEntry.key === 'stun') {
              const stunDur = Number(effectEntry.params?.duration?.value ?? 1);
              applyMonsterStun(stunDur, round);
            }
          } else {
            effectEntry.appliedAt = round - 1;
            if (!options.playerActiveEffects) options.playerActiveEffects = [];
            options.playerActiveEffects = addOrStackCardEffect(options.playerActiveEffects, effectEntry);
            appliedAnyNormalProc = true;
          }
        }
        if (shouldShowGenericSkillLine && appliedAnyNormalProc && !hpGatedAppliedThisRound) {
          log.push(`🎴 **${playerBattleName}** 發動【${skill.name || cardName}】！${_descOnce(skill.name || cardName, skill.description || '')}`);
        }
      }
    }
    }

    // ── 職業技能觸發（35% 機率，每回合限一次，回合開頭讀取 HP 條件後發動）──
    if (!_noPlayerAtk && !jobSkillUsedThisRound && !playerIsStunned && !playerIsFrozen && outcome === null) {
      // 帶自訂 trigger 的技能（賭徒骰子系）走自己的觸發條件，不吃 35% 閘門、也不佔隨機池
      const jobSkills = (Array.isArray(options.equipped?.job_eq?.jobSkills)
        ? options.equipped.job_eq.jobSkills : []).filter((sk) => !sk?.trigger);
      if (jobSkills.length > 0 && Math.random() < 0.35) {
        const playerHpPct = pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100;
        const monsterHpPct = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
        const available = jobSkills.filter((sk) => {
          if (!sk || !sk.key) return false;
          if ((jobSkillCooldowns[sk.key] || 0) > 0) return false;
          const c = sk.condition || {};
          if (Number.isFinite(Number(c.ownerHpAbovePct)) && playerHpPct <= Number(c.ownerHpAbovePct)) return false;
          if (Number.isFinite(Number(c.ownerHpBelowPct)) && playerHpPct >= Number(c.ownerHpBelowPct)) return false;
          if (Number.isFinite(Number(c.targetHpBelowPct)) && monsterHpPct >= Number(c.targetHpBelowPct)) return false;
          // 姿態專屬技能：只有在對應姿態下才進入隨機池（沒選姿態 → 這類技能一律不可用）
          if (c.stance && c.stance !== battleStance?.key) return false;
          // 武器綁定技能（賭徒綁骰子等）：武器不符 → 不進池
          if (c.weaponType && c.weaponType !== pStats.weaponType) return false;
          // 暈眩專屬技能（矮人戰士長「餘震」）：目標暈眩中才進池；兩種暈眩都算
          if (c.targetStunned === true && !_targetStunnedNow(round)) return false;
          // 成本（cost: combo/hp）付不起 → 不進池
          if (!_canAffordSkill(sk)) return false;
          return true;
        });
        if (available.length > 0) {
          const chosen = available[Math.floor(Math.random() * available.length)];
          jobSkillUsedThisRound = true;
          if (Number(chosen.cooldownTurns) > 0) jobSkillCooldowns[chosen.key] = Number(chosen.cooldownTurns);
          const _costNote = _paySkillCost(chosen);
          if (_costNote) log.push(`💠 【${chosen.name}】${_costNote}`);
          const JOB_SKILL_OFFENSIVE = new Set([
            'atk_down', 'def_down', 'hit_down', 'agi_down', 'stun', 'silence',
            'poison', 'bleed', 'burn', 'lightning', 'freeze', 'charm', 'dark_curse'
          ]);
          let skillApplied = false;
          for (const pe of (Array.isArray(chosen.procEffects) ? chosen.procEffects : [])) {
            if (!pe || !pe.key) continue;
            if (IMMEDIATE_HEAL_EFFECT_KEYS.has(pe.key)) {
              const params = pe.params || {};
              const base = params.mode === 'max_hp_pct' || params.mode === 'pct'
                ? pStats.maxHp : (params.mode === 'current_hp' ? pHp : pStats.maxHp);
              const heal = Math.max(1, Math.round(base * ((Number(params.value) || 10) / 100)));
              _healLogged(heal, (actual) => `✨ **(${jobProfile.jobName || '職業技能'})** 發動【${chosen.name}】！回復 **${actual}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
              skillApplied = true;
              continue;
            }
            const entry = makeCardEffectEntry(pe, round - 1, 'job_skill', {}, `job:${chosen.key}:${pe.key}`);
            entry.params.sourceName = jobProfile.jobName || '職業技能';
            if (pe.target === 'enemy' || JOB_SKILL_OFFENSIVE.has(pe.key)) {
              monsterActiveEffects = addOrStackCardEffect(monsterActiveEffects, entry);
              if (entry.key === 'stun') {
                const stunDur = Number(entry.params?.duration?.value ?? 1);
                applyMonsterStun(stunDur, round);
              }
            } else {
              if (!options.playerActiveEffects) options.playerActiveEffects = [];
              options.playerActiveEffects = addOrStackCardEffect(options.playerActiveEffects, entry);
            }
            skillApplied = true;
          }
          if (skillApplied) {
            const hasImmedHeal = (chosen.procEffects || []).some(pe => IMMEDIATE_HEAL_EFFECT_KEYS.has(pe?.key));
            if (!hasImmedHeal) {
              log.push(`✨ **(${jobProfile.jobName || '職業技能'})** 發動【${chosen.name}】！${_descOnce(chosen.name, chosen.description || '')}`);
            }
          }
        }
      }
    }

    // ── 自訂觸發：round_start_chance（回合開始擲自己的機率，不吃 35% 閘門）──
    //    目前用於賭徒「千術」：讓敵方本回合攻擊必定大失敗（自傷並跳過該次攻擊）。
    forceMonsterCritFail = false;
    _greatChanceBonusRound = 0;
    if (!_noPlayerAtk && !playerIsStunned && !playerIsFrozen && outcome === null) {
      const _customSkills = (Array.isArray(options.equipped?.job_eq?.jobSkills)
        ? options.equipped.job_eq.jobSkills : []).filter((sk) => sk?.trigger === 'round_start_chance');
      for (const sk of _customSkills) {
        if (!sk.key || (jobSkillCooldowns[sk.key] || 0) > 0) continue;
        // 武器綁定（賭徒技能綁骰子等）：condition.weaponType 不符 → 不發動
        if (sk.condition?.weaponType && sk.condition.weaponType !== pStats.weaponType) continue;
        const ch = Number.isFinite(Number(sk.chance)) ? Number(sk.chance) : 100;
        if (Math.random() * 100 >= ch) continue;
        if (!_canAffordSkill(sk)) continue;   // 成本付不起 → 不觸發
        if (Number(sk.cooldownTurns) > 0) jobSkillCooldowns[sk.key] = Number(sk.cooldownTurns);
        const _costNote = _paySkillCost(sk);
        if ((sk.procEffects || []).some((pe) => pe?.key === 'force_crit_fail')) forceMonsterCritFail = true;
        // 盜靈「探囊」：本回合大成功機率提升（不是必定大成功）
        for (const pe of (Array.isArray(sk.procEffects) ? sk.procEffects : [])) {
          if (pe?.key === 'great_chance_up') _greatChanceBonusRound = Math.max(_greatChanceBonusRound, Number(pe.params?.value) || 0);
        }
        log.push(`✨ **(${jobProfile.jobName || '職業技能'})** 發動【${sk.name}】！${sk.description || ''}${_costNote}`);
      }
    }

    // ── 自訂觸發：on_target_stunned（目標暈眩中必定發動，不吃 35% 閘門）──
    //    用於矮人戰士長「崩山」：把「打暈 → 爆發」變成穩定連段而不是碰運氣。
    //    效果照一般 procEffects 掛到玩家身上（final_damage_up 等），由既有效果鏈結算。
    if (!_noPlayerAtk && !playerIsStunned && !playerIsFrozen && outcome === null && _targetStunnedNow(round)) {
      const _stunSkills = (Array.isArray(options.equipped?.job_eq?.jobSkills)
        ? options.equipped.job_eq.jobSkills : []).filter((sk) => sk?.trigger === 'on_target_stunned');
      for (const sk of _stunSkills) {
        if (!sk.key || (jobSkillCooldowns[sk.key] || 0) > 0) continue;
        const ch = Number.isFinite(Number(sk.chance)) ? Number(sk.chance) : 100;
        if (Math.random() * 100 >= ch) continue;
        if (Number(sk.cooldownTurns) > 0) jobSkillCooldowns[sk.key] = Number(sk.cooldownTurns);
        if (!options.playerActiveEffects) options.playerActiveEffects = [];
        for (const pe of (sk.procEffects || [])) {
          if (!pe || !pe.key) continue;
          const p = pe.params || {};
          const entry = {
            key: pe.key,
            target: pe.target || 'self',
            trigger: 'passive',
            chance: 100,
            params: { ...p },
            duration: p.duration || { mode: 'turns', value: 1 },
            appliedAt: round,
            sourceType: 'job_skill',
            sourceId: `dwarflord:${sk.key}`,
          };
          if (entry.target === 'enemy') {
            monsterActiveEffects = addOrStackCardEffect(monsterActiveEffects, entry);
          } else {
            options.playerActiveEffects = addOrStackCardEffect(options.playerActiveEffects, entry);
          }
        }
        log.push(`⛰️ **(${jobProfile.jobName || '職業技能'})** 發動【${sk.name}】！${sk.description || ''}`);
      }
    }

    // ── 計算玩家主動效果倍率 ──
    let playerAtkMultiplier = 1;
    let playerCritRateBonus = 0;
    // 戰鬥中的基礎屬性加成（str_up / agi_up / luk_up …）。
    // 這些效果不走 calcPlayerStats（那是開場算一次），必須在這裡即時換算成衍生值，
    // 否則「LUK+15」之類的技能只會改面板數字、對 ATK 與爆擊率毫無作用。
    const playerStatBonus = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
    let playerCritDamageMultiplier = 1;
    let playerLifestealPct = 0;          // 走總量上限（裝備效果／怪物卡／錨點）
    let playerLifestealEnchantPct = 0;   // 附魔來源，不吃上限
    let playerLifestealStrongPct = 0;
    // ── 吸血（2026-08-04 改制）──────────────────────────────────────
    // 舊制：每一段傷害（主擊/副手/三元/多段/連擊）各自結算一次。
    //   問題：吸血變成「傷害 × 攻擊次數」的乘法——盜賊一場打 25 下就吸 25 次，
    //   而攻擊次數本身已經是它的優勢，等於雙重加成。
    // 新制：**一回合只結算一次**，用該回合造成的總傷害算；且**總吸血%有上限**。
    //   → 攻擊次數不再放大吸血；多段武器與單擊武器在同樣輸出下吸得一樣多。
    let _lifestealDealtThisRound = 0;
    const _applyLifesteal = (dealt) => {
      if (dealt > 0) _lifestealDealtThisRound += dealt;   // 只累積，回合結束才吸
    };
    const _settleLifestealForRound = () => {
      const dealt = _lifestealDealtThisRound;
      _lifestealDealtThisRound = 0;
      if (!(dealt > 0) || pHp <= 0) return;
      // 上限只作用在「裝備效果」那份；附魔那份直接加在後面
      const cappedPct = Math.min(LIFESTEAL_CAP_PCT, playerLifestealPct);
      const strongPct = Math.min(Math.max(0, LIFESTEAL_CAP_PCT - cappedPct), playerLifestealStrongPct);
      const pct = cappedPct + playerLifestealEnchantPct;
      if (pct > 0) {
        const healAmt = Math.max(1, Math.round(dealt * (pct / 100)));
        const beforeHeal = pHp;
        pHp = _healPlayer(healAmt, { lifesteal: true });
        const _note = playerLifestealEnchantPct > 0
          ? `${cappedPct}%＋附魔 ${Math.round(playerLifestealEnchantPct * 10) / 10}%`
          : `${cappedPct}%`;
        log.push(`💚 吸取生命力！恢復 **${Math.max(0, pHp - beforeHeal)}** HP（本回合造成 ${dealt} × ${_note}｜你剩 ${pHp} / ${pStats.maxHp}）`);
      }
      if (strongPct > 0) {
        const sHeal = Math.max(1, Math.round(dealt * (strongPct / 100)));
        const beforeHeal = pHp;
        pHp = _healPlayer(sHeal, { lifesteal: true });
        log.push(`💜 強力吸血！恢復 **${Math.max(0, pHp - beforeHeal)}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
      }
    };
    let playerDefBonusPct = 0;
    let playerDefDownPct = 0;
    let playerDefFlatBonus = 0;
    let playerDodgeBonus = 0;
    let playerBlockBonus = 0;
    let playerHitPenalty = 0;
    let playerDefIgnorePct = 0;
    let playerDamageReductionPct = _turtleSetTideCfg && turtleTidePhase(round, _turtleSetTideCfg) === "high_tide"
      ? _turtleSetTideCfg.highTideDamageReductionPct
      : 0;
    let playerFinalDamageMultiplier = _turtleSetTideCfg && turtleTidePhase(round, _turtleSetTideCfg) === "ebb_tide"
      ? 1 + _turtleSetTideCfg.ebbFinalDamagePct / 100
      : 1;
    let playerInvincible = false;
    let playerBonusVsPoisonedPct = 0;
    let playerBonusVsDebuffedPct = 0;
    let playerHitBonus = 0;
    // ── 新效果：防禦層 ──
    let playerPhysDrPct = 0;
    let playerMagicDrPct = 0;
    let playerLastStandBonusPct = 0;
    let playerLastStandThresholdPct = 30;
    let playerDebuffImmunity = false;
    let playerControlImmunity = false;
    // ── 新效果：反擊/反傷 ──
    let playerThornsPct = 0;
    let playerReflectMagicPct = 0;
    let playerDamageToHealPct = 0;
    let playerOnHitHealPct = 0;
    let playerOnCritHealPct = 0;
    // ── 新效果：條件增傷 ──
    let playerBonusVsBossPct = 0;
    let playerBonusVsDefBrokenPct = 0;
    let playerBonusVsBurningPct = 0;
    let playerBonusVsStunnedPct = 0;
    let playerBonusWhenHpHighPct = 0;
    let playerBonusWhenHpHighThreshold = 70;
    let playerBonusWhenHpLowPct = 0;
    let playerBonusWhenHpLowThreshold = 30;
    let playerBonusFirstHitPct = 0;
    let playerBonusCounterDamagePct = 0;
    let playerExecuteUnderHpPct = 0;
    let playerExecuteUnderHpThreshold = 0;
    // ── 新效果：HOT（玩家側）──
    let playerHotPct = 0;
    let playerHotFlat = 0;
    // 救護系：每 interval 回合回復 value% MaxHP。
    // 每個來源各自保留自己的 interval——舊寫法「% 全加總、interval 取最小」會讓
    // 黃金幼龍卡(每3回合10%)搭到火髓魔蟲卡(每回合3%)時被壓成「每回合13%」，玩家要的三回大爆發就消失了。
    const playerLifeRegens = [];           // [{ pct, interval }]
    // ── 新效果：BUILD 變化對戒（2026-05）──
    let playerHpLowReductionPct = 0;          // 狂血右：HP 低時受傷減免
    let playerHpLowReductionThreshold = 50;
    let playerOnKillHealPct = 0;              // 吸血右：擊殺回血
    let playerPostBattleHealPct = 0;          // 救護右：戰後回血
    let playerBonusWhileShieldedPct = 0;      // 守護右：擁有護盾時增傷
    let stackOnHitValue = 0;                  // 戰意左：每次出手累積
    let stackOnHitCap = 0;
    let stackOnHitStacks = 0;
    let stackOnTakenValue = 0;                // 戰意右：每次受擊累積
    let stackOnTakenCap = 0;
    let stackOnTakenStacks = 0;
    let playerEchoChance = 0;                 // 繫・初鳴之晶：共鳴殘影追擊觸發率(%)
    let playerEchoPct = 0;                     // 殘影追擊傷害＝該次傷害的 %
    let playerTripleStrike = 0;               // 三元牌：固定 N 段攻擊、每段 1/N 傷害（0=不啟用）
    let playerGuaranteedCombo = 0;            // 狼牙王卡：連擊「首 N 段必定連上」（不看連擊率、必中），之後回到自身連擊率
    if (Array.isArray(options.playerActiveEffects)) {
      for (const eff of options.playerActiveEffects) {
        if (!eff) continue;
        const effParams = eff.params || {};
        const effValue = Number(effParams.value ?? 0);
        // 過期檢查
        if (effParams.duration?.mode === 'turns') {
          const end = (eff.appliedAt || 1) + (effParams.duration.value || 1);
          if (round > end) continue;
        }
        if (eff.key === 'atk_down') {
          // 從怪物施加的攻擊力下降
          if (effValue > 0) playerAtkMultiplier *= (1 - effValue / 100);
          else if (effValue < 0) playerAtkMultiplier *= (1 - Math.abs(effValue) / 100);
        } else if (eff.key === 'atk_up') {
          playerAtkMultiplier *= (1 + Math.abs(effValue) / 100);
        } else if (eff.key === 'final_damage_up') {
          playerFinalDamageMultiplier *= (1 + Math.abs(effValue) / 100);
        } else if (eff.key === 'charm') {
          // 魅惑（米拉桑）：玩家攻擊力降低 value%
          playerAtkMultiplier *= (1 - Math.abs(effValue) / 100);
        } else if (eff.key === 'dark_curse') {
          // 黑暗詛咒（森林盜賊）：玩家攻擊力降低 |value|%
          playerAtkMultiplier *= (1 - Math.abs(effValue) / 100);
        } else if (eff.key === 'str_up' || eff.key === 'agi_up' || eff.key === 'vit_up'
                   || eff.key === 'int_up' || eff.key === 'dex_up' || eff.key === 'luk_up') {
          playerStatBonus[eff.key.slice(0, 3)] += Math.abs(effValue);
          if (eff.key === 'agi_up') playerDodgeBonus += Math.abs(effValue) * 0.5;
        } else if (eff.key === 'str_down' || eff.key === 'agi_down' || eff.key === 'vit_down'
                   || eff.key === 'int_down' || eff.key === 'dex_down' || eff.key === 'luk_down') {
          playerStatBonus[eff.key.slice(0, 3)] -= Math.abs(effValue);
          if (eff.key === 'agi_down') playerDodgeBonus -= Math.abs(effValue) * 0.5;
        } else if (eff.key === 'crit_rate_up') {
          // 玩家爆擊率提升（來自玩家卡片技能）
          playerCritRateBonus += effValue;
        } else if (eff.key === 'hit_up') {
          playerHitBonus += effValue;
        } else if (eff.key === 'crit_damage_up') {
          playerCritDamageMultiplier *= (1 + Math.abs(effValue) / 100);
        } else if (eff.key === 'lifesteal') {
          // 玩家吸血。**附魔來源不吃總量上限**（2026-08-04 定案）——
          // 附魔是隨機滾出來的、每條 1~7%，屬於「裝備養成」的收益；
          // 上限只用來擋「專門吸血裝備疊出來」的極端（戒指＋錨點＋怪物卡）。
          if (eff.source === 'enchant') playerLifestealEnchantPct += effValue;
          else playerLifestealPct += effValue;
        } else if (eff.key === 'life_steal_strong') {
          // 強力吸血：傷害的 value% 回復為 HP（來自玩家卡片技能）
          playerLifestealStrongPct += effValue;
        } else if (eff.key === 'def_up') {
          if (effParams.mode === 'flat') playerDefFlatBonus += Math.abs(effValue);
          else playerDefBonusPct += Math.abs(effValue);
        } else if (eff.key === 'def_down') {
          playerDefDownPct += Math.abs(effValue);
        } else if (eff.key === 'damage_reduction') {
          playerDamageReductionPct += Math.abs(effValue);
        } else if (eff.key === 'dodge_up') {
          playerDodgeBonus += Math.abs(effValue);
        } else if (eff.key === 'block_chance_up') {
          // 主動技能臨時格擋率提升（例如劍士「舉步若堅」）
          playerBlockBonus += Math.abs(effValue);
        } else if (eff.key === 'hit_down' || eff.key === 'hit_rate_down') {
          playerHitPenalty += Math.abs(effValue);
        } else if (eff.key === 'def_ignore') {
          const baseIgnore = Math.abs(effValue);
          const debuffIgnore = Number(effParams.bonusIfTargetDebuffed ?? NaN);
          playerDefIgnorePct += Number.isFinite(debuffIgnore) && hasAnyDebuff(monsterActiveEffects, round)
            ? Math.abs(debuffIgnore)
            : baseIgnore;
        } else if (eff.key === 'invincible_short') {
          playerInvincible = true;
        } else if (eff.key === 'bonus_vs_poisoned') {
          playerBonusVsPoisonedPct += Math.abs(effValue);
        } else if (eff.key === 'bonus_vs_debuffed') {
          playerBonusVsDebuffedPct += Math.abs(effValue);
        } else if (eff.key === 'bonus_vs_boss') {
          playerBonusVsBossPct += Math.abs(effValue);
        } else if (eff.key === 'bonus_vs_def_broken') {
          playerBonusVsDefBrokenPct += Math.abs(effValue);
        } else if (eff.key === 'bonus_vs_burning') {
          playerBonusVsBurningPct += Math.abs(effValue);
        } else if (eff.key === 'bonus_vs_stunned') {
          playerBonusVsStunnedPct += Math.abs(effValue);
        } else if (eff.key === 'bonus_when_hp_high') {
          playerBonusWhenHpHighPct += Math.abs(effValue);
          const thr = Number(effParams.thresholdPct);
          if (Number.isFinite(thr) && thr > 0) playerBonusWhenHpHighThreshold = thr;
        } else if (eff.key === 'bonus_when_hp_low') {
          playerBonusWhenHpLowPct += Math.abs(effValue);
          const thr = Number(effParams.thresholdPct);
          if (Number.isFinite(thr) && thr > 0) playerBonusWhenHpLowThreshold = thr;
        } else if (eff.key === 'bonus_first_hit') {
          playerBonusFirstHitPct += Math.abs(effValue);
        } else if (eff.key === 'bonus_counter_damage') {
          playerBonusCounterDamagePct += Math.abs(effValue);
        } else if (eff.key === 'physical_damage_reduction') {
          playerPhysDrPct += Math.abs(effValue);
        } else if (eff.key === 'magic_damage_reduction') {
          playerMagicDrPct += Math.abs(effValue);
        } else if (eff.key === 'last_stand') {
          playerLastStandBonusPct += Math.abs(effValue);
          const thr = Number(effParams.thresholdPct);
          if (Number.isFinite(thr) && thr > 0) playerLastStandThresholdPct = thr;
        } else if (eff.key === 'debuff_immunity') {
          playerDebuffImmunity = true;
        } else if (eff.key === 'control_immunity') {
          playerControlImmunity = true;
        } else if (eff.key === 'thorns') {
          playerThornsPct += Math.abs(effValue);
        } else if (eff.key === 'reflect_magic') {
          playerReflectMagicPct += Math.abs(effValue);
        } else if (eff.key === 'damage_to_heal') {
          playerDamageToHealPct += Math.abs(effValue);
        } else if (eff.key === 'on_hit_heal') {
          playerOnHitHealPct += Math.abs(effValue);
        } else if (eff.key === 'on_crit_heal') {
          playerOnCritHealPct += Math.abs(effValue);
        } else if (eff.key === 'heal_over_time') {
          // 同 DOT 迴圈：target=party 的治療光環只由「支援光環」路徑結算(會依 INT 縮放)，
          // 這裡再累加一次的話，光環提供者自己會多吃一份未縮放的 base%。
          if (eff.target !== 'party') {
            if (effParams.mode === 'flat') playerHotFlat += Math.abs(effValue);
            else playerHotPct += Math.abs(effValue);
          }
        } else if (eff.key === 'life_regen') {
          // value 為 %MaxHP、每 interval 回合回一次（依戒指/卡片說明）；各來源獨立，不互相干擾節奏
          const pct = Math.abs(effValue);
          if (pct > 0) playerLifeRegens.push({ pct, interval: Math.max(1, Number(effParams.interval) || 1) });
        } else if (eff.key === 'execute_under_hp_pct') {
          playerExecuteUnderHpPct += Math.abs(effValue);
          const thr = Number(effParams.thresholdPct);
          if (Number.isFinite(thr) && thr > 0) playerExecuteUnderHpThreshold = thr;
          else if (playerExecuteUnderHpThreshold === 0) playerExecuteUnderHpThreshold = 20;
        } else if (eff.key === 'bonus_reduction_when_hp_low') {
          // 狂血右：HP 低時受傷減免
          playerHpLowReductionPct += Math.abs(effValue);
          const thr = Number(effParams.threshold ?? effParams.thresholdPct);
          if (Number.isFinite(thr) && thr > 0) playerHpLowReductionThreshold = thr;
        } else if (eff.key === 'on_kill_heal') {
          // 吸血右：擊殺回血 (% MaxHP)
          playerOnKillHealPct += Math.abs(effValue);
        } else if (eff.key === 'post_battle_heal') {
          // 救護右：戰後回血 (% MaxHP)
          playerPostBattleHealPct += Math.abs(effValue);
        } else if (eff.key === 'bonus_while_shielded') {
          // 守護右：擁有護盾時增傷
          playerBonusWhileShieldedPct += Math.abs(effValue);
        } else if (eff.key === 'stack_on_hit_offense') {
          // 戰意左：每次出手累積 STR/DEX
          stackOnHitValue += Math.abs(effValue);
          const cap = Number(effParams.cap);
          if (Number.isFinite(cap) && cap > stackOnHitCap) stackOnHitCap = cap;
        } else if (eff.key === 'stack_on_taken_defense') {
          // 戰意右：每次受擊累積 VIT/AGI
          stackOnTakenValue += Math.abs(effValue);
          const cap = Number(effParams.cap);
          if (Number.isFinite(cap) && cap > stackOnTakenCap) stackOnTakenCap = cap;
        } else if (eff.key === 'echo_strike') {
          // 繫・初鳴之晶：共鳴殘影追擊（獨立於連擊，造成該次傷害的 value%，chance% 觸發）
          const ch = Number(effParams.chance ?? 0);
          if (ch > playerEchoChance) playerEchoChance = ch;
          if (effValue > playerEchoPct) playerEchoPct = effValue;
        } else if (eff.key === 'triple_strike') {
          // 三元牌：固定每回合攻擊 N 段、每段傷害為原本的 1/N（走連擊系統，算連擊數）
          // 嵐暴（元素師）不吃三元牌——姿態自帶固定 3 段，特殊武器/卡片多段全部無效
          const n = Math.max(2, Math.round(Number(effValue) || Number(effParams.hits) || 3));
          if (!stormVolleyCfg && n > playerTripleStrike) playerTripleStrike = n;
        } else if (eff.key === 'guaranteed_combo') {
          // 狼牙王卡：連擊首 N 段必定連上（不看連擊率、必中），之後回到自身連擊率
          const n = Math.max(0, Math.round(Number(effValue) || Number(effParams.hits) || 0));
          if (n > playerGuaranteedCombo) playerGuaranteedCombo = n;
        }
      }
    }

    // ── CC 懲罰套用（blind/disarm/root）──
    if (playerIsBlinded) playerHitPenalty += 30;
    if (playerIsDisarmed) playerAtkMultiplier *= 0.5;
    if (playerIsRooted) playerDodgeBonus -= 999;

    // ── 高血量條件加成（例如職業徽章 on_high_hp）──
    let extraHighHpCrit = 0;
    let extraHighHpStun = 0;
    let extraHighHpPoisonChance = 0;
    let extraHighHpDodge = 0;
    try {
      const equippedCtx = options.equipped || null;
      if (equippedCtx) {
        const highEffects = collectEquipmentEffects(equippedCtx, 'on_high_hp', { equipped: equippedCtx, inventory: options.inventory || [] });
        for (const he of highEffects) {
          if (!he || !he.params) continue;
          const thresholdPct = Number.isFinite(Number(he.params.thresholdPct)) ? Number(he.params.thresholdPct) : 90;
          if (pHp < Math.ceil((pStats.maxHp || 1) * (thresholdPct / 100))) continue;
          const highValue = Number(he.params.value);
          if (!Number.isFinite(highValue)) continue;
          if (he.key === 'crit_rate_up') extraHighHpCrit += highValue;
          else if (he.key === 'stun_chance_up') extraHighHpStun += highValue;
          else if (he.key === 'poison_chance_up') extraHighHpPoisonChance += highValue;
          else if (he.key === 'dodge_up') extraHighHpDodge += Math.abs(highValue);
        }
      }
    } catch (e) {}
    playerDodgeBonus += extraHighHpDodge;

    // 後續的觸發治療、大治療術與回合末 HOT 使用本回合完整扣防／穿防結果。
    _healDamageDefDownPct = roundMonsterDefDownPct;
    _healDamageDefIgnorePct = Math.min(100, Math.max(0,
      (Number(pStats.bypassMonsterDefPct) || 0) + playerDefIgnorePct + roundPartyDefIgnorePct));

    for (let a = 0; a < attackCount && outcome === null && !_noPlayerAtk && !playerIsStunned && !playerIsFrozen; a++) {
      const hitChance = calcHitChance({
        hit: (pStats.hit + playerHitBonus - playerHitPenalty),
        dodge: adjustedMCalc.dodge,
        min: 20,
      });

      // ── 基礎屬性 buff → 本回合衍生值（與 calcPlayerStats 的推導係數保持一致）──
      //    ATK：武器主屬性增量 × 武器倍率；爆擊率：LUK×0.5；命中：DEX×1；
      //    武器主屬性追加傷害：主屬性增量 ×1.5。（迴避已在效果鏈直接加進 playerDodgeBonus）
      const _mainStatKey = pStats.weaponMainStat || "str";
      const _dMain = playerStatBonus[_mainStatKey] || 0;
      const _wCfg = getWeaponConfig(pStats.weaponType) || {};
      const _wMult = pStats.weaponType ? (Number(_wCfg.mult) || 1) : 1;
      const roundAtkFlatBonus = Math.round(_dMain * _wMult);
      const roundCritStatBonus = (playerStatBonus.luk || 0) * 0.5;
      const roundHitStatBonus = playerStatBonus.dex || 0;
      // 副手那一擊：武器主屬性追加傷害也一起打折（否則固定加成不受倍率影響）
      const _offhandMultRound = (a >= 1 && pStats.isDualWield) ? OFFHAND_DAMAGE_MULT : 1;
      const weaponMainBonusRound = Math.max(0, Math.round((weaponMainBonus + Math.round(_dMain * 1.5)) * _offhandMultRound));

      // ── 擲攻擊階級（5 階：大失敗/失敗/成功/大成功/完美）──
      const atkTierProbs = calcAttackTierProbs(
        (pStats.dex || 0) + (playerStatBonus.dex || 0),
        (pStats.luk || 0) + (playerStatBonus.luk || 0)
      );
      // 盜靈「探囊」：本回合大成功機率 +N（從「成功」那一段挪過來，總和維持 100）
      if (_greatChanceBonusRound > 0) {
        const _mv = Math.min(_greatChanceBonusRound, atkTierProbs.success);
        atkTierProbs.success -= _mv;
        atkTierProbs.great += _mv;
      }
      const atkTier = rollAttackTier(atkTierProbs);

      // 大失敗：自殘 30%，跳過本次攻擊
      if (atkTier === 'critFail') {
        const selfBase = Math.max(1, Math.round((pStats.atk || 1) * playerAttackLevelMult));
        let selfDmg = Math.max(1, Math.round(selfBase * 0.3 * (0.7 + Math.random() * 0.3)));
        selfDmg = _hurt(selfDmg);
        log.push(`💥 **大失敗**！你揮拳失手砸到自己，受到 **${selfDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
        if (pHp <= 0) { outcome = "lose"; break; }
        continue;
      }
      // 失敗：強制 miss（不看 HIT/DODGE）
      if (atkTier === 'fail') {
        log.push(`❌ **失敗**！你手滑揮空，沒打到 ${mName}！`);
        continue;
      }

      // ── 骰子武器：本回合一次擲出全部骰子（雙 6 加倍需先知道所有骰面）──
      //    每段各對應一顆 d6，骰面決定該段傷害倍率（純運氣、不看屬性值）。
      const _faceMults = pStats.faceMultipliers;
      const _segCount = Math.max(1, Number(pStats.attackSegments) || 1);
      let diceRolls = null;
      let diceOverride = null;   // 全 1 / 全 6 時，每段改用的固定倍率
      if (Array.isArray(_faceMults) && _faceMults.length > 0) {
        const faces = _faceMults.length;
        diceRolls = Array.from({ length: _segCount }, () => 1 + Math.floor(Math.random() * faces));
        // ── 自訂觸發：on_dice_one（賭徒「將大局逆轉吧」）──
        //    骰出 1 就必定發動（不吃 35% 閘門、不擲機率），只重骰那些 1，並套用技能的 procEffects。
        if (diceRolls.some((f) => f === 1)) {
          const _reroll = (Array.isArray(options.equipped?.job_eq?.jobSkills)
            ? options.equipped.job_eq.jobSkills : []).find((sk) => sk?.trigger === 'on_dice_one');
          if (_reroll && _reroll.key && (jobSkillCooldowns[_reroll.key] || 0) <= 0) {
            const _beforePips = diceRolls.map((f) => DICE_PIPS[f - 1] || `【${f}】`).join("");
            for (let _i = 0; _i < diceRolls.length; _i++) {
              if (diceRolls[_i] === 1) diceRolls[_i] = 1 + Math.floor(Math.random() * faces);
            }
            if (Number(_reroll.cooldownTurns) > 0) jobSkillCooldowns[_reroll.key] = Number(_reroll.cooldownTurns);
            // 重骰後才判定全 1 / 全 6
            const _afterPips = diceRolls.map((f) => DICE_PIPS[f - 1] || `【${f}】`).join("");
            log.push(`✨ **(${jobProfile.jobName || '職業技能'})** 發動【${_reroll.name}】！${_beforePips} → **${_afterPips}**`);
            // 套用技能自身的增益（例如 LUK+15）
            for (const pe of (Array.isArray(_reroll.procEffects) ? _reroll.procEffects : [])) {
              if (!pe || !pe.key) continue;
              const entry = makeCardEffectEntry(pe, round - 1, 'job_skill', {}, `job:${_reroll.key}:${pe.key}`);
              entry.params.sourceName = jobProfile.jobName || '職業技能';
              if (!options.playerActiveEffects) options.playerActiveEffects = [];
              options.playerActiveEffects = addOrStackCardEffect(options.playerActiveEffects, entry);
            }
          }
        }
        // 重骰可能改變全 1 / 全 6，故在此重新判定
        const allMin2 = diceRolls.every((f) => f === 1);
        const allMax2 = diceRolls.every((f) => f === faces);
        diceOverride = null;
        if (allMax2 && pStats.allMaxMult != null) diceOverride = Number(pStats.allMaxMult);
        else if (allMin2 && pStats.allMinMult != null) diceOverride = Number(pStats.allMinMult);
        const allMin = allMin2, allMax = allMax2;

        const _pips = diceRolls.map((f) => DICE_PIPS[f - 1] || `【${f}】`).join("");
        if (allMax && diceOverride != null) {
          log.push(`🎲 **擲出 ${_pips}　—　全六！命運之骰全開，本回合傷害 ${Math.round(diceOverride * 100)}%！**`);
        } else if (allMin && diceOverride != null) {
          log.push(`🎲 擲出 ${_pips}　—　全一…手氣爛透了，本回合傷害只剩 ${Math.round(diceOverride * 100)}%。`);
        } else {
          log.push(`🎲 擲出 ${_pips}`);
        }

        // ── 賭神：手氣正旺（兩顆傷害骰平均 >3 疊層、<3 歸零、=3 維持；跨場沿用）──
        if (diceGodCfg && diceRolls.length >= 2) {
          const _avg = (diceRolls[0] + diceRolls[1]) / 2;
          if (_avg > 3) {
            if (_diceLuck < _diceLuckCap) {
              _diceLuck = Math.min(_diceLuckCap, _diceLuck + 1);
              log.push(`🀄 手氣正旺！（${_diceLuck} 層，傷害 +${_diceLuck * _diceLuckPct}%）`);
            }
          } else if (_avg < 3 && _diceLuck > 0) {
            _diceLuck = 0;
            log.push(`🀄 手氣轉冷……傷害回到基礎。`);
          }
        }

        // ── 賭神：命運骰（集滿 ${_diceGaugeMax} 格的那回合改丟 3 顆）──
        //    第三顆骰出 N ＝ 本回合 N 連擊，每一擊都是前面兩顆骰子的傷害
        //    （骰面沿用循環、各擊獨立擲爆擊）；放完歸零重集。
        if (diceGodCfg && outcome === null && mHp > 0) {
          _diceGrids = Math.min(_diceGaugeMax, _diceGrids + 1);
          if (_diceGrids >= _diceGaugeMax) {
            _diceGrids = 0;
            const _fate = 1 + Math.floor(Math.random() * faces);
            log.push(`🎰 **命運骰**擲出 ${DICE_PIPS[_fate - 1] || _fate}　——　本回合 **${_fate} 連擊**！每一擊都是 ${_pips} 的傷害！`);
            if (_fate > 1) {
              const _base2 = diceRolls.slice(0, _segCount);
              diceRolls = Array.from({ length: _segCount * _fate }, (_, i) => _base2[i % _segCount]);
            }
          } else {
            // 每次累積都要有戰報行：前端命運值格靠這行逐回合亮格（格式勿改）
            log.push(`⚡ 命運值 +1（${_diceGrids}/${_diceGaugeMax}）`);
          }
        }
      }
      // 取第 n 段（0-indexed）的骰面倍率；賭神再乘手氣正旺（每層 +2%）
      const diceMultFor = (idx) => {
        if (!diceRolls || !Array.isArray(_faceMults)) return 1;
        const _luckMult = diceGodCfg ? (1 + _diceLuck * _diceLuckPct / 100) : 1;
        if (diceOverride != null) return diceOverride * _luckMult;
        const face = diceRolls[idx];
        if (!face) return 1;
        return (Number(_faceMults[face - 1]) || 1) * _luckMult;
      };

      // ── on_attack 觸發：武器附加狀態類職業 proc（揮擊即判定，閃避也算；揮空 critFail/fail 已跳過）──
      //    這些 proc 不依賴命中、也不依賴傷害數值（毒/暈/燒/冰/降命中/降攻防/緩速/護盾/治療/淨化/驅散/增益/斬殺）。
      //    需要 dmg 數值的 B 類（proc_extra_hit / proc_chain_hit）仍留在命中後處理。
      if (outcome === null && mHp > 0) {
        const playerHpPct = pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100;
        const monsterHpPct = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
        for (const pe of jobProfile.activeJobEffects) {
          if (pe.trigger !== 'on_hit' && pe.trigger !== 'on_attack') continue;
          if (pe.key === 'proc_extra_hit' || pe.key === 'proc_chain_hit') continue; // B 類：需要 dmg，留待命中後
          if (!procEffectApplies(pe, playerHpPct, monsterHpPct)) continue;
          const procChanceBonus = pe.key === 'proc_poison' ? extraHighHpPoisonChance : 0;
          const procChance = Math.min(100, Math.max(0, (Number(pe.chance) || 100) + procChanceBonus));
          if (Math.random() * 100 >= procChance) continue;
          const pp = pe.params || {};
          const dur = pe.duration || { mode: 'turns', value: 3 };

          if (pe.key === 'proc_poison') {
            const dexBonus = Number(pp.dexMultiplier ?? 0) * (pStats.dex || 0);
            const poisonPct = Number(pp.value ?? 0.5) + dexBonus;
            const existing = monsterActiveEffects.find(e => e.key === 'poison' && effectIsActive(e, round));
            const currentPct = existing ? Number(existing.params?.value ?? poisonPct) : 0;
            const newPct = Math.min(Number(pp.maxPct ?? 1.5), currentPct > 0 ? currentPct + Number(pp.stackAdd ?? poisonPct) : poisonPct);
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'poison', params: { value: newPct, mode: 'pct', duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:poison'
            });
            log.push(`☠️ 匕首淬毒！${mName} 中毒（每回合最大 HP ${newPct.toFixed(2)}% 毒傷）！`);
          } else if (pe.key === 'proc_stun') {
            const stunDur = Number(dur?.value ?? 3);
            if (applyMonsterStun(stunDur, round)) {
              const _d = stunRoundsLeft;
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'stun', params: { value: 100, duration: { mode: 'turns', value: _d } },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:stun'
              });
              log.push(`😵 ${mName} 被重擊擊暈！接下來 ${_d} 回合無法攻擊！`);
            } else if (monsterIsBossUnit) {
              log.push(`🛡️ ${mName} 暫時對擊暈免疫。`);
            }
          } else if (pe.key === 'burn') {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'burn', params: { value: Number(pp.value ?? 0.8), mode: pp.mode || 'pct', duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:burn'
            });
            log.push(`🔥 ${mName} 被燒傷！每回合受到最大 HP ${pp.value ?? 0.8}% 灼燒傷害！`);
          } else if (pe.key === 'hit_down') {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'hit_down', params: { value: Number(pp.value ?? 15), duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:hit_down'
            });
            log.push(`⚡ ${mName} 被麻痺！命中率降低 ${pp.value ?? 15}！`);
          } else if (pe.key === 'freeze') {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'freeze', params: { bossImmune: pp.bossImmune ?? true, duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:freeze'
            });
            log.push(`❄️ ${mName} 被冰凍！下回合無法行動！`);
          } else if (pe.key === 'proc_bleed') {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'bleed', params: { value: Number(pp.value ?? 10), mode: pp.mode || 'pct', duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:bleed'
            });
            log.push(`🩸 ${mName} 流血！每回合受到 **${pp.value ?? 10}%** 傷害！`);
          } else if (pe.key === 'proc_slow') {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'slow', params: { value: Number(pp.value ?? 30), duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:slow'
            });
            log.push(`🐌 ${mName} 被緩速！速度大幅降低！`);
          } else if (pe.key === 'proc_def_down') {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'def_down', params: { value: Number(pp.value ?? 20), duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:def_down'
            });
            log.push(`🛡️💢 ${mName} 防禦被擊潰！DEF -${pp.value ?? 20}！`);
          } else if (pe.key === 'proc_atk_down') {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'atk_down', params: { value: Number(pp.value ?? 20), duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:atk_down'
            });
            log.push(`⚔️💢 ${mName} 攻擊被削弱！ATK -${pp.value ?? 20}！`);
          } else if (pe.key === 'proc_execute') {
            const execThr = Number(pp.thresholdPct ?? 20);
            const monsterHpPctNow = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
            if (monsterHpPctNow <= execThr) {
              log.push(`💀 **斬殺**！${mName} 被直接擊殺！`);
              totalDamage += mHp;
              mHp = 0;
              outcome = "win";
              break;
            }
          } else if (pe.key === 'proc_heal') {
            const healAmt = Math.max(1,
              Math.round((pStats.maxHp || 100) * (Number(pp.value ?? 5) / 100)) + intHealBonus(pStats));
            _healLogged(healAmt, (actual) => `💚 戰鬥回復！恢復 **${actual}** HP！（你剩 ${pHp}）`);
          } else if (pe.key === 'proc_shield') {
            const shieldAmt = Math.max(1,
              Math.round((pStats.maxHp || 100) * (Number(pp.value ?? 10) / 100)) + intShieldBonus(pStats));
            options.playerActiveEffects = options.playerActiveEffects || [];
            options.playerActiveEffects = upsertActiveEffectBySource(options.playerActiveEffects, {
              key: 'shield', params: { value: shieldAmt, amount: shieldAmt, duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:shield'
            });
            log.push(`🛡️ 護盾觸發！獲得 **${shieldAmt}** 點護盾！`);
          } else if (pe.key === 'proc_cleanse') {
            if (Array.isArray(options.playerActiveEffects)) {
              const before = options.playerActiveEffects.length;
              options.playerActiveEffects = options.playerActiveEffects.filter(e => {
                if (!e) return false;
                return !['poison','burn','bleed','shock_dot','curse_dot','stun','freeze','sleep','silence','slow','blind','fear','root','disarm','confuse','charm','dark_curse','atk_down','def_down','hit_down'].includes(e.key);
              });
              if (options.playerActiveEffects.length < before) {
                log.push(`✨ **淨化**！移除了身上的負面狀態！`);
              }
            }
          } else if (pe.key === 'proc_dispel') {
            if (Array.isArray(monsterActiveEffects)) {
              const before = monsterActiveEffects.length;
              monsterActiveEffects = monsterActiveEffects.filter(e => {
                if (!e) return false;
                return !['atk_up','def_up','mdef_up','crit_rate_up','crit_damage_up','speed_up','final_damage_up','dodge_up','hit_up','heal_over_time','life_regen','shield','barrier','invincible_short','damage_reduction'].includes(e.key);
              });
              if (monsterActiveEffects.length < before) {
                log.push(`🌀 **驅散**！${mName} 的增益效果被移除！`);
              }
            }
          } else if (pe.key === 'proc_gain_buff') {
            const buffKey = String(pp.buffKey || 'atk_up');
            options.playerActiveEffects = options.playerActiveEffects || [];
            options.playerActiveEffects = upsertActiveEffectBySource(options.playerActiveEffects, {
              key: buffKey, params: { value: Number(pp.value ?? 15), duration: dur },
              appliedAt: round, sourceType: 'job_proc', sourceId: `badge:gain_${buffKey}`
            });
            log.push(`💫 增益觸發！獲得 ${buffKey} +${pp.value ?? 15}！`);
          }
        }
      }
      if (outcome !== null) break;

      // 大成功 / 完美：跳過 HIT/DODGE 必中
      const forceHit = (atkTier === 'great' || atkTier === 'perfect');

      if (monsterIsStunned || forceHit || options.forcePlayerHit || (sageCfg && _sageMistRound === round) || Math.random() * 100 < hitChance) {
        // 破防判定（斧）
        const isBreak = Math.random() * 100 < pStats.armorBreakChance;
        const effectiveDef = isBreak ? 0 : Math.max(0, adjustedMCalc.def * (1 - Math.min(95, roundMonsterDefDownPct) / 100));
        // 法杖無視怪物 DEF 的 bypassMonsterDefPct%（預設0，法杖50）
        const bypassPct = pStats.bypassMonsterDefPct ?? 0;
        // 被動「山碎」（矮人戰士長）：對暈眩中的目標無視防禦%。
        // 兩種暈眩都算——回合暈眩(stunRoundsLeft) 與 巨神震擊的時間暈眩。
        const _stunBypassPct = (stunMastery && _targetStunnedNow(round))
          ? Math.max(0, Number(stunMastery.defIgnoreVsStunned) || 0)
          : 0;
        const combinedBypassPct = Math.min(100, Math.max(0, bypassPct + playerDefIgnorePct + roundPartyDefIgnorePct + _stunBypassPct));
        const finalDef = Math.max(0, effectiveDef * (1 - combinedBypassPct / 100));

        let conditionalBonusMultiplier = getRoundTargetDamageMultiplier();
        // 怪物圖鑑加成：對該怪累積擊殺愈多，傷害愈高（共用上限目前 15%；由呼叫端依玩家進度計算後傳入）
        // 上限預設＝圖鑑基準（shared/bestiary MAX_BONUS_PCT，2026-08-04 起 15）；
        // 兵聖「知彼」由呼叫端傳放大後的 bestiaryBonusCapPct
        const _bestiaryDefaultCap = (() => {
          try { return require("./bestiary").MAX_BONUS_PCT; } catch (_) { return 15; }
        })();
        const _bestiaryCap = Number(options.bestiaryBonusCapPct) > 0 ? Number(options.bestiaryBonusCapPct) : _bestiaryDefaultCap;
        const _bestiaryBonusPct = Math.max(0, Math.min(_bestiaryCap, Number(options.bestiaryBonusPct) || 0));
        if (_bestiaryBonusPct > 0) {
          conditionalBonusMultiplier *= (1 + _bestiaryBonusPct / 100);
        }
        if (playerBonusVsPoisonedPct > 0 && monsterActiveEffects.some(e => e.key === 'poison' && effectIsActive(e, round))) {
          conditionalBonusMultiplier *= (1 + playerBonusVsPoisonedPct / 100);
        }
        // ※ bonus_vs_element（對特定屬性怪物增傷）**不在這層**：
        //   它與「屬性相剋」同屬屬性系統，若放這層會先被防禦稀釋（+20% 實測只剩約 +10%），
        //   而相剋 ×1.3 是在終傷層＝真的 +30%，兩個都叫「屬性」卻差很多、玩家無法從描述判斷。
        //   故一併移到終傷層（見 playerHitMult），讓卡片寫 +20% 就真的是 +20%。
        if (playerBonusVsDebuffedPct > 0 && hasAnyDebuff(monsterActiveEffects, round)) {
          conditionalBonusMultiplier *= (1 + playerBonusVsDebuffedPct / 100);
        }
        if (playerBonusVsBurningPct > 0 && monsterActiveEffects.some(e => e.key === 'burn' && effectIsActive(e, round))) {
          conditionalBonusMultiplier *= (1 + playerBonusVsBurningPct / 100);
        }
        if (playerBonusVsStunnedPct > 0 && _targetStunnedNow(round)) {
          conditionalBonusMultiplier *= (1 + playerBonusVsStunnedPct / 100);
        }
        if (playerBonusVsBossPct > 0 && (options.monsterIsBoss || options.isBoss || options.isWorldBoss || mCalc?.isBoss)) {
          conditionalBonusMultiplier *= (1 + playerBonusVsBossPct / 100);
        }
        if (playerBonusVsDefBrokenPct > 0 && (isBreak || monsterActiveEffects.some(e => e.key === 'def_down' && effectIsActive(e, round)))) {
          conditionalBonusMultiplier *= (1 + playerBonusVsDefBrokenPct / 100);
        }
        if (playerBonusWhenHpHighPct > 0) {
          const hpPctNow = (pStats.maxHp > 0) ? (pHp / pStats.maxHp) * 100 : 0;
          if (hpPctNow >= playerBonusWhenHpHighThreshold) {
            conditionalBonusMultiplier *= (1 + playerBonusWhenHpHighPct / 100);
          }
        }
        if (playerBonusWhenHpLowPct > 0) {
          const hpPctNow = (pStats.maxHp > 0) ? (pHp / pStats.maxHp) * 100 : 0;
          if (hpPctNow <= playerBonusWhenHpLowThreshold) {
            conditionalBonusMultiplier *= (1 + playerBonusWhenHpLowPct / 100);
          }
        }
        if (playerLastStandBonusPct > 0) {
          const hpPctNow = (pStats.maxHp > 0) ? (pHp / pStats.maxHp) * 100 : 0;
          if (hpPctNow <= playerLastStandThresholdPct) {
            conditionalBonusMultiplier *= (1 + playerLastStandBonusPct / 100);
          }
        }
        if (playerBonusFirstHitPct > 0 && round === 1 && combatStats.attackCount === 0) {
          conditionalBonusMultiplier *= (1 + playerBonusFirstHitPct / 100);
        }
        // 龜甲庇護・破殼而出：殼破後剩餘戰鬥傷害提升
        if (_tshellBroken && _tshellCfg && _tshellCfg.breakDmgPct > 0) {
          conditionalBonusMultiplier *= (1 + _tshellCfg.breakDmgPct / 100);
        }
        // ── 守護右：擁有護盾時增傷 ──
        if (playerBonusWhileShieldedPct > 0 && Array.isArray(options.playerActiveEffects)) {
          const hasShield = options.playerActiveEffects.some(e => {
            if (!e || (e.key !== 'shield' && e.key !== 'barrier')) return false;
            if (!effectIsActive(e, round)) return false;
            const amt = Number(e.params?.amount ?? e.params?.value ?? 0);
            return amt > 0;
          });
          if (hasShield) {
            conditionalBonusMultiplier *= (1 + playerBonusWhileShieldedPct / 100);
          }
        }
        // ── 戰意左：攻擊累積 STR/DEX → 直接灌進 atk multiplier（1 stack ≈ 1% 攻擊）──
        // 記下本次主攻擊套用的層數：連擊傷害以此為基準往上疊（主攻擊命中後那一層算給第一段連擊）
        const attackStackPctBase = stackOnHitStacks;
        if (stackOnHitStacks > 0) {
          const offBonusPct = stackOnHitStacks;
          conditionalBonusMultiplier *= (1 + offBonusPct / 100);
        }
        if (pStats.hasDwarfWarriorBadge && pStats.weaponType && pStats.weaponType.startsWith("mace")) {
          if (_targetStunnedNow(round) && Number.isFinite(Number(pStats.dwarfWarriorBonusVsStunnedPct)) && Number(pStats.dwarfWarriorBonusVsStunnedPct) > 0) {
            conditionalBonusMultiplier *= (1 + Number(pStats.dwarfWarriorBonusVsStunnedPct) / 100);
          }
        }
        // ── 狂戰士開場宣告（血祭／戰意全開）：第一次真正出手時說一次。
        //    不能綁「第 1 回合第一擊」——那一擊若落空會提前 continue，宣告永遠不會出現。
        if (!_berserkAnnounced) {
          _berserkAnnounced = true;
          // 血祭的宣告與扣血在回合開頭已處理，這裡只留戰意全開
          if (Number(options.warGaugeCritBonus) > 0) {
            log.push(`🔥 **戰意全開**！集滿的鬥氣轟然炸裂——本場爆擊率 **+${Math.round(Number(options.warGaugeCritBonus))}**！`);
          }
        }
        // ── 血怒（狂戰士）：依「當下」HP 缺口加攻，乘進條件乘數 →
        //    attackBase/爆擊路徑自然繼承，不需要各處另算 ──
        if (bloodRage && pStats.maxHp > 0) {
          const _missPct = Math.max(0, 100 - (pHp / pStats.maxHp) * 100);
          const _ragePct = Math.min(Number(bloodRage.capPct) || 50, _missPct * (Number(bloodRage.perMissPct) || 0.6));
          if (_ragePct >= 1) {
            conditionalBonusMultiplier *= (1 + _ragePct / 100);
            if (!_bloodRageAnnounced && _ragePct >= 15) {
              _bloodRageAnnounced = true;
              log.push(`🩸 傷口在燃燒——**血怒** 甦醒，攻擊力隨失血高漲（此刻 **+${Math.round(_ragePct)}%**）！`);
            }
          }
        }
        // ── 盜靈「巧手」：大成功以上（含完美）本擊額外變痛 ──
        //    乘進條件乘數 → attackBase 與爆擊路徑都自然繼承（爆擊會從 attackBase 重算，
        //    直接改階級倍率會被丟掉；同血怒的作法）。
        if (spiritThiefCfg?.deftHands && (atkTier === 'great' || atkTier === 'perfect')) {
          const _deft = Number(spiritThiefCfg.deftHands.aboveGreatMult) || 1;
          if (_deft > 1) conditionalBonusMultiplier *= _deft;
        }
        // 劍鬼「斬」（2026-07-22 改版）：氣力 3 格滿 → 本回合第一擊自動施放。
        // 舊的手動路徑（comboBurstMult）保留給舊客戶端相容，但按鈕已移除。
        let _burstMult = 1;
        if (!_burstUsed && Number(options.comboBurstMult) > 1 && round === 1 && a === 0) {
          _burstMult = Number(options.comboBurstMult);
          _burstUsed = true;
          log.push(`🗡️ **斬**！連段盡數傾瀉於這一擊——傷害 **×${_burstMult.toFixed(1)}**！`);
        } else if (oniCfg && _oniBurstNext && a === 0) {
          _oniBurstNext = false;
          _burstMult = Math.max(1, _oniMult);
          log.push(`🗡️ **斬**！氣力滿溢、一刀既出——傷害 **×${_burstMult.toFixed(1)}**（無視防禦與等級差）！`);
        }
        // 一刀流：斬不吃等級壓制（下面另外也跳過防禦計算）
        const _lvMultForHit = _burstMult > 1 ? 1 : playerAttackLevelMult;
        const attackBase = Math.max(
          1,
          Math.round((pStats.atk + roundAtkFlatBonus) * _burstMult * _offhandMultRound * playerAtkMultiplier * roundDmgMultiplier * roundBossDmgMultiplier * roundEliteDmgMultiplier * playerFinalDamageMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier * conditionalBonusMultiplier * _lvMultForHit)
        );
        // 新公式 B：flatDef 在 ATK 階段壓制（傳 pStats.atk 作為 rawAtk）
        // 一刀流：斬「無視防禦與等級差」，只算自己的攻擊力 × 倍率（仍可爆擊，見下方爆擊判定）
        let dmg = _burstMult > 1 ? rollDmg(attackBase) : rollDmg(applyDefense(attackBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk));

        // ── 套攻擊階級乘數（成功 ×1.0 / 大成功 ×1.3；完美走爆擊另算）──
        const atkTierMult = ATTACK_TIER_MULT[atkTier] ?? 1.0;
        if (atkTier !== 'perfect' && atkTierMult !== 1.0) {
          dmg = Math.max(1, Math.round(dmg * atkTierMult));
        }

        // ── 盜靈「得手」：大成功以上判定盜取；每隻怪只能偷一次（含世界王整隻）──
        //    成功 → 這一擊額外變痛 + 標記 stealTriggered（呼叫端負責發物品與狀態落地）
        if (atkTier === 'great' || atkTier === 'perfect') {
          combatStats.greatHitCount += 1;
          const _stealCfg = spiritThiefCfg?.steal;
          if (_stealCfg && !_stealUsed) {
            const _lukNow = (pStats.luk || 0) + (playerStatBonus.luk || 0);
            const _chance = Math.max(0, Math.min(100,
              (Number(_stealCfg.baseChancePct) || 0) + _lukNow * (Number(_stealCfg.lukPerPoint) || 0)
            ));
            if (Math.random() * 100 < _chance) {
              _stealUsed = true;
              combatStats.stealTriggered = true;
              const _mult = Number(_stealCfg.hitDamageMult) || 1;
              if (_mult > 1) dmg = Math.max(1, Math.round(dmg * _mult));
              log.push(`🗝️ **盜靈的手法**——趁隙探入，從 ${mName} 身上得手了！那一擊格外刁鑽！`);
              // 「順手牽羊」：得手順帶的增益（非技能、無成本），走效果清單才吃得到 duration
              const _rb = _stealCfg.riderBuff;
              if (_rb && Array.isArray(options.playerActiveEffects)) {
                const _turns = Math.max(1, Number(_rb.turns) || 1);
                const _push = (key, value) => {
                  if (!(Number(value) > 0)) return;
                  options.playerActiveEffects.push({
                    key, target: "self", trigger: "passive",
                    params: { value: Number(value), duration: { mode: "turns", value: _turns } },
                    appliedAt: round,
                    sourceType: "job_passive", sourceId: "spiritthief:rider",
                  });
                };
                _push("luk_up", _rb.lukUp);
                _push("crit_rate_up", _rb.critRateUp);
                log.push(`✨ **順手牽羊**——得手的餘勢讓手感順了起來（LUK +${_rb.lukUp}、爆擊 +${_rb.critRateUp}，${_turns} 回合）`);
              }
            }
          }
        }


        // ── 擲防禦階級（4 階）──
        const defTierProbs = calcDefenseTierProbs(adjustedMCalc.dex || 0, adjustedMCalc.luk || 0);
        const defTier = _burstMult > 1 ? 'hit' : rollDefenseTier(defTierProbs);   // 一刀流：斬不吃對方的防禦擲骰
        const defTierMult = DEFENSE_TIER_MULT[defTier] ?? 1.0;
        if (defTierMult !== 1.0) {
          dmg = Math.max(1, Math.round(dmg * defTierMult));
        }

        // Crit check
        let isCrit = false;
        let isBigCrit = false; // 骰・命運之輪:本擊是否觸發方差大爆

        let wasBlocked = false;
        let blockNote = "";
        if (adjustedMCalc.blockChance > 0 && Math.random() * 100 < adjustedMCalc.blockChance) {
          wasBlocked = true;
          blockNote = `，但 ${mName} ${rand(BLOCK_PHRASES)}`;
        }

        // 先記住「未爆擊」的傷害，格擋穿防時會回退到這個值
        const nonCritDamageBase = dmg;
        if (a === 0) _lastMainBase = nonCritDamageBase; // 追加打擊（神射手/兵聖）的等值基準

        // 爆擊判定：完美攻擊階級 = 必爆擊；否則照原本爆擊率
        const effectiveCrit = Math.min(100, (pStats.crit || 0) + playerCritRateBonus + extraHighHpCrit + roundPartyCritRateBoostPct + roundCritStatBonus);
        isCrit = (atkTier === 'perfect') || (Math.random() * 100 < effectiveCrit);

        let finalDamage = dmg;
        if (isCrit) {
          // 一刀流：斬爆擊時同樣無視防禦
          const critPostDef = _burstMult > 1
            ? attackBase
            : applyDefense(attackBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk);
          const critMultiplier = 2 * playerCritDamageMultiplier * tierCritDamageMultiplier;
          finalDamage = Math.round(rollDmg(critPostDef) * critMultiplier);
        }

        if (wasBlocked) {
          if (isCrit) {
            finalDamage = Math.max(1, Math.round(nonCritDamageBase));
            blockNote += `，因對手爆擊擊破防禦，改以未爆擊傷害計算！`;
          } else {
            finalDamage = 1;
            blockNote += `，傷害降至 **1**！`;
          }
        }

        if (adjustedMCalc.damageReductionPct > 0) {
          finalDamage = Math.max(1, Math.round(finalDamage * (1 - Math.min(95, adjustedMCalc.damageReductionPct) / 100)));
        }
        if (adjustedMCalc.damageTakenMultiplier > 1) {
          finalDamage = Math.max(1, Math.round(finalDamage * adjustedMCalc.damageTakenMultiplier));
        }
        // 骰・命運之輪:方差大爆 — 一般暴擊已由 crit_rate_down 關閉,改用 LUK 縮放的低機率超高倍
        if (varianceCrit && !isCrit && finalDamage > 0) {
          const bigChance = (pStats.luk || 0) * varianceCrit.chancePerLuk;
          if (Math.random() * 100 < bigChance) {
            finalDamage = Math.max(1, Math.round(finalDamage * varianceCrit.mult));
            isBigCrit = true;
          }
        }
        if (monsterActiveEffects.some(e => e.key === 'invincible_short' && effectIsActive(e, round))) {
          finalDamage = 0;
        }

        // 屠龍特攻等裝備「最終傷害%」：在防禦/爆擊/減傷全部算完後，對最終傷害整體乘上倍率（= 總傷害 ×120%）
        { const _ezm = equipZoneFinalDmgMult * roundScaleMult(round); if (_ezm !== 1 && finalDamage > 0) finalDamage = Math.max(1, Math.round(finalDamage * _ezm)); }

        // 武器主屬性追加傷害：終傷全部算完後，額外加上「武器主屬性 × 1.5」固定點數（不被防禦扣，補強物理）
        if (finalDamage > 0) finalDamage += weaponMainBonusRound;

        // ── 骰子武器：主擊吃第 1 顆骰的骰面倍率 ──
        //    刻意放在最尾端（含爆擊與武器主屬性固定加成之後），讓骰面確實縮放「整擊傷害」。
        //    若放在前面，爆擊路徑會從 attackBase 重算而丟失骰面，固定加成也不會被縮放，
        //    結果是骰面幾乎影響不到最終數字（實測 1+1 只掉到 84%、6+6 只到 144%）。
        {
          const _mainDiceMult = diceMultFor(0);
          if (_mainDiceMult !== 1 && finalDamage > 0) finalDamage = Math.max(1, Math.round(finalDamage * _mainDiceMult));
        }

        // 每擊傷害上限（金錢袋怪等「必定格擋、每擊只扣N」）：所有加成/爆擊算完後硬性夾住上限
        if (adjustedMCalc.incomingDamageCap > 0 && finalDamage > adjustedMCalc.incomingDamageCap) {
          finalDamage = adjustedMCalc.incomingDamageCap;
        }

        dmg = applyBossVuln(finalDamage); // 世界王部位弱點倍率算進終傷(牙狼不同流派×0.3)

        // 採證：單次傷害異常爆量(> 攻擊力 ×10)時，把完整拆解印到後台 log，直指「傷害被放大」的兇手
        try {
          const _atk = Number(pStats.atk) || 1;
          if (dmg > _atk * 10) {
            const _fx = (options.playerActiveEffects || [])
              .map((e) => `${e && e.key}${e && e.params && e.params.value != null ? ":" + e.params.value : ""}`).join(",");
            console.warn(`[DmgAudit] ${playerBattleName} vs ${mName} R${round}: dmg=${dmg} atk=${Math.round(_atk)} ×${(dmg / _atk).toFixed(1)} crit=${isCrit} condMult=${typeof conditionalBonusMultiplier === "number" ? conditionalBonusMultiplier.toFixed(2) : "?"} attackBase=${typeof attackBase === "number" ? Math.round(attackBase) : "?"} finalDef=${typeof finalDef === "number" ? finalDef : "?"} effects=[${_fx}]`);
          }
        } catch (_) { /* 採證失敗不影響戰鬥 */ }

        // 三元牌：主擊改為 1/N 並吃連擊增傷（連擊戒/龍鱗）→ 分成 N 段（算連擊；補打段見下方各自獨立擲爆擊）
        if (playerTripleStrike >= 2) dmg = Math.max(1, Math.round(dmg / playerTripleStrike * (pStats.comboDamageMultiplier || 1)));
        // 嵐暴（元素師）：主手攻擊改為 3 段法術彈的第 1 段（每段＝pctPerHit%；副手追擊不縮放、維持單追擊）
        if (stormVolleyCfg && a === 0) dmg = Math.max(1, Math.round(dmg * (Number(stormVolleyCfg.pctPerHit) || 70) / 100));

        if (_noPlayerAtk) dmg = 0; // 沒苦硬吃：一般攻擊(＋衍生連擊/三元補打)最終傷害歸零
        mHp -= dmg;
        totalDamage += dmg;
        // ── 戰意左：每次出手累積 stack（命中算一次）──
        if (stackOnHitValue > 0 && stackOnHitStacks < stackOnHitCap) {
          stackOnHitStacks = Math.min(stackOnHitCap, stackOnHitStacks + stackOnHitValue);
          log.push(`🐉 **龍王戰意**：出手疊加！攻擊 **+${stackOnHitStacks}%**（最高 +${stackOnHitCap}%）`);
        }
        // ── 吸血右：擊殺回血（首次怪物 HP 歸零時觸發）──
        if (mHp <= 0 && playerOnKillHealPct > 0 && pHp > 0 && pStats.maxHp > 0) {
          const healAmt = Math.max(1, Math.round(pStats.maxHp * (playerOnKillHealPct / 100)));
          const before = pHp;
          pHp = _healPlayer(healAmt, { postMortem: true });   // 怪已死：聖人不轉傷害(不灌傷害榜)
          const actual = pHp - before;
          if (actual > 0) log.push(`💀 **擊殺回血**！回復 **${actual}** HP！（你剩 ${pHp} HP）`);
          // 避免重複觸發
          playerOnKillHealPct = 0;
        }
        const breakNote = isBreak ? "💥**破防**！" : "";
        let critNote = "";

        if (isCrit) {
          critNote = `✨**${rand(critPhrases)}**！`;
        }

        // 階級描述
        let atkTierNote = "";
        if (atkTier === 'great') atkTierNote = "⚡**大成功**！";
        else if (atkTier === 'perfect') atkTierNote = "🌟**完美**！";
        let defTierNote = "";
        if (defTier === 'crushed') defTierNote = "💢被爆打！";
        else if (defTier === 'reduce') defTierNote = "🛡️減傷！";
        else if (defTier === 'graze') defTierNote = "🌬️擦傷！";

        log.push(`⚔️ ${atkTierNote}${critNote}${breakNote}${rand(jobFlavor.hit)}，${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害${defTierNote ? `（${defTierNote.replace(/[!！]$/, "")}）` : ""}！（怪物剩 ${Math.max(0, mHp)} HP）`);

        // ── 嵐暴（元素師）：固定補打 2 段法術彈（每段＝pctPerHit%、各段獨立擲爆擊）──
        //    不吃連擊增傷、不算連擊；只作用主手（a===0），副手追擊維持原樣單追擊。
        if (stormVolleyCfg && a === 0 && mHp > 0) {
          let _svLifestealDmg = 0;
          const _svPct = (Number(stormVolleyCfg.pctPerHit) || 70) / 100;
          const _svBase = Math.max(1, Math.round(nonCritDamageBase * _svPct * (equipZoneFinalDmgMult * roundScaleMult(round))));
          const _svHits = Math.max(1, Math.floor(Number(stormVolleyCfg.hits) || 3));
          for (let _sv = 1; _sv < _svHits && mHp > 0; _sv++) {
            let svDmg = _svBase;
            const svCrit = (Math.random() * 100 < effectiveCrit);
            if (svCrit) svDmg = Math.max(1, Math.round(svDmg * 2 * playerCritDamageMultiplier * tierCritDamageMultiplier));
            // 2026-08-05 使用者定案：補打段**不吃武器主屬性加成**。
            // weaponMainBonus 是「終傷後追加主屬性×1.5 的固定傷害」，設計上一次攻擊加一次；
            // 原本每段都加＝一回合加三次，且加在減傷之後，怪物防禦完全擋不住（嵐暴超模主因之一）。
            if (_noPlayerAtk) svDmg = 0;
            svDmg = applyMonsterIncomingGuards(svDmg);
            mHp -= svDmg;
            totalDamage += svDmg;
            _svLifestealDmg += svDmg;
            const _svCritNote = svCrit ? `✨**${rand(critPhrases)}**！` : "";
            log.push(`🌩️ ${_svCritNote}**嵐暴・第 ${_sv + 1} 彈**！再造成 **${svDmg}** 點法術傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          }
          _applyLifesteal(_svLifestealDmg);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // ── 三元牌：固定補打 N-1 段（每段獨立擲爆擊、吃連擊增傷、吃地圖特攻；算連擊、可致命）──
        if (playerTripleStrike >= 2 && mHp > 0) {
          let _tsLifestealDmg = 0; // 三元補打累計傷害 → 迴圈結束一起吸血
          const _sanyuan = ["白", "發", "中"];
          // 每段基底＝未爆擊 1/N ×（地圖特攻/最終傷害%）→ 避免疊到主擊爆擊；再逐段各自吃連擊增傷+獨立爆擊
          const _tsCleanBase = Math.max(1, Math.round(nonCritDamageBase / playerTripleStrike * (equipZoneFinalDmgMult * roundScaleMult(round))));
          for (let _ts = 1; _ts < playerTripleStrike && mHp > 0; _ts++) {
            let tsDmg = Math.max(1, Math.round(_tsCleanBase * (pStats.comboDamageMultiplier || 1)));
            const tsCrit = (Math.random() * 100 < effectiveCrit);
            if (tsCrit) tsDmg = Math.max(1, Math.round(tsDmg * 2 * playerCritDamageMultiplier * tierCritDamageMultiplier));
            if (weaponMainBonus > 0) tsDmg += weaponMainBonus;
            tsDmg = applyMonsterIncomingGuards(tsDmg);
            if (_noPlayerAtk) tsDmg = 0;
            mHp -= tsDmg;
            totalDamage += tsDmg;
            _tsLifestealDmg += tsDmg;
            combatStats.comboCount += 1;
            const _pai = _sanyuan[_ts % _sanyuan.length];
            const _tsCritNote = tsCrit ? `✨**${rand(critPhrases)}**！` : "";
            log.push(`🀄 ${_tsCritNote}**三元・${_pai}**！再造成 **${tsDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          }
          _applyLifesteal(_tsLifestealDmg);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // ── 武器固定多段攻擊（骰子＝2 段）──
        //    與三元牌的差異：倍率已在 WEAPON_CONFIG 對半，所以這裡「不再除以段數」，
        //    而且**不計入連擊**（不加 comboCount、不吃連擊增傷、不受連擊率影響）。
        //    每段各自擲攻擊階級與爆擊，並各自吃一次武器主屬性追加傷害。
        // 嵐暴（元素師）：武器固定多段（骰子等）不生效——姿態自帶固定 3 段
        // 賭神命運骰回合：diceRolls 已展開成 2×N 段（骰面循環），段數以它為準
        const _weaponSegments = stormVolleyCfg ? 1 : Math.max(1, (Array.isArray(diceRolls) && diceRolls.length > 0) ? diceRolls.length : (Number(pStats.attackSegments) || 1));
        if (_weaponSegments >= 2 && mHp > 0) {
          let _segLifestealDmg = 0; // 武器多段(骰子)累計傷害 → 迴圈結束一起吸血
          for (let _seg = 1; _seg < _weaponSegments && mHp > 0; _seg++) {
            // 命中/揮空/迴避在攻擊一開始就判定完畢（見上方 hitChance 與攻擊階級），
            // 所以各段共用主擊的攻擊階級——不會出現「全六卻有一擲落空」這種矛盾。
            // 從 attackBase 重算（不沿用主擊的 nonCritDamageBase，否則會重複套用階級/防禦擲骰）
            let segDmg = rollDmg(applyDefense(attackBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk));
            const segTier = atkTier;
            const segTierMult = ATTACK_TIER_MULT[segTier] ?? 1.0;
            if (segTier !== 'perfect' && segTierMult !== 1.0) segDmg = Math.max(1, Math.round(segDmg * segTierMult));
            // 該段獨立擲防禦階級
            const segDefTier = rollDefenseTier(calcDefenseTierProbs(adjustedMCalc.dex || 0, adjustedMCalc.luk || 0));
            const segDefMult = DEFENSE_TIER_MULT[segDefTier] ?? 1.0;
            if (segDefMult !== 1.0) segDmg = Math.max(1, Math.round(segDmg * segDefMult));
            // 該段獨立擲爆擊
            const segCrit = (segTier === 'perfect') || (Math.random() * 100 < effectiveCrit);
            if (segCrit) segDmg = Math.max(1, Math.round(segDmg * 2 * playerCritDamageMultiplier * tierCritDamageMultiplier));
            // 減傷 → 地圖特攻/逐回合縮放 → 屬性相剋/世界王部位弱點 → 武器主屬性追加
            if (adjustedMCalc.damageReductionPct > 0) {
              segDmg = Math.max(1, Math.round(segDmg * (1 - Math.min(95, adjustedMCalc.damageReductionPct) / 100)));
            }
            const _segEzm = equipZoneFinalDmgMult * roundScaleMult(round);
            if (_segEzm !== 1) segDmg = Math.max(1, Math.round(segDmg * _segEzm));
            segDmg = applyBossVuln(segDmg);
            if (weaponMainBonusRound > 0) segDmg += weaponMainBonusRound;
            // 該段對應的骰面倍率（同主擊，放在最尾端縮放整擊）
            const _segDiceMult = diceMultFor(_seg);
            if (_segDiceMult !== 1) segDmg = Math.max(1, Math.round(segDmg * _segDiceMult));
            segDmg = applyMonsterIncomingGuards(segDmg, {
              damageReduction: false,
              bossVulnerability: false,
            });
            if (_noPlayerAtk) segDmg = 0;
            mHp -= segDmg;
            totalDamage += segDmg;
            _segLifestealDmg += segDmg;
            const segCritNote = segCrit ? `✨**${rand(critPhrases)}**！` : "";
            const segTierNote = segTier === 'great' ? "⚡**大成功**！" : segTier === 'perfect' ? "🌟**完美**！" : "";
            const segPip = diceRolls ? `${DICE_PIPS[diceRolls[_seg] - 1] || ""}` : "";
            log.push(`🎲 ${segPip}${segTierNote}${segCritNote}**第 ${_seg + 1} 擲**！再造成 **${segDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          }
          _applyLifesteal(_segLifestealDmg);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 擊暈判定（爆擊不觸發）
        let stunBonus = extraHighHpStun;
        // 矮人戰士：高血量擊暈加成（>60%，需拿槌子）
        if (pStats.hasDwarfWarriorBadge && pStats.weaponType && pStats.weaponType.startsWith("mace")) {
          if (pHp >= Math.ceil((pStats.maxHp || 1) * 0.60)) {
            stunBonus += pStats.dwarfWarriorHighHpStunBoost;
          }
        }
        const effectiveStunChance = (Number(pStats.stunChance) || 0) + stunBonus;
        if (!isCrit && Math.random() * 100 < effectiveStunChance) {
          // 走統一入口：世界王吃上限(1 回合／矮人戰士長 2 回合)與暈眩免疫，一般怪維持 3 回合。
          // 以前這裡直接 `stunRoundsLeft = weaponStunDur`，完全繞過上限 →「boss 最多暈 1 回合」形同虛設。
          const weaponStunDur = pStats.stunDuration || 3;
          if (applyMonsterStun(weaponStunDur, round)) {
            const _dur = stunRoundsLeft;
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'stun',
              params: { value: 100, duration: { mode: 'turns', value: _dur } },
              appliedAt: round,
              sourceType: 'job_proc',
              sourceId: 'dwarf_warrior:stun'
            });
            combatStats.stunCount += 1;
            log.push(`😵 ${mName} ${rand(stunPhrases)}！接下來 ${_dur} 回合無法攻擊！`);
          } else if (monsterIsBossUnit) {
            log.push(`🛡️ ${mName} 的巨軀仍在震盪的餘韻中，暫時對擊暈免疫。`);
          }
        }

        // ── Badge on_hit 效果觸發（僅 B 類：需要本擊 dmg 數值的 proc_extra_hit / proc_chain_hit）──
        //    A 類（毒/暈/燒/冰/降命中/降攻防/護盾/治療等）已於攻擊發起時（on_attack）觸發，見上方。
        if (mHp > 0) {
          const playerHpPct = pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100;
          const monsterHpPct = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
          for (const pe of jobProfile.activeJobEffects) {
            if (pe.trigger !== 'on_hit' && pe.trigger !== 'on_attack') continue;
            if (pe.key !== 'proc_extra_hit' && pe.key !== 'proc_chain_hit') continue; // A 類已在 on_attack 觸發
            if (!procEffectApplies(pe, playerHpPct, monsterHpPct)) continue;
            const procChanceBonus = pe.key === 'proc_poison' ? extraHighHpPoisonChance : 0;
            const procChance = Math.min(100, Math.max(0, (Number(pe.chance) || 100) + procChanceBonus));
            if (Math.random() * 100 >= procChance) continue;
            const pp = pe.params || {};
            const dur = pe.duration || { mode: 'turns', value: 3 };

            if (pe.key === 'proc_poison') {
              const dexBonus = Number(pp.dexMultiplier ?? 0) * (pStats.dex || 0);
              const poisonPct = Number(pp.value ?? 0.5) + dexBonus;
              const existing = monsterActiveEffects.find(e => e.key === 'poison' && effectIsActive(e, round));
              const currentPct = existing ? Number(existing.params?.value ?? poisonPct) : 0;
              const newPct = Math.min(Number(pp.maxPct ?? 1.5), currentPct > 0 ? currentPct + Number(pp.stackAdd ?? poisonPct) : poisonPct);
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'poison', params: { value: newPct, mode: 'pct', duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:poison'
              });
              log.push(`☠️ 匕首淬毒！${mName} 中毒（每回合最大 HP ${newPct.toFixed(2)}% 毒傷）！`);

            } else if (pe.key === 'proc_stun') {
              const stunDur = Number(dur?.value ?? 3);
              if (applyMonsterStun(stunDur, round)) {
                const _d = stunRoundsLeft;
                monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                  key: 'stun', params: { value: 100, duration: { mode: 'turns', value: _d } },
                  appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:stun'
                });
                log.push(`😵 ${mName} 被重擊擊暈！接下來 ${_d} 回合無法攻擊！`);
              } else if (monsterIsBossUnit) {
                log.push(`🛡️ ${mName} 暫時對擊暈免疫。`);
              }

            } else if (pe.key === 'burn') {
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'burn', params: { value: Number(pp.value ?? 0.8), mode: pp.mode || 'pct', duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:burn'
              });
              log.push(`🔥 ${mName} 被燒傷！每回合受到最大 HP ${pp.value ?? 0.8}% 灼燒傷害！`);

            } else if (pe.key === 'hit_down') {
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'hit_down', params: { value: Number(pp.value ?? 15), duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:hit_down'
              });
              log.push(`⚡ ${mName} 被麻痺！命中率降低 ${pp.value ?? 15}！`);

            } else if (pe.key === 'freeze') {
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'freeze', params: { bossImmune: pp.bossImmune ?? true, duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:freeze'
              });
              log.push(`❄️ ${mName} 被冰凍！下回合無法行動！`);

            } else if (pe.key === 'proc_bleed') {
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'bleed', params: { value: Number(pp.value ?? 10), mode: pp.mode || 'pct', duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:bleed'
              });
              log.push(`🩸 ${mName} 流血！每回合受到 **${pp.value ?? 10}%** 傷害！`);

            } else if (pe.key === 'proc_slow') {
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'slow', params: { value: Number(pp.value ?? 30), duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:slow'
              });
              log.push(`🐌 ${mName} 被緩速！速度大幅降低！`);

            } else if (pe.key === 'proc_def_down') {
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'def_down', params: { value: Number(pp.value ?? 20), duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:def_down'
              });
              log.push(`🛡️💢 ${mName} 防禦被擊潰！DEF -${pp.value ?? 20}！`);

            } else if (pe.key === 'proc_atk_down') {
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'atk_down', params: { value: Number(pp.value ?? 20), duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:atk_down'
              });
              log.push(`⚔️💢 ${mName} 攻擊被削弱！ATK -${pp.value ?? 20}！`);

            } else if (pe.key === 'proc_extra_hit') {
              const extraDmg = applyMonsterIncomingGuards(Math.max(1, Math.round(dmg * Number(pp.damageMultiplier ?? 0.5))), {
                damageReduction: false, damageTaken: false, bossVulnerability: false,
              });
              mHp -= extraDmg;
              totalDamage += extraDmg;
              log.push(`✨ 追加攻擊！對 ${mName} 額外造成 **${extraDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              if (mHp <= 0) { outcome = "win"; break; }

            } else if (pe.key === 'proc_chain_hit') {
              const chainCount = Math.max(1, Math.floor(Number(pp.chainCount ?? 2)));
              const chainPct = Number(pp.damageMultiplier ?? 0.3);
              for (let c = 0; c < chainCount; c++) {
                const chainDmg = applyMonsterIncomingGuards(Math.max(1, Math.round(dmg * chainPct)), {
                  damageReduction: false, damageTaken: false, bossVulnerability: false,
                });
                mHp -= chainDmg;
                totalDamage += chainDmg;
                log.push(`⛓️ 連鎖打擊！對 ${mName} 造成 **${chainDmg}** 點傷害！`);
                if (mHp <= 0) { outcome = "win"; break; }
              }

            } else if (pe.key === 'proc_execute') {
              const execThr = Number(pp.thresholdPct ?? 20);
              const monsterHpPctNow = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
              if (monsterHpPctNow <= execThr) {
                log.push(`💀 **斬殺**！${mName} 被直接擊殺！`);
                totalDamage += mHp;
                mHp = 0;
                outcome = "win";
                break;
              }

            } else if (pe.key === 'proc_heal') {
              const healAmt = Math.max(1, Math.round((pStats.maxHp || 100) * (Number(pp.value ?? 5) / 100)));
              _healLogged(healAmt, (actual) => `💚 戰鬥回復！恢復 **${actual}** HP！（你剩 ${pHp}）`);

            } else if (pe.key === 'proc_shield') {
              const shieldAmt = Math.max(1, Math.round((pStats.maxHp || 100) * (Number(pp.value ?? 10) / 100)));
              options.playerActiveEffects = options.playerActiveEffects || [];
              options.playerActiveEffects = upsertActiveEffectBySource(options.playerActiveEffects, {
                key: 'shield', params: { value: shieldAmt, amount: shieldAmt, duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:shield'
              });
              log.push(`🛡️ 護盾觸發！獲得 **${shieldAmt}** 點護盾！`);

            } else if (pe.key === 'proc_cleanse') {
              if (Array.isArray(options.playerActiveEffects)) {
                const before = options.playerActiveEffects.length;
                options.playerActiveEffects = options.playerActiveEffects.filter(e => {
                  if (!e) return false;
                  return !['poison','burn','bleed','shock_dot','curse_dot','stun','freeze','sleep','silence','slow','blind','fear','root','disarm','confuse','charm','dark_curse','atk_down','def_down','hit_down'].includes(e.key);
                });
                if (options.playerActiveEffects.length < before) {
                  log.push(`✨ **淨化**！移除了身上的負面狀態！`);
                }
              }

            } else if (pe.key === 'proc_dispel') {
              if (Array.isArray(monsterActiveEffects)) {
                const before = monsterActiveEffects.length;
                monsterActiveEffects = monsterActiveEffects.filter(e => {
                  if (!e) return false;
                  return !['atk_up','def_up','mdef_up','crit_rate_up','crit_damage_up','speed_up','final_damage_up','dodge_up','hit_up','heal_over_time','life_regen','shield','barrier','invincible_short','damage_reduction'].includes(e.key);
                });
                if (monsterActiveEffects.length < before) {
                  log.push(`🌀 **驅散**！${mName} 的增益效果被移除！`);
                }
              }

            } else if (pe.key === 'proc_gain_buff') {
              const buffKey = String(pp.buffKey || 'atk_up');
              options.playerActiveEffects = options.playerActiveEffects || [];
              options.playerActiveEffects = upsertActiveEffectBySource(options.playerActiveEffects, {
                key: buffKey, params: { value: Number(pp.value ?? 15), duration: dur },
                appliedAt: round, sourceType: 'job_proc', sourceId: `badge:gain_${buffKey}`
              });
              log.push(`💫 增益觸發！獲得 ${buffKey} +${pp.value ?? 15}！`);
            }
          }
        }

        // ── on_hit_heal / on_crit_heal（戰鬥內回血）──
        if (mHp >= 0 && playerOnHitHealPct > 0) {
          const healAmt = Math.max(1, Math.round(dmg * (playerOnHitHealPct / 100)));
          _healLogged(healAmt, (actual) => `💚 命中回血！恢復 **${actual}** HP！`);
        }
        if (isCrit && playerOnCritHealPct > 0) {
          const healAmt = Math.max(1, Math.round(dmg * (playerOnCritHealPct / 100)));
          _healLogged(healAmt, (actual) => `💚✨ 暴擊回血！恢復 **${actual}** HP！`);
        }
        // ── 強制斬殺（execute_under_hp_pct）──
        if (mHp > 0 && playerExecuteUnderHpPct > 0) {
          const monsterHpPctNow = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;
          if (monsterHpPctNow <= playerExecuteUnderHpThreshold && Math.random() * 100 < playerExecuteUnderHpPct) {
            log.push(`💀 **斬殺**！${mName} 被直接擊殺！`);
            totalDamage += mHp;
            mHp = 0;
            outcome = "win";
          }
        }
        // 計數一次攻擊
        combatStats.attackCount += 1;
        // 這一回合有打到 → 回合數 +1（同回合多擊只算一次）
        if (_attackRoundMark !== round) { _attackRoundMark = round; combatStats.attackRounds += 1; }

        // ── 玩家吸血效果（主擊／副手；卡片技能與鮮血錨點共用）──
        _applyLifesteal(dmg);

        // ── 檢查怪物反彈傷害效果 ──
        if (Array.isArray(monsterActiveEffects)) {
          for (const reflectEff of monsterActiveEffects) {
            if (reflectEff && reflectEff.key === 'reflect_damage') {
              const reflectParams = reflectEff.params || {};
              const reflectPercent = Number(reflectParams.reflectPercent ?? reflectParams.value ?? 50);
              let reflectDmg = Math.max(1, Math.round(dmg * (reflectPercent / 100)));
              reflectDmg = _takePlayerIncomingDamage(reflectDmg, round, { damageType: "magic" });
              log.push(`🛡️ ${mName} 的甲殼反彈！你受到 **${reflectDmg}** 點反彈傷害！（你剩 ${Math.max(0, pHp)} HP）`);
              if (pHp <= 0) { outcome = "lose"; break; }
            }
          }
        }
        // ── 怪物反擊（counter）：被玩家攻擊時，value% 機率反擊造成受到傷害的 20%──
        if (outcome === null && Array.isArray(monsterActiveEffects)) {
          for (const ctEff of monsterActiveEffects) {
            if (!ctEff || ctEff.key !== 'counter') continue;
            const ctParams = ctEff.params || {};
            const ctDur = ctParams.duration || {};
            if (ctDur.mode === 'turns') {
              const ctEnd = (ctEff.appliedAt || 1) + (ctDur.value || 1);
              if (round > ctEnd) continue;
            }
            const counterChance = Number(ctParams.value || 30);
            if (Math.random() * 100 < counterChance) {
              const counterDmgPct = Number(ctParams.counterDamagePct ?? 20);
              let counterDmg = Math.max(1, Math.round(dmg * (counterDmgPct / 100)));
              counterDmg = _takePlayerIncomingDamage(counterDmg, round, { damageType: "physical" });
              log.push(`🦀 ${mName} **反擊**！以受到傷害的 ${counterDmgPct}% 回擊，造成 **${counterDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
              if (pHp <= 0) { outcome = "lose"; }
            }
            break; // 只處理第一個 counter 效果
          }
        }
        // 斬殺判定（例：雙手劍職業被動）
        if (mHp > 0 && pStats.executeChance > 0 && pStats.executeThresholdPct > 0) {
          const thresholdHp = Math.max(1, Math.floor(mHpInit * (pStats.executeThresholdPct / 100)));
          if (mHp <= thresholdHp && Math.random() * 100 < pStats.executeChance) {
            const executeDamage = mHp;
            mHp = 0;
            totalDamage += executeDamage;
            log.push(`🗡️ **斬殺觸發**！${mName} 生命低於 ${pStats.executeThresholdPct}% ，${rand(EXECUTE_PHRASES)}！`);
          }
        }

        if (mHp <= 0) { outcome = "win"; break; }

        // ── 繫・初鳴之晶：共鳴殘影追擊（獨立於連擊、不佔連擊段數；chance% 造成該次傷害的 echoPct%）──
        if (mHp > 0 && playerEchoChance > 0 && Math.random() * 100 < playerEchoChance) {
          const echoDmg = Math.max(1, Math.round(dmg * (playerEchoPct / 100)));
          mHp -= echoDmg;
          totalDamage += echoDmg;
          log.push(`✨ **未登錄的殘影**與你共鳴，追擊一閃！再造成 **${echoDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 連擊（AGI驅動）── 第 1 次吃完整連擊率，之後每次機率為前一次的 1/2，單回合最多 7 連擊；
        // 且每一段都要重新判定命中：被迴避/未命中即中斷連段；被格檔則該段傷害壓到 1（不中斷連段）。
        let comboChance = pStats.combo * (1 + roundPartyAgiBoostPct / 100) + roundPartyComboBoostPct;
        // 連擊率上限：非盜賊封頂 100%；盜賊徽章可突破 100%（上限 300% 防呆，>100 代表首段必中、後續段仍高）
        const _comboRateCap = pStats.hasRogueBadge ? 300 : 100;
        comboChance = Math.min(_comboRateCap, Math.max(0, comboChance));

        const MAX_COMBO_PER_ROUND = 7;
        // 影舞者固定連擊（殘影亂舞 5 段）：只作用在本回合第一次攻擊（雙持副手不重複吃）
        // 連環之計（兵聖）：這回合固定 N 連擊，與影舞者殘影亂舞走同一條保證連擊通道
        const _sageForcedHits = (sageCfg && _sageChainRound === round) ? (Number(sageCfg.chain?.hits) || 3) : 0;
        const _roundGuaranteed = (a === 0 && (_shadowForcedHits > 0 || _sageForcedHits > 0))
          ? Math.max(playerGuaranteedCombo, _shadowForcedHits, _sageForcedHits)
          : playerGuaranteedCombo;
        let comboHitsThisAttack = 0;
        let comboKilled = false;
        let _comboLifestealDmg = 0; // 連擊累計傷害 → 連段結束一起吸血（玩家回報「連擊不吸血」）
        // 戰報重整批次二：連擊各段緩衝、連段結束合併一行「N 連擊：433＋🛡️1＋433 ＝ 867」
        // （rand 敘事照抽保留亂數流；戰意/斬殺等大事件仍獨立成行）
        const _comboSegs = [];
        let _comboPhrase = null;
        const _flushCombo = () => {
          if (!_comboSegs.length) return;
          const _cSum = _comboSegs.reduce((s, x) => s + x.dmg, 0);
          const _cParts = _comboSegs.map((x) => (x.blocked ? "🛡️1" : String(x.dmg))).join("＋");
          const _cLabel = _comboSegs.length >= 2 ? `${_comboSegs.length} 連擊` : "連擊";
          log.push(`⚡ **${_comboPhrase || "連擊"}** ${_cLabel}：${_cParts} ＝ **${_cSum}**（怪物剩 ${Math.max(0, mHp)} HP）`);
          _comboSegs.length = 0;
        };
        // 嵐暴（元素師）：連擊系統整個不生效（固定 3 段法術取代；含保證連擊）
        while (!stormVolleyCfg && comboHitsThisAttack < MAX_COMBO_PER_ROUND && (comboHitsThisAttack < _roundGuaranteed || Math.random() * 100 < comboChance)) {
          // 連擊逐段命中判定：被迴避/未命中 → 立即中斷連段（怪被暈時無法閃避、必中；不吃主擊的大成功/完美必中）
          const comboConnects = comboHitsThisAttack < _roundGuaranteed || monsterIsStunned || Math.random() * 100 < hitChance;
          if (!comboConnects) {
            _flushCombo(); // 先把已成立的連段印出來，中斷行才不會排在合併行前面
            log.push(`💨 ${mName} ${rand(jobFlavor.dodge)}，連擊被閃開，連段中斷！`);
            break;
          }
          comboHitsThisAttack += 1;
          combatStats.comboCount += 1;
          // 龍王戰意：連擊傷害吃「目前已疊加、超出主攻擊基準」的攻擊層數（含主攻擊命中那一層），連擊愈多愈痛
          const comboStackEscalationPct = Math.max(0, stackOnHitStacks - attackStackPctBase);
          // 連擊:用「未含追加值」的傷害乘連擊倍率 ×龍王戰意疊加成長,再額外加一次武器主屬性追加(固定,不被倍率縮放)
          // ⚠️ 這裡的加減必須用「與 dmg 同一個縮放狀態」的追加值。
          //    dmg 是 applyBossVuln 之後的值，且其中含的是 weaponMainBonusRound（見主擊 finalDamage += ...）。
          //    舊版減去/加回未縮放的 weaponMainBonus → 減出負數被 max(1,..) 托住、再把未縮減的固定值加回，
          //    導致連擊傷害幾乎等於該固定值、完全不受終傷倍率影響（龜王詠唱 1% 減傷從這條路整個漏光，
          //    2026-08-12 線上回報）。
          const _mainBonusScaled = applyBossVuln(weaponMainBonusRound);
          let cdmg = Math.max(1, Math.round(Math.max(1, dmg - _mainBonusScaled) * (pStats.comboDamageMultiplier || 1) * (1 + comboStackEscalationPct / 100)) + _mainBonusScaled);
          // 連擊逐段格檔判定：被格檔不中斷連段，只把該段傷害壓到 1（連擊為非爆擊，不走爆擊破格）
          let comboBlockNote = "";
          if (adjustedMCalc.blockChance > 0 && Math.random() * 100 < adjustedMCalc.blockChance) {
            cdmg = 1;
            comboBlockNote = `，但 ${mName} ${rand(BLOCK_PHRASES)}，傷害降至 **1**`;
          }
          // 每擊傷害上限（同主攻擊）：連擊段也夾住上限
          if (adjustedMCalc.incomingDamageCap > 0 && cdmg > adjustedMCalc.incomingDamageCap) cdmg = adjustedMCalc.incomingDamageCap;
          cdmg = applyMonsterIncomingGuards(cdmg, {
            damageReduction: false,
            damageTaken: false,
            bossVulnerability: false,
          });
          if (_noPlayerAtk) cdmg = 0; // 沒苦硬吃：連擊也不造成傷害
          mHp -= cdmg;
          totalDamage += cdmg;
          _comboLifestealDmg += cdmg;
          {
            const _cPhrase = rand(jobFlavor.combo); // rand 照抽保留亂數流
            if (!_comboPhrase) _comboPhrase = _cPhrase;
            _comboSegs.push({ dmg: cdmg, blocked: comboBlockNote !== "" });
          }

          // 這一段連擊也算一次出手 → 往上疊加攻擊層數，讓下一段連擊更痛（上限同 stackOnHitCap）
          if (stackOnHitValue > 0 && stackOnHitStacks < stackOnHitCap) {
            stackOnHitStacks = Math.min(stackOnHitCap, stackOnHitStacks + stackOnHitValue);
            log.push(`🐉 **龍王戰意**：連擊疊加！攻擊 **+${stackOnHitStacks}%**（最高 +${stackOnHitCap}%）`);
          }

          if (mHp > 0 && pStats.executeChance > 0 && pStats.executeThresholdPct > 0) {
            const thresholdHp = Math.max(1, Math.floor(mHpInit * (pStats.executeThresholdPct / 100)));
            if (mHp <= thresholdHp && Math.random() * 100 < pStats.executeChance) {
              const executeDamage = mHp;
              mHp = 0;
              totalDamage += executeDamage;
              log.push(`🗡️ **斬殺觸發**！${mName} 生命低於 ${pStats.executeThresholdPct}% ，${rand(EXECUTE_PHRASES)}！`);
            }
          }

          if (mHp <= 0) { comboKilled = true; break; }
          // 下一次連擊機率遞減為前一次的 1/2（例：30% → 15% → 7.5% → 3.75%…）
          comboChance = comboChance / 2;
        }

        _flushCombo(); // 連段自然結束（含斬殺/擊殺提前跳出）→ 合併行在此落地
        _applyLifesteal(_comboLifestealDmg);
        // ── 連擊氣條累氣：本回合有出現連擊 → +1 格，每回合最多 1 格
        //    （2026-07-22 使用者定案，與劍鬼氣力同節奏）；殘影亂舞的回合不累 ──
        if (shadowCfg && _shadowChargeThisRound && comboHitsThisAttack >= 1 && _shadowChargeRoundMark !== round) {
          _shadowChargeRoundMark = round;
          _shadowGrids = Math.min(shadowCfg.GAUGE_MAX, _shadowGrids + 1);
          if (_shadowGrids >= shadowCfg.GAUGE_MAX) {
            _shadowBurstNext = true;
            _shadowGrids = 0; // 五格全滿 → 全部消耗
            log.push(`🌀 連擊氣條全滿（5/5）——下回合**殘影亂舞**！`);
          } else {
            // 每次累氣都要有戰報行：前端氣條靠這行逐回合亮格（格式勿改）
            log.push(`⚡ 連擊氣 +1（${_shadowGrids}/${shadowCfg.GAUGE_MAX}）`);
          }
        }
        if (comboKilled) { outcome = "win"; break; }
      } else {
        // 斧命中低（V0.5 武器身分）：揮空時點名巨斧，玩家才學得會「這是斧的代價、可以用 DEX/命中裝繞過」
        const _missAxe = String(options.equipped?.weapon?.weaponType || "").startsWith("axe");
        const _missPhrase = rand(jobFlavor.dodge);
        log.push(_missAxe
          ? `💨 巨斧沉重、收勢不及——${mName} ${_missPhrase}，你的攻擊落空了！`
          : `💨 ${mName} ${_missPhrase}，你的攻擊落空了！`);
      }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 氣力格累積（劍鬼）：本回合有攻擊到對手 → +1 格（每回合最多 1 格）──
    if (oniCfg && outcome === null && _attackRoundMark === round) {
      _oniGrids = Math.min(oniCfg.ONI_GAUGE_MAX, _oniGrids + 1);
      if (_oniGrids >= oniCfg.ONI_GAUGE_MAX) {
        _oniGrids = 0;
        _oniBurstNext = true;
        log.push(`⚔️ 氣力全滿（3/3）——下回合**斬**！`);
      } else {
        // 每次累氣都要有戰報行：前端氣力格靠這行逐回合亮格（格式勿改）
        log.push(`⚡ 氣力 +1（${_oniGrids}/${oniCfg.ONI_GAUGE_MAX}）`);
      }
    }

    // ── 追加打擊（神射手箭矢／兵聖計策共用）：等值於「一次真實攻擊 ×pct%」──
    //    以最近一次主擊的未爆擊基底為準（含武器/徽章/最終傷害等整條倍率鏈；與三元/嵐暴補打同法），
    //    各發獨立擲爆擊（×2×爆傷倍率）＋武器主屬性追加，再吃部位/屬性倍率。
    const _sniperArrow = (pct, tag, icon = "🏹") => {
      if (outcome !== null || mHp <= 0) return;
      const _p = (Number(pct) || 100) / 100;
      let _aDmg;
      if (_lastMainBase > 0) {
        _aDmg = Math.max(1, Math.round(_lastMainBase * _p * (equipZoneFinalDmgMult * roundScaleMult(round))));
      } else {
        _aDmg = rollDmg(applyDefense(Math.max(1, Math.round((pStats.atk || 1) * _p)), adjustedMCalc.flatDef || 0, Math.max(0, Math.min(95, adjustedMCalc.def || 0)), pStats.atk));
        _aDmg = Math.max(1, Math.round(_aDmg * playerAttackLevelMult));
      }
      const _aCrit = Math.random() * 100 < (pStats.crit || 0);
      if (_aCrit) _aDmg = Math.max(1, Math.round(_aDmg * 2 * playerCritDamageMultiplier));
      if (weaponMainBonus > 0) _aDmg += weaponMainBonus;
      if (_noPlayerAtk) _aDmg = 0;
      _aDmg = applyMonsterIncomingGuards(_aDmg);
      if (_aDmg <= 0) return;
      mHp -= _aDmg;
      totalDamage += _aDmg;
      log.push(`${icon} ${_aCrit ? "✨**會心**！" : ""}**${tag}**！對 ${mName} 追加 **${_aDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
      if (mHp <= 0) outcome = "win";
    };

    // ── 震盪值累積（神射手）：本回合有攻擊到 → +1 格；滿 4 → 立刻震盪射擊＋推遠 ──
    if (sniperCfg && outcome === null && _attackRoundMark === round) {
      _sniperGrids = Math.min(4, _sniperGrids + 1);
      if (_sniperGrids >= 4) {
        _sniperGrids = 0;
        log.push(`🌀 震盪值全滿（4/4）——**震盪射擊**！`);
        _sniperArrow(sniperCfg.shockShotPct || 100, "震盪射擊");
        if (outcome === "win") { roundLogs.push(log.join("\n")); break; }
        _monsterKnockbackRound = round + 1; // 下回合對手構不到你
        log.push(`🌪️ ${mName} 被震得踉蹌後退——下回合構不到你！`);
      } else {
        // 每次累積都要有戰報行：前端震盪格靠這行逐回合亮格（格式勿改）
        log.push(`⚡ 震盪值 +1（${_sniperGrids}/4）`);
      }
    }

    // ── 完美和弦（吟遊詩人）：上一場完美演奏 → 本場開場追擊 ──
    if (!_noPlayerAtk && Number(options.bardChordPct) > 0 && round === 1 && outcome === null && mHp > 0) {
      log.push(`🎼 **完美和弦**餘音未散——音波化作利刃！`);
      _sniperArrow(Number(options.bardChordPct), "完美和弦", "🎼");
      if (outcome === "win") { roundLogs.push(log.join("\n")); break; }
    }

    // ── 計謀值累積（兵聖）：每回合 +1 格（**不論命中**——綁命中回合會在短戰/高閃怪面前
    //    整套計謀開不出來，實測施計 0.1 次/場＝機制形同不存在，與凍霜同型教訓）；滿 3 → 隨機施展一計 ──
    if (!_noPlayerAtk && sageCfg && outcome === null) {
      _sageGrids = Math.min(3, _sageGrids + 1);
      if (_sageGrids >= 3) {
        _sageGrids = 0;
        const _plans = ["fire", "rock", "mist", "chain", "allin"];
        const _plan = _plans[Math.floor(Math.random() * _plans.length)];
        if (_plan === "fire") {
          log.push(`📜 **兵聖施計——【火攻之計】**！放火燒山！`);
          _sniperArrow(Number(sageCfg.fire?.hitPct) || 150, "火攻之計", "🔥");
          if (outcome === "win") { roundLogs.push(log.join("\n")); break; }
          monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
            key: "burn",
            params: { value: Number(sageCfg.fire?.burnPct) || 30, mode: "caster_atk_pct", casterAtk: Math.round(pStats.atk || 1), duration: { mode: "turns", value: Number(sageCfg.fire?.burnTurns) || 3 } },
            appliedAt: round, sourceType: "job_proc", sourceId: "sage:fire",
          });
          log.push(`🔥 山火蔓延——${mName} 陷入灼燒（${Number(sageCfg.fire?.burnTurns) || 3} 回合）！`);
        } else if (_plan === "rock") {
          log.push(`📜 **兵聖施計——【落石之計】**！滾石落下！`);
          _sniperArrow(Number(sageCfg.rock?.hitPct) || 120, "落石之計", "🪨");
          if (outcome === "win") { roundLogs.push(log.join("\n")); break; }
          if (applyMonsterStun(1, round)) {
            log.push(`😵 ${mName} 被巨石砸得眼冒金星——暈眩 1 回合！`);
          } else if (monsterIsBossUnit) {
            log.push(`🛡️ ${mName} 的巨軀擋下落石的衝擊，未被擊暈。`);
          }
        } else if (_plan === "mist") {
          _sageMistRound = round + 1;
          log.push(`📜 **兵聖施計——【瞞天過海】**！虛實難辨——下回合 ${mName} 必定打空、你的攻擊必中！`);
        } else if (_plan === "chain") {
          _sageChainRound = round + 1;
          log.push(`📜 **兵聖施計——【連環之計】**！環環相扣——下回合固定 ${Number(sageCfg.chain?.hits) || 3} 連擊！`);
        } else {
          _sageAllInFrom = round + 1;
          _sageAllInUntil = round + (Number(sageCfg.allin?.rounds) || 2);
          log.push(`📜 **兵聖施計——【破釜沉舟】**！置之死地而後生——接下來 ${Number(sageCfg.allin?.rounds) || 2} 回合傷害 **×${Number(sageCfg.allin?.mult) || 3}**，但無法迴避格擋、受傷 +50%！`);
        }
      } else {
        // 每次累積都要有戰報行：前端計謀格靠這行逐回合亮格（格式勿改）
        log.push(`⚡ 計謀值 +1（${_sageGrids}/3）`);
      }
    }

    // ── 日之精靈協攻（聖靈師）：每回合一擊，ATK＝主人×ratio%、日屬性；單發不爆擊不連擊 ──
    if (sunSpiritCfg && _spiritHp > 0 && outcome === null && mHp > 0) {
      const _spBase = Math.max(1, Math.round((pStats.atk || 1) * (Number(sunSpiritCfg.atkRatio) || 33) / 100));
      let _spDmg = rollDmg(applyDefense(_spBase, adjustedMCalc.flatDef || 0, Math.max(0, Math.min(95, adjustedMCalc.def || 0)), pStats.atk));
      _spDmg = Math.max(1, Math.round(_spDmg * playerAttackLevelMult));
      const _spElMult = getElementMultiplier(
        sunSpiritCfg.element || "sun",
        monsterElement,
        sunSpiritCfg.elementLevel || 3,
        monsterElementLevel
      );
      if (_spElMult !== 1) _spDmg = Math.max(1, Math.round(_spDmg * _spElMult));
      if (_noPlayerAtk) _spDmg = 0;
      _spDmg = applyMonsterIncomingGuards(_spDmg);
      if (_spDmg > 0) {
        mHp -= _spDmg;
        totalDamage += _spDmg;
        log.push(`☀️ **日之精靈**揮灑聖光，對 ${mName} 造成 **${_spDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
        if (mHp <= 0) { outcome = "win"; roundLogs.push(log.join("\n")); break; }
      }
    }

    // ── 大治療術（聖靈師）：每 N 個有出手的回合施放；精靈在場先回精靈、否則回自己 ──
    if (sunSpiritCfg && outcome === null && _attackRoundMark === round
        && combatStats.attackRounds > 0 && combatStats.attackRounds % Math.max(1, Number(sunSpiritCfg.healEveryRounds) || 5) === 0) {
      // 大治療術是「攢好幾回合放一次」→ INT 斜率按間隔回合數等比給，與逐回合治療的總量一致
      const _bigHealInterval = Math.max(1, Number(sunSpiritCfg.healEveryRounds) || 5);
      const _bigHeal = Math.max(1,
        Math.round((pStats.maxHp || 1) * (Number(sunSpiritCfg.healPct) || 30) / 100)
        + intHealBonus(pStats) * _bigHealInterval);
      // 聖人錨點封鎖所有自身治療：大治療術也不可繞去補召喚物，整筆依錨點規則轉為傷害。
      if (_healToDamage > 0) {
        _healLogged(_bigHeal, () => "", { conversionLabel: "大治療術" });
      } else if (_spiritHp > 0) {
        const beforeHeal = _spiritHp;
        _spiritHp = Math.min(_spiritMaxHp, _spiritHp + _bigHeal);
        log.push(`💚 **大治療術**！聖光注入日之精靈，回復 **${Math.max(0, _spiritHp - beforeHeal)}** HP！（精靈剩 ${_spiritHp} / ${_spiritMaxHp}）`);
      } else if (pHp > 0 && pHp < (pStats.maxHp || 1)) {
        const _before = pHp;
        pHp = _healPlayer(_bigHeal);
        log.push(`💚 **大治療術**！回復 **${Math.max(0, pHp - _before)}** HP！（你剩 ${Math.max(0, pHp)} HP）`);
      }
    }

    // ── 怪物攻擊 ──
    // （戰報重整：怪物回合分隔線移除）
    // AGI 優勢判定：第1回合先手，或偶數回合才反擊
    let monsterAttackCount = 0;
    let monsterDmgThisRound = 0; // 怪物本回合總傷害（甲蟹反擊用）
    let skipMonsterAttackReason = null;
    let _g6Segs = 1; // G6 拆段數（>1 時每段傷害 ÷ 段數）

    if (options.skipMonsterAttack === true) {
      skipMonsterAttackReason = "external_turn";
    } else if (stunRoundsLeft > 0) {
      stunRoundsLeft--;
      skipMonsterAttackReason = "stun";
    } else if (monsterFrozenThisRound) {
      skipMonsterAttackReason = "freeze";
    } else if (_monsterKnockbackRound === round) {
      // 震盪射擊（神射手）：上回合被推遠，這回合構不到你
      skipMonsterAttackReason = "knockback";
    } else if (sageCfg && _sageMistRound === round) {
      // 瞞天過海（兵聖）：這回合怪物必定打空
      skipMonsterAttackReason = "mist";
    } else if (hasAgiFirstStrike && round === 1) {
      skipMonsterAttackReason = "agi_first_strike";
    } else if (hasAgiSlowedMonster && round % 2 !== 0) {
      // 如果 AGI 差 > 5，奇數回合怪物不攻擊
      skipMonsterAttackReason = "agi_slowed";
    } else {
      monsterAttackCount = pStats.monsterAttackCount || 1;
      // 🐺 連牙亂舞：保底 2 段 + 機率追加(第3段55%→第4段30%→第5段12%，依序遇失敗停)，最多 5 段
      if (_hellfangCombo) {
        let hits = 2;
        if (Math.random() < 0.55) { hits++; if (Math.random() < 0.30) { hits++; if (Math.random() < 0.12) hits++; } }
        monsterAttackCount = hits;
      } else if (monsterIsBossUnit) {
        // G6（V0.5 生存地基）：BOSS 普攻名目單發（含終傷倍率與等級壓制）超過 25% 標準血池
        // 就拆成 2~3 段，沿用既有 ma 迴圈 → 各段天然獨立擲攻擊階級/命中/格擋/防禦階級/爆擊。
        // 連牙亂舞本來就是多段小刀，不重複拆。
        const _g6Nominal = (adjustedMCalc.atk || 1) * (adjustedMCalc.finalDamageMultiplier || 1) * monsterAttackLevelMult;
        if (_g6Nominal > G6_SEG_REF) {
          _g6Segs = Math.min(G6_MAX_SEGS, Math.ceil(_g6Nominal / G6_SEG_REF));
          monsterAttackCount *= _g6Segs;
          // （戰報重整：拆段預告行移除——段數直接顯示在合併後的攻擊行上）
        }
      }
    }

    if (skipMonsterAttackReason === "stun") {
      if (_teamStunRounds > 0) _kdaStunSkippedRounds++; // KDA：團隊暈眩擋下的敵方回合數（歸戶由呼叫端做給敲滿條的人）
      // 團隊暈眩（巨神震擊）用專屬敘述，讓玩家知道這場的免傷是誰換來的
      log.push(_teamStunRounds > 0
        ? (String(options.teamStunStyle || "") === "freeze"
          ? `🧊 **區域冰封**——${mName} 被凍成冰雕，無法動彈！`
          : `⛰️ **巨神震擊**餘威未散——${mName} 癱倒在地，動彈不得！`)
        : `😵 ${mName} 仍處於擊暈狀態，無法攻擊！`);
    } else if (skipMonsterAttackReason === "freeze") {
      log.push(`🧊 ${mName} 被冰凍住，此回合無法攻擊！`);
    } else if (skipMonsterAttackReason === "knockback") {
      log.push(`🌪️ ${mName} 被**震盪射擊**推遠，構不到你！`);
    } else if (skipMonsterAttackReason === "mist") {
      log.push(`🌫️ **瞞天過海**奏效——${mName} 的攻擊撲了個空！`);
    } else if (skipMonsterAttackReason === "agi_first_strike") {
      log.push(`⚡ ${mName} ${rand(agiFirstStrikePhrases)}，無法反擊！`);
    } else if (skipMonsterAttackReason === "agi_slowed") {
      log.push(`⚡ ${mName} ${rand(agiSlowedAttackPhrases)}，無法即時反擊！`);
    }

    let blockedThisRound = false;
    let lastMonsterDmg = 0;  // 給連擊用
    // 戰報重整：G6 拆段的各段結果緩衝，迴圈後合併成一行「N 段連襲共 T（132＋🛡️41＋閃避）」。
    // ⚠️ 各段的 rand() 全數照抽（敘事語庫照樣消耗亂數）→ 亂數流位元不變，黃金快照可直接驗證數值零改動。
    const _g6Buf = [];
    let _g6Phrase = null, _g6AnyCrit = false, _g6AnyGreat = false, _g6SpiritSeen = false;
    const _g6FlushLine = () => {
      if (_g6Segs <= 1 || _g6Buf.length === 0) return;
      const total = _g6Buf.reduce((s, x) => s + (x.dmg || 0), 0);
      const parts = _g6Buf.map((x) =>
        x.kind === "block" ? `🛡️${x.dmg}` :
        x.kind === "spirit" ? `☀️${x.dmg}` :
        x.kind === "dodge" ? "閃避" :
        x.kind === "fail" ? "揮空" :
        (x.shield > 0 ? `${x.dmg}(盾${x.shield})` : String(x.dmg)));
      const note = `${_g6AnyGreat ? "⚡" : ""}${_g6AnyCrit ? "✨**會心**！" : ""}`;
      const tail = _g6SpiritSeen ? `｜精靈剩 ${Math.max(0, _spiritHp)}` : `｜你剩 ${Math.max(0, pHp)} HP`;
      log.push(`💥 ${note}${mName} ${_g6Phrase || "連番攻勢襲來"}——${_g6Buf.length} 段連襲共 **${total}**（${parts.join("＋")}${tail}）`);
      _g6Buf.length = 0;
    };
    for (let ma = 0; ma < monsterAttackCount && outcome === null; ma++) {
      // 精靈是純血量召喚物：在場時不借用主人的任何防禦判定，怪物只要自身沒有失敗就會命中。
      const spiritTargeted = Boolean(sunSpiritCfg) && _spiritHp > 0;
      const monsterHitChance = spiritTargeted
        ? 100
        : playerIsStunned
        ? 100
        : calcHitChance({
            hit: adjustedMCalc.hit,
            dodge: pStats.dodge * (1 + roundPartyAgiBoostPct / 100) + playerDodgeBonus,
            min: 20,
          });

      // ── 怪物擲攻擊階級 ──
      const mAtkTierProbs = calcAttackTierProbs(adjustedMCalc.dex || 0, adjustedMCalc.luk || 0);
      const mAtkTier = forceMonsterCritFail ? 'critFail' : rollAttackTier(mAtkTierProbs);

      // 🐺 狼王・連牙亂舞：前 2 段必定命中且必連(無視玩家迴避與怪物自身失誤)；第 3 段起「任何未命中」(玩家迴避 or 怪物自己揮空/大失敗)都打斷剩餘連段
      const hellfangGuaranteedSeg = _hellfangCombo && ma < 2;

      // 大失敗：怪自殘 30%，跳過本次怪攻(狼王保底段不會失誤)
      if (mAtkTier === 'critFail' && !hellfangGuaranteedSeg) {
        const mSelfBase = Math.max(1, Math.round((adjustedMCalc.atk || 1) * monsterAttackLevelMult / _g6Segs));
        // 自殘雖然是怪物自己造成的，但「承傷降為 N%」是掛在怪物身上的護盾，護盾要擋下所有來源，
        // 否則龜王詠唱期間會從自殘這條路漏血（2026-08-12 線上回報）。
        const mSelfDmg = applyMonsterIncomingGuards(Math.max(1, Math.round(mSelfBase * 0.3 * (0.7 + Math.random() * 0.3))));
        mHp -= mSelfDmg;
        totalDamage += mSelfDmg;
        log.push(`💥 **${mName} 大失敗**！自亂招式砸到自己，受到 **${mSelfDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
        if (mHp <= 0) { outcome = "win"; break; }
        if (_hellfangCombo) break; // 🐺 第3段起自己大失敗也打斷連段
        continue;
      }
      // 失敗：強制 miss(狼王保底段不會失誤)
      if (mAtkTier === 'fail' && !hellfangGuaranteedSeg) {
        if (_g6Segs > 1) _g6Buf.push({ kind: "fail" });
        else log.push(`❌ **${mName} 失敗**！揮空了！`);
        if (_hellfangCombo) break; // 🐺 第3段起自己揮空也打斷連段
        continue;
      }
      // G3（V0.5 生存地基）：大成功/完美**不再無視玩家迴避**（原本 31% 的攻擊必中＝閃避原型死刑）。
      // 階級只保證怪自己不失誤（critFail/fail 已在上面擋掉），命中與否交還給命中/迴避判定。
      const mForceHit = false;

      if ((!spiritTargeted && (playerIsStunned || _sageAllInNow)) || mForceHit || hellfangGuaranteedSeg || Math.random() * 100 < monsterHitChance) {
        // 盾格擋判定（含主動技能臨時格擋加成，例如劍士「舉步若堅」+25%，上限 95% 與被動一致）
        // 姿態有指定格擋率時以姿態為準（技能/裝備的臨時加成仍疊上去）
        const _stanceBlock = Number(battleStance?.blockChance);
        // 破釜沉舟：無法格擋（沒有退路）
        const _blockPct = spiritTargeted ? 0 : _sageAllInNow ? 0 : (Number.isFinite(_stanceBlock)
          ? Math.min(95, _stanceBlock + playerBlockBonus)
          : Math.min(95, (pStats.blockChance || 0) + playerBlockBonus));
        if (Math.random() * 100 < _blockPct) {
          blockedThisRound = true;
          combatStats.blockCount += 1;
          if (monsterIsBossUnit) {
            // BOSS 攻勢沉重：格擋不再降至 1，改為卸去 70% 傷害（用未爆擊的基礎傷害計算）
            const bMonsterDefIgnorePct = Math.min(100, Math.max(0, Number(adjustedMCalc.defIgnorePct || 0)));
            const bEffectivePlayerDef = Math.min(95, Math.max(0, ((pStats.def * (1 + playerDefBonusPct / 100) * (1 - playerDefDownPct / 100)) + playerDefFlatBonus) * (1 - bMonsterDefIgnorePct / 100)));
            const bMonsterBaseAtk = Math.max(1, Math.round(adjustedMCalc.atk * (adjustedMCalc.finalDamageMultiplier || 1) * monsterAttackLevelMult / _g6Segs));
            const bBaseDmg = playerInvincible ? 0 : rollMDmg(applyDefense(bMonsterBaseAtk, pStats.flatDef || 0, bEffectivePlayerDef, adjustedMCalc.atk));
            const blockedDmg = playerInvincible ? 0 : Math.max(1, Math.round(bBaseDmg * 0.3));
            const _blockPhrase = rand(jobFlavor.block); // rand 照抽保留亂數流
            if (sunSpiritCfg && _spiritHp > 0) {
              _spiritAbsorb(blockedDmg);
              if (_g6Segs > 1) { _g6Buf.push({ kind: "spirit", dmg: blockedDmg }); _g6SpiritSeen = true; }
              else log.push(`🛡️ ${_blockPhrase}！攻勢沉重，☀️ 日之精靈代承 **${blockedDmg}** 點！（精靈剩 ${Math.max(0, _spiritHp)} / ${_spiritMaxHp}）`);
            } else {
              const actualBlockedDmg = _hurt(blockedDmg);
              if (_g6Segs > 1) _g6Buf.push({ kind: "block", dmg: actualBlockedDmg });
              else log.push(playerInvincible
                ? `🛡️ ${_blockPhrase}！${mName} 的攻勢被完全免疫，受到 **0** 點傷害！`
                : `🛡️ ${_blockPhrase}！${mName} 的攻勢沉重，格擋卸去 70% 傷害，仍受到 **${actualBlockedDmg}** 點！`);
            }
          } else {
            if (sunSpiritCfg && _spiritHp > 0) {
              _spiritAbsorb(1);
              log.push(`🛡️ ${rand(jobFlavor.block)}！${mName} 的攻擊被格擋，日之精靈輕鬆接下 **1** 點！`);
            } else {
              const actualBlockedDmg = _hurt(playerInvincible ? 0 : 1);
              log.push(playerInvincible
                ? `🛡️ ${rand(jobFlavor.block)}！${mName} 的攻擊被完全免疫，受到 **0** 點傷害！`
                : `🛡️ ${rand(jobFlavor.block)}！${mName} 的攻擊被格擋，實際受到 **${actualBlockedDmg}** 點！`);
            }
          }
          if (pHp <= 0) { outcome = "lose"; break; }
        } else {
          const monsterDefIgnorePct = Math.min(100, Math.max(0, Number(adjustedMCalc.defIgnorePct || 0)));
          const effectivePlayerDef = spiritTargeted
            ? 0
            : Math.min(95, Math.max(0, ((pStats.def * (1 + playerDefBonusPct / 100) * (1 - playerDefDownPct / 100)) + playerDefFlatBonus) * (1 - monsterDefIgnorePct / 100)));
          const effectivePlayerFlatDef = spiritTargeted ? 0 : (pStats.flatDef || 0);
          // 新公式 B：flatDef 在 ATK 階段壓制（傳 adjustedMCalc.atk 作為 rawAtk）
          const monsterBaseAtk = Math.max(1, Math.round(adjustedMCalc.atk * (adjustedMCalc.finalDamageMultiplier || 1) * monsterAttackLevelMult / _g6Segs));
          let dmg = (!spiritTargeted && playerInvincible)
            ? 0
            : rollMDmg(applyDefense(monsterBaseAtk, effectivePlayerFlatDef, effectivePlayerDef, adjustedMCalc.atk));

          // ── 套怪攻擊階級乘數（成功 ×1.0 / 大成功 ×1.3；完美走爆擊另算）──
          // G3（V0.5）：怪的大成功 ×1.3 → ×1.15（玩家側大成功維持 1.3 不動）
          const mAtkTierMult = mAtkTier === 'great' ? 1.15 : (ATTACK_TIER_MULT[mAtkTier] ?? 1.0);
          if (mAtkTier !== 'perfect' && mAtkTierMult !== 1.0) {
            dmg = Math.max(1, Math.round(dmg * mAtkTierMult));
          }

          // ── 玩家擲防禦階級 ──
          let pDefTier = "normal";
          if (!spiritTargeted) {
            const pDefTierProbs = calcDefenseTierProbs(pStats.dex || 0, pStats.luk || 0);
            pDefTier = rollDefenseTier(pDefTierProbs);
            const pDefTierMult = DEFENSE_TIER_MULT[pDefTier] ?? 1.0;
            if (pDefTierMult !== 1.0) {
              dmg = Math.max(1, Math.round(dmg * pDefTierMult));
            }
          }
          if (!spiritTargeted && !playerInvincible && playerDamageReductionPct > 0) {
            dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, playerDamageReductionPct) / 100)));
          }
          // ── 物理減傷（怪物普攻視為物理）──
          if (!spiritTargeted && !playerInvincible && playerPhysDrPct > 0) {
            dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, playerPhysDrPct) / 100)));
          }
          // ── 狂血右：HP 低時受傷減免 ──
          if (!spiritTargeted && !playerInvincible && playerHpLowReductionPct > 0) {
            const hpPctNow = (pStats.maxHp > 0) ? (pHp / pStats.maxHp) * 100 : 0;
            if (hpPctNow <= playerHpLowReductionThreshold) {
              dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, playerHpLowReductionPct) / 100)));
            }
          }
          // ── 戰意右：受擊累積（依玩家防禦堆疊轉化為減傷）──
          if (!spiritTargeted && stackOnTakenStacks > 0) {
            const defPct = Math.min(95, stackOnTakenStacks);
            dmg = Math.max(1, Math.round(dmg * (1 - defPct / 100)));
          }

          // ── 檢查怪物的爆擊率（完美攻擊階級 = 必爆擊）──
          let hasMonsterCrit = false;
          let monsterCritRate = adjustedMCalc.critRate || 0;
          if (Array.isArray(monsterActiveEffects)) {
            for (const cEff of monsterActiveEffects) {
              if (cEff && cEff.key === 'crit_rate_up') {
                const cParams = cEff.params || {};
                monsterCritRate += Number(cParams.value || 0);
              }
            }
          }
          if (mAtkTier === 'perfect' || (monsterCritRate > 0 && Math.random() * 100 < monsterCritRate)) {
            hasMonsterCrit = true;
            // G2（V0.5 生存地基）：怪物爆擊 ×2 → ×1.5——
            // 舊制爆擊單發 650 > 血池 575＝字面秒殺；玩家爆擊 ×2 不動
            dmg = Math.round(dmg * (1.5 * (adjustedMCalc.critDamageMultiplier || 1)));
            if (!spiritTargeted && !playerInvincible && roundPartyCritDamageReductionPct > 0) {
              const _preCritDr = dmg;
              dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, roundPartyCritDamageReductionPct) / 100)));
              // KDA：爆傷減免光環實際擋下的量歸戶給提供者
              if (_kdaCritDrSourceId) _kdaPreventedBySource.set(_kdaCritDrSourceId, (_kdaPreventedBySource.get(_kdaCritDrSourceId) || 0) + Math.max(0, _preCritDr - dmg));
            }
          }
          if (!spiritTargeted && !playerInvincible && roundPartyDamageReductionPct > 0) {
            const _preDr = dmg;
            dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, roundPartyDamageReductionPct) / 100)));
            // KDA：減傷光環實際擋下的量歸戶給提供者
            if (_kdaDrSourceId) _kdaPreventedBySource.set(_kdaDrSourceId, (_kdaPreventedBySource.get(_kdaDrSourceId) || 0) + Math.max(0, _preDr - dmg));
          }
          // 防具同屬抗性：與其他減傷同層，
          // 且在寫進戰報之前套用 → 戰報數字＝實際扣血。
          if (!spiritTargeted && !playerInvincible) dmg = _applyElementDR(dmg);
          // 破釜沉舟（兵聖）：區間內受到傷害 ×takenMult（寫進戰報前套用＝戰報數字真實）
          if (!spiritTargeted && _sageAllInNow && !playerInvincible && dmg > 0) {
            dmg = Math.max(1, Math.round(dmg * (Number(sageCfg.allin?.takenMult) || 1.5)));
          }

          // 構建傷害敘述
          let mAtkNote = "";
          if (mAtkTier === 'great') mAtkNote += "⚡**怪物大成功**！";
          else if (mAtkTier === 'perfect') mAtkNote += "🌟**怪物完美**！";
          if (hasMonsterCrit) mAtkNote += "✨**會心一擊**！";
          if (pDefTier === 'crushed') mAtkNote += "💢被爆打！";
          else if (pDefTier === 'reduce') mAtkNote += "🛡️減傷！";
          else if (pDefTier === 'graze') mAtkNote += "🌬️擦傷！";

          // ── 日之精靈代承（聖靈師）：精靈在場 → 這一擊整發由精靈吃下 ──
          //    主人的護盾/受傷回血/免死/反傷/反彈皆不觸發（怪物根本沒打到主人）
          const _spiritTook = spiritTargeted && dmg > 0;
          // ── 護盾吸收（shield / barrier）──
          let shieldAbsorbed = 0;
          if (!_spiritTook && !playerInvincible && dmg > 0 && Array.isArray(options.playerActiveEffects)) {
            for (const sEff of options.playerActiveEffects) {
              if (!sEff || (sEff.key !== 'shield' && sEff.key !== 'barrier')) continue;
              if (!effectIsActive(sEff, round)) continue;
              const sp = sEff.params || {};
              const sAmt = Math.max(0, Number(sp.amount ?? sp.value ?? 0));
              if (sAmt <= 0) continue;
              const take = Math.min(sAmt, dmg);
              sp.amount = sAmt - take;
              sp.value = sp.amount;
              sEff.params = sp;
              dmg -= take;
              shieldAbsorbed += take;
              if (dmg <= 0) { dmg = 0; break; }
            }
          }
          // ── 傷害轉治療 / 受傷回血（damage_to_heal）──
          let damageToHealAmount = 0;
          // ── 免死一次（death_prevent_once）──
          if (!_spiritTook && !deathPreventUsed && pHp - dmg <= 0 && Array.isArray(options.playerActiveEffects)
              && options.playerActiveEffects.some(e => e && e.key === 'death_prevent_once' && effectIsActive(e, round))) {
            dmg = Math.max(0, pHp - 1);
            deathPreventUsed = true;
            log.push(`✨ **死亡迴避**！你保留了最後 1 HP！`);
          }
          if (_spiritTook) {
            _spiritAbsorb(dmg);
          } else {
            dmg = _hurt(dmg);
          }
          if (!_spiritTook && !playerInvincible && playerDamageToHealPct > 0 && dmg > 0) {
            damageToHealAmount = Math.max(1, Math.round(dmg * (playerDamageToHealPct / 100)));
          }
          if (damageToHealAmount > 0) {
            const beforeHeal = pHp;
            pHp = _healPlayer(damageToHealAmount);
            log.push(`💗 受傷反饋！回復 **${Math.max(0, pHp - beforeHeal)}** HP！（你剩 ${Math.max(0, pHp)} HP）`);
          }
          // ── 戰意右：每次受擊累積 stack ──
          if (!_spiritTook && stackOnTakenValue > 0 && stackOnTakenStacks < stackOnTakenCap && dmg > 0) {
            stackOnTakenStacks = Math.min(stackOnTakenCap, stackOnTakenStacks + stackOnTakenValue);
            log.push(`🐉 **龍王戰意**：受擊疊加！減傷 **+${Math.min(95, stackOnTakenStacks)}%**（最高 +${Math.min(95, stackOnTakenCap)}%）`);
          }
          monsterDmgThisRound += dmg;
          lastMonsterDmg = dmg;
          const invincibleText = playerInvincible ? "（免疫傷害）" : (shieldAbsorbed > 0 ? `（護盾吸收 ${shieldAbsorbed}）` : "");
          const _hitPhrase = rand(mAtkPhrases); // rand 照抽保留亂數流
          if (_g6Segs > 1) {
            if (!_g6Phrase) _g6Phrase = _hitPhrase;
            if (hasMonsterCrit) _g6AnyCrit = true;
            if (mAtkTier === 'great') _g6AnyGreat = true;
            if (_spiritTook) { _g6Buf.push({ kind: "spirit", dmg }); _g6SpiritSeen = true; }
            else _g6Buf.push({ kind: "hit", dmg, shield: shieldAbsorbed });
            if (_spiritTook && _spiritHp <= 0) log.push(`💫 日之精靈力竭消散——接下來的攻擊將由你承受！`);
          } else if (_spiritTook) {
            log.push(`💥 ${mAtkNote}${mName} ${_hitPhrase}，☀️ **日之精靈**挺身代承 **${dmg}** 點傷害！（精靈剩 ${Math.max(0, _spiritHp)} / ${_spiritMaxHp}）`);
            if (_spiritHp <= 0) log.push(`💫 日之精靈力竭消散——接下來的攻擊將由你承受！`);
          } else {
            log.push(`💥 ${mAtkNote}${mName} ${_hitPhrase}，造成 **${dmg}** 點傷害${invincibleText}！（你剩 ${Math.max(0, pHp)} HP）`);
          }
          // ── 反傷（thorns）──（精靈代承時主人沒被打到 → 不觸發）
          if (!_spiritTook && playerThornsPct > 0 && dmg > 0) {
            // 反傷是玩家輸出 → 與主擊走同一道檢傷（部位弱點／屬性／演奏／龜王詠唱）
            const thornsDmg = applyMonsterIncomingGuards(Math.max(1, Math.round(dmg * (playerThornsPct / 100))));
            mHp -= thornsDmg;
            totalDamage += thornsDmg;
            log.push(`🌵 **反傷**！${mName} 受到 **${thornsDmg}** 點反彈傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
            if (mHp <= 0) { outcome = "win"; }
          }
          // ── 玩家反彈（reflect_damage / 鏡映系戒指 / 龍蜥武士卡）──（精靈代承時不觸發）
          if (!_spiritTook && outcome === null && dmg > 0 && Array.isArray(options.playerActiveEffects)) {
            for (const rEff of options.playerActiveEffects) {
              if (!rEff || rEff.key !== 'reflect_damage') continue;
              const reflectPct = Math.max(0, Number(rEff.params?.value ?? 0));
              if (reflectPct <= 0) continue;
              // 鏡映反彈同樣是玩家輸出 → 一併檢傷
              const reflectDmg = applyMonsterIncomingGuards(Math.max(1, Math.round(dmg * (reflectPct / 100))));
              mHp -= reflectDmg;
              totalDamage += reflectDmg;
              log.push(`🪞 **反彈**！${mName} 受到 **${reflectDmg}** 點鏡映傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              if (mHp <= 0) { outcome = "win"; break; }
            }
          }
          // ── 玩家反擊（counter_attack / 鏡映系戒指）──
          if (!_spiritTook && outcome === null && dmg > 0 && Array.isArray(options.playerActiveEffects)) {
            for (const cEff of options.playerActiveEffects) {
              if (!cEff || cEff.key !== 'counter_attack') continue;
              const counterChance = Math.max(0, Number(cEff.params?.value ?? 0));
              if (Math.random() * 100 >= counterChance) continue;
              const counterDmg = applyMonsterIncomingGuards(Math.max(1, Math.round((pStats.atk || 1) * 0.5)) + weaponMainBonus); // 部位弱點/屬性相剋
              mHp -= counterDmg;
              totalDamage += counterDmg;
              log.push(`⚔️ **反擊**！對 ${mName} 造成 **${counterDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              if (mHp <= 0) { outcome = "win"; break; }
            }
          }

          // ── 檢查怪物吸血效果 ──
          if (Array.isArray(monsterActiveEffects)) {
            for (const lifeEff of monsterActiveEffects) {
              if (lifeEff && lifeEff.key === 'lifesteal') {
                const lifeParams = lifeEff.params || {};
                const lifePercent = Number(lifeParams.value || 0);
                const healAmount = Math.max(1, Math.round(dmg * (lifePercent / 100)));
                const beforeHeal = mHp;
                mHp = Math.min(mHpInit, mHp + reduceMonsterHeal(healAmount));
                log.push(`💚 ${mName} 吸取生命力，恢復 **${Math.max(0, mHp - beforeHeal)}** HP！（${mName} 剩 ${mHp} HP）`);
              }
            }
          }

          if (pHp <= 0) { outcome = "lose"; break; }
        }
      } else {
        combatStats.dodgeCount += 1;
        const _dodgePhrase = rand(jobFlavor.dodge); // rand 照抽保留亂數流
        if (_g6Segs > 1) _g6Buf.push({ kind: "dodge" });
        else log.push(`🛡️ ${mName} 猛撲而來，你${_dodgePhrase}，躲過了攻擊！`);

        // ── 卡片「閃避後觸發」（trigger: on_dodge，如魅影潛襲者【暗影急襲】迴避後爆擊率提升）──
        if (!playerIsSilenced && outcome === null) {
          for (const dSlot of ['special_1', 'special_2', 'special_3']) {
            const dItem = options.equipped?.[dSlot];
            const dSkill = dItem?.monsterCardSkill;
            if (!dSkill || !dSkill.key || dSkill.trigger !== 'on_dodge') continue;
            const dChance = Math.min(100, Math.max(0, Number(dSkill.chance ?? 20)));
            if (Math.random() * 100 >= dChance) continue;
            const dRes = applyCardProcEffects({
              procEffects: Array.isArray(dSkill.procEffects) ? dSkill.procEffects : [],
              // on_dodge 卡沒有「一般效果」的另一條分支，故不強制血量門檻，
              // 否則像 crit_rate_up 這種無條件自我增益會被丟棄＝整張卡失效。
              requireHpGate: false,
              deferOwnerEffects: true,
              ownerHpPct: pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100,
              targetHpPct: mHpInit > 0 ? (mHp / mHpInit) * 100 : 100,
              round, sourceType: 'player_card',
              cardName: dItem.itemName || dItem.name || '卡片',
              skillName: dSkill.name || '', skillDescription: _descOnce(dSkill.name, dSkill.description || ''),
              cooldownBucket: cardCooldowns.player, cooldownKey: dItem.itemId || dItem.id || dSlot,
              cooldownTurns: Number(dSkill.cooldownTurns) || 0,
              ownerActiveEffects: options.playerActiveEffects || [],
              targetActiveEffects: monsterActiveEffects,
              ownerLabel: playerBattleName, sourceAtk: pStats.atk || 1,
              ownerMaxHp: pStats.maxHp || pHp || 1, targetMaxHp: mHpInit || mHp || 1, targetLabel: mName,
              // 同上：閃避後觸發的卡片傷害一樣要走檢傷，並回傳物件讓戰報顯示檢傷後數字
              applyTargetDamage: (raw) => {
                const d = applyMonsterIncomingGuards(raw);
                mHp -= d; totalDamage += Math.max(0, Number(d) || 0);
                return { remainingHp: mHp, actualDamage: d };
              },
              applyOwnerHeal: (h) => {
                const before = pHp;
                pHp = _healPlayer(h);
                return { remainingHp: pHp, actualHeal: Math.max(0, pHp - before) };
              },
              buffKeys: PLAYER_CARD_BUFF_KEYS, debuffKeys: PLAYER_CARD_OFFENSIVE_KEYS,
              sourceId: dItem.uuid || dItem.itemId || dItem.id, log,
            });
            options.playerActiveEffects = dRes.ownerActiveEffects;
            monsterActiveEffects = dRes.targetActiveEffects;
          }
        }

        // ── 弓箭手閃避反擊（counter_on_dodge）──
        const hasCounterOnDodge = jobProfile.activeJobEffects.some(e => e.key === 'counter_on_dodge');
        if (hasCounterOnDodge && outcome === null) {
          const counterHitChance = calcHitChance({
            hit: (pStats.hit + playerHitBonus - playerHitPenalty),
            dodge: adjustedMCalc.dodge,
            min: 20,
          });
          if (monsterIsStunned || Math.random() * 100 < counterHitChance) {
            const effectiveDef = Math.max(0, adjustedMCalc.def * (1 - Math.min(95, roundMonsterDefDownPct) / 100));
            const counterBypassPct = Math.min(100, Math.max(0, (pStats.bypassMonsterDefPct ?? 0) + playerDefIgnorePct + roundPartyDefIgnorePct));
            const finalDef = Math.max(0, effectiveDef * (1 - counterBypassPct / 100));
            const conditionalBonusMultiplier = getRoundTargetDamageMultiplier();
            const counterBase = Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * roundBossDmgMultiplier * roundEliteDmgMultiplier * playerFinalDamageMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier * conditionalBonusMultiplier * playerAttackLevelMult));
            const counterDmg = applyMonsterIncomingGuards(Math.max(1, Math.round(rollDmg(applyDefense(counterBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk)) * (equipZoneFinalDmgMult * roundScaleMult(round)))) + weaponMainBonus); // 部位弱點/屬性相剋
            mHp -= counterDmg;
            totalDamage += counterDmg;
            log.push(`🏹 **閃避反擊**！你趁隙還擊，對 ${mName} 造成 **${counterDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
            if (mHp <= 0) { outcome = "win"; }
          } else {
            log.push(`🏹 閃避後出箭，但 ${mName} ${rand(dodgePhrases)}！`);
          }
        }
        // 🐺 狼王：第 3 段(含)起被玩家迴避 → 打斷剩餘連段(前 2 段必中不受此限)
        if (_hellfangCombo && ma >= 2) break;
      }
    }
    _g6FlushLine(); // 戰報重整：G6 拆段合併行（含中途死亡的殘段）

    // ── 怪物連擊（AGI 驅動）── 簡化：觸發後同一次傷害再扣一次（× 2 效果）
    const monsterComboChance = adjustedMCalc.comboChance || 0;
    // 🐺 狼王：連擊由「連牙亂舞」段數機制負責(含迴避打斷)，關掉這套 AGI 額外連擊避免雙重連擊架空打斷
    if (monsterComboChance > 0 && !skipMonsterAttackReason && outcome === null && lastMonsterDmg > 0 && !_hellfangCombo) {
      if (Math.random() * 100 < monsterComboChance) {
        let comboDmg = lastMonsterDmg;
        if (sunSpiritCfg && _spiritHp > 0) {
          _spiritAbsorb(comboDmg);
          monsterDmgThisRound += comboDmg;
          log.push(`⚡ **${mName} 連擊**！☀️ 日之精靈代承 **${comboDmg}** 點傷害！（精靈剩 ${Math.max(0, _spiritHp)} / ${_spiritMaxHp}）`);
          if (_spiritHp <= 0) log.push(`💫 日之精靈力竭消散——接下來的攻擊將由你承受！`);
        } else {
          comboDmg = _hurt(comboDmg);
          monsterDmgThisRound += comboDmg;
          log.push(`⚡ **${mName} 連擊**！再造成 **${comboDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; }
        }
      }
    }

    if (outcome === "lose") { roundLogs.push(log.join("\n")); break; }

    // ── 甲蟹卡反擊（怪物攻擊後，30% 觸發，傷害為怪物本回合傷害的 20%）──
    if (monsterAttackCount > 0 && outcome === null) {
      const counterEff = (options.playerActiveEffects || []).find(e => e && e.key === 'counter');
      if (counterEff && effectIsActive(counterEff, round)) {
        const cp = counterEff.params || {};
        const triggerChance = Number(cp.value ?? 100);
        if (monsterDmgThisRound > 0 && Math.random() * 100 < triggerChance) {
          const counterDmgPct = Number(cp.counterDamagePct ?? 30);
          const counterDmg = applyMonsterIncomingGuards(Math.max(1, Math.round(monsterDmgThisRound * (counterDmgPct / 100)))); // 部位弱點/屬性相剋
          mHp -= counterDmg;
          totalDamage += counterDmg;
          log.push(`🦀 **反擊**！以受到傷害的 ${counterDmgPct}% 回擊，對 ${mName} 造成 **${counterDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; }
        }
      } else if (!monsterIsStunned) {
        // 也檢查 equipped special 槽位的 procEffects
        const specialSlotKeys = ['special_1', 'special_2', 'special_3'];
        for (const slot of specialSlotKeys) {
          const slotItem = options.equipped?.[slot];
          if (slotItem?.procEffects?.some(e => e.key === 'counter')) {
            const triggerChance = Number(slotItem.procEffects.find(e => e.key === 'counter')?.params?.value ?? 30);
            if (Math.random() * 100 < triggerChance) {
              const counterParams = slotItem.procEffects.find(e => e.key === 'counter')?.params || {};
              const counterDmgPct = Number(counterParams.counterDamagePct ?? 20);
              const counterDmg = applyMonsterIncomingGuards(Math.max(1, Math.round(monsterDmgThisRound * (counterDmgPct / 100)))); // 部位弱點/屬性相剋
              mHp -= counterDmg;
              totalDamage += counterDmg;
              const counterLabel = slotItem.monsterCardSkill?.name || slotItem.itemName || slotItem.name || "反擊";
              log.push(`🦀 **${counterLabel}**！以受到傷害的 ${counterDmgPct}% 反彈，對 ${mName} 造成 **${counterDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              if (mHp <= 0) { outcome = "win"; }
            }
            break;
          }
        }
      }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 神速反擊（神射手）：這回合對手沒打到你 → 多一箭 ──
    //    涵蓋：揮空/被閃/來不及出手（先手・慢半拍）/被暈眩/被冰封/被震退（使用者定案：硬控也算）
    if (sniperCfg && outcome === null && mHp > 0 && monsterDmgThisRound === 0) {
      _sniperArrow(sniperCfg.counterShotPct || 100, "神速反擊");
      if (outcome === "win") { roundLogs.push(log.join("\n")); break; }
    }

    // ── 盾格擋反擊（單手劍+盾，必中）── 走獨立階級擲骰
    // 防禦姿態：格擋成功 → 追加盾擊（ATK 的 shieldBashPct%），與原本的格擋反擊並存
    if (blockedThisRound && Number(battleStance?.shieldBashPct) > 0 && outcome === null) {
      const bashRaw = Math.max(1, Math.round((pStats.atk || 1) * (Number(battleStance.shieldBashPct) / 100) * playerAttackLevelMult));
      const bashDefIgnore = Math.min(100, Math.max(0, (pStats.bypassMonsterDefPct ?? 0) + playerDefIgnorePct + roundPartyDefIgnorePct));
      const bashDef = Math.max(0, adjustedMCalc.def * (1 - Math.min(95, roundMonsterDefDownPct) / 100) * (1 - bashDefIgnore / 100));
      let bashDmg = Math.max(1, Math.round(applyDefense(bashRaw, adjustedMCalc.flatDef || 0, bashDef, pStats.atk)));
      bashDmg = applyMonsterIncomingGuards(bashDmg);
      if (_noPlayerAtk) bashDmg = 0;
      mHp -= bashDmg;
      totalDamage += bashDmg;
      log.push(`🛡️ **盾擊**！以盾緣重擊 ${mName}，造成 **${bashDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
      if (mHp <= 0) { outcome = "win"; }
    }
    if (blockedThisRound && pStats.blockCounter && outcome === null) {
      const counterAtkTier = rollAttackTier(calcAttackTierProbs(pStats.dex || 0, pStats.luk || 0));
      // 大失敗 / 失敗 階級時，反擊也會出包
      if (counterAtkTier === 'critFail') {
        const selfBase = Math.max(1, Math.round((pStats.atk || 1) * playerAttackLevelMult));
        let selfDmg = Math.max(1, Math.round(selfBase * 0.3 * (0.7 + Math.random() * 0.3)));
        selfDmg = _hurt(selfDmg);
        log.push(`💥 **盾反大失敗**！你揮空砸到自己，受到 **${selfDmg}** 點傷害！`);
        if (pHp <= 0) { outcome = "lose"; }
      } else if (counterAtkTier === 'fail') {
        log.push(`❌ **盾反失敗**！你的反擊揮空了！`);
      } else {
        const isBreak = Math.random() * 100 < pStats.armorBreakChance;
        const effectiveDef = isBreak ? 0 : Math.max(0, adjustedMCalc.def * (1 - Math.min(95, roundMonsterDefDownPct) / 100));
        const counterBypassPct = Math.min(100, Math.max(0, (pStats.bypassMonsterDefPct ?? 0) + playerDefIgnorePct + roundPartyDefIgnorePct));
        const finalDef = Math.max(0, effectiveDef * (1 - counterBypassPct / 100));
        const conditionalBonusMultiplier = getRoundTargetDamageMultiplier();
        const counterBase = Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * roundBossDmgMultiplier * roundEliteDmgMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier * conditionalBonusMultiplier * playerAttackLevelMult));
        let dmg = rollDmg(applyDefense(counterBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk));

        // 套攻擊階級乘數
        const tierMult = ATTACK_TIER_MULT[counterAtkTier] ?? 1.0;
        if (counterAtkTier !== 'perfect' && tierMult !== 1.0) {
          dmg = Math.max(1, Math.round(dmg * tierMult));
        }
        // 防禦階級
        const defTier = rollDefenseTier(calcDefenseTierProbs(adjustedMCalc.dex || 0, adjustedMCalc.luk || 0));
        const defMult = DEFENSE_TIER_MULT[defTier] ?? 1.0;
        if (defMult !== 1.0) dmg = Math.max(1, Math.round(dmg * defMult));

        const isCrit = (counterAtkTier === 'perfect') || (Math.random() * 100 < pStats.crit);
        if (isCrit) dmg = Math.round(rollDmg(applyDefense(counterBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk)) * 2 * tierCritDamageMultiplier);
        { const _ezm = equipZoneFinalDmgMult * roundScaleMult(round); if (_ezm !== 1) dmg = Math.max(1, Math.round(dmg * _ezm)); }

        let tierNote = "";
        if (counterAtkTier === 'great') tierNote = "⚡大成功 ";
        else if (counterAtkTier === 'perfect') tierNote = "🌟完美 ";

        dmg = applyMonsterIncomingGuards(dmg); // 部位弱點/屬性相剋（盾反也一致套用）
        mHp -= dmg;
        totalDamage += dmg;
        log.push(`⚔️✨ **${tierNote}盾反**！${rand(jobFlavor.counter)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
        if (mHp <= 0) { outcome = "win"; }
      }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // 副手追擊機制已移除（2026-05-26）

    // ── 玩家 HOT/life_regen 結算（每回合結束）──
    // 滿血時本來就跳過(回不進去、也不用洗「恢復 0 HP」)；但聖人(回血化刃)會把治療轉成傷害，
    // 滿血反而正是要結算的時候——不放行的話滿血聖人等於整組 life_regen/HOT 裝備全廢(玩家實測回報)。
    if (outcome === null && pHp > 0 && (pHp < pStats.maxHp || _healToDamage > 0)) {
      let totalHot = 0;
      if (playerHotPct > 0) totalHot += Math.round(pStats.maxHp * (playerHotPct / 100));
      if (playerHotFlat > 0) totalHot += Math.round(playerHotFlat);
      // INT 斜率（回復型原型的成長曲線）：只有「本來就有治療來源」的 build 才吃得到，
      // 否則等於全職業白送每回合回血，回復型就不再是一種需要投資的選擇。
      if (playerHotPct > 0 || playerHotFlat > 0) totalHot += intHealBonus(pStats);
      // 各來源各自看自己的 interval：黃金幼龍卡只在第 3/6/9… 回合爆發，火髓魔蟲卡每回合都回
      for (const lr of playerLifeRegens) {
        if (round % lr.interval === 0) totalHot += Math.round((pStats.maxHp || 0) * (lr.pct / 100));
      }
      if (totalHot > 0) {
        _healLogged(totalHot, (actual) => `💚 持續回復！回復 **${actual}** HP！（你剩 ${pHp} HP）`);
      }
    }

    // ── 聖域護佑：每回合回血（區域聖域窗口，任何職業都吃）──
    if (_sanctuaryHealPct > 0 && outcome === null && pHp > 0 && pHp < (pStats.maxHp || 1)) {
      const _shHeal = Math.max(1, Math.round((pStats.maxHp || 1) * _sanctuaryHealPct / 100));
      const _shBefore = pHp;
      pHp = _healPlayer(_shHeal);
      if (pHp > _shBefore) log.push(`🏛️ 聖域護佑：回復 **${pHp - _shBefore}** HP！（你剩 ${Math.max(0, pHp)} HP）`);
    }

    // ── 符文結界（聖域師）：回合尾結算——吸收戰報行＋三時機共鳴反爆 ──
    // 反爆＝累積吸收×detonateMult，無視防禦（不擲爆擊＝完全確定，提前引爆才能精準預知）；
    // 走 applyBossVuln（部位/屬性/演奏等終傷層倍率一致吃到）。一場只爆一次，爆後殘餘結界續擋傷但不再引爆。
    if (sanctumCfg && !_sanctumDetonated) {
      if (_sanctumRoundAbsorb > 0) {
        log.push(`🔷 符文結界吸收 ${_sanctumRoundAbsorb}（結界剩 ${Math.max(0, _sanctumBarrier)}/${_sanctumMax}）`);
        _sanctumRoundAbsorb = 0;
      }
      // 倍率隨回合成長：×(滿場倍率 × 引爆回合/全場回合)——撐到最後一回合才吃滿倍率（使用者定案）。
      // 早被打爆＝吸收滿但倍率低；撐好撐滿＝吸收與倍率雙滿 → 「撐盾」永遠是對的
      const _detonateRaw = () => {
        const _timeMult = (Number(sanctumCfg.detonateMult) || 2) * (round / Math.max(1, endRound));
        let d = Math.max(1, Math.round(_sanctumAcc * _timeMult));
        d = applyMonsterIncomingGuards(d);
        if (_noPlayerAtk) d = 0;
        return d;
      };
      const _fire = (label) => {
        const d = _detonateRaw();
        if (_sanctumAcc <= 0 || d <= 0) return;
        _sanctumDetonated = true;
        mHp -= d;
        totalDamage += d;
        const _tm = Math.round((Number(sanctumCfg.detonateMult) || 2) * (round / Math.max(1, endRound)) * 100) / 100;
        log.push(`🔷 **結界過載——共鳴反爆**${label}！吸收 ${_sanctumAcc} ×${_tm.toFixed(2)}（第 ${round} 回合）——無視防禦轟出 **${d}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
        if (mHp <= 0) outcome = "win";
      };
      if (outcome === null && mHp > 0 && _sanctumAcc > 0) {
        if (_sanctumBroke) {
          log.push(`💥 符文結界破碎！`);
          _sanctumBroke = false;
          _fire("（破碎引爆）");
        } else if (_detonateRaw() >= mHp) {
          _fire("（預知引爆）"); // 伺服器整場先算：這一爆剛好收頭 → 提前引爆
        } else if (round >= endRound) {
          _fire("（終幕引爆）"); // 撐滿全場 → 最後一回合滿額爆
        }
      }
    }

    // 龜甲破碎宣告（破殼而出）
    if (_tshellBrokeThisRound) {
      _tshellBrokeThisRound = false;
      log.push(`💥 龜甲碎裂——**破殼而出**！剩餘戰鬥傷害 +${_tshellCfg.breakDmgPct}%！`);
    }

    // 吸血：一回合結算一次（累積本回合各段傷害後統一吸，並吃總量上限）
    // 放在戰報 push 之前 → 吸血訊息屬於本回合；放在勝負判定之前 → 打死怪的那回合也吸得到。
    _settleLifestealForRound();

    roundLogs.push(log.join("\n"));
    if (outcome !== null) break;

    // ── 清理過期的 activeEffects ──
    monsterActiveEffects = cleanExpiredEffects(monsterActiveEffects, round);
    if (options.playerActiveEffects) {
      options.playerActiveEffects = cleanExpiredEffects(options.playerActiveEffects, round);
    }

    monsterDefDownCarry = roundMonsterDefDownPct; // 保留本回合扣防%,供下一回合玩家 DOT 使用
    playerDefIgnoreCarry = (playerDefIgnorePct || 0) + (roundPartyDefIgnorePct || 0); // 保留本回合無視防禦%,供下一回合 DOT 穿防
    round++;
  }

  if (outcome === null) outcome = "timeout";

  // ── 救護右：戰後回血（僅戰勝觸發） ──
  // 從 playerActiveEffects 重算 post_battle_heal（迴圈外能看到的全域版本）
  let finalPostBattleHealPct = 0;
  if (Array.isArray(options.playerActiveEffects)) {
    for (const eff of options.playerActiveEffects) {
      if (eff && eff.key === "post_battle_heal") finalPostBattleHealPct += Math.abs(Number(eff.params?.value ?? 0));
    }
  }
  if (outcome === "win" && finalPostBattleHealPct > 0 && pHp > 0 && pStats.maxHp > 0) {
    const healAmt = Math.max(1, Math.round(pStats.maxHp * (finalPostBattleHealPct / 100)));
    const before = pHp;
    pHp = _healPlayer(healAmt, { postMortem: true });   // 戰鬥已結束：聖人不轉傷害(不灌傷害榜)
    const actual = pHp - before;
    if (actual > 0) roundLogs.push(`💖 **戰後回血**！回復 **${actual}** HP！（你剩 ${pHp} HP）`);
  }

  // ── KDA・A 值歸戶結算（附錄C v3）──────────────────────────────
  const _assistBySource = {};
  const _addA = (id, amt) => {
    const key = String(id || "");
    if (!key || !(amt > 0)) return;
    _assistBySource[key] = (_assistBySource[key] || 0) + Math.round(amt);
  };
  try {
    const _fought = Math.max(1, round - 1);
    // ── B 案（使用者定案 2026-08-07）：玩法維持「同 key 取最高」，但**計分按各提供者數值比例分帳**——
    //    被蓋掉的同系輔助不再拿 0 分。pot＝最高外部光環的實際效果量，依 v 比例分給所有外部提供者。
    const _rawPE = Array.isArray(options.partyEffects) ? options.partyEffects : [];
    const _vOf = (pe) => Math.abs(Number(pe?.params?.value ?? pe?.value ?? 0));
    const _extByKey = new Map(); // key → 外部提供者候選（不可自益）
    for (const pe of _rawPE) {
      if (!pe || pe.isSelfAura !== false || !pe.sourceDiscordId || !(_vOf(pe) > 0)) continue;
      const k = String(pe.key || "");
      if (!_extByKey.has(k)) _extByKey.set(k, []);
      _extByKey.get(k).push(pe);
    }
    const _distribute = (pot, cands, credit = _addA) => {
      const sum = cands.reduce((s, pe) => s + _vOf(pe), 0);
      if (!(pot > 0) || !(sum > 0)) return;
      for (const pe of cands) credit(pe.sourceDiscordId, pot * _vOf(pe) / sum);
    };
    // 增傷類光環
    const _isDmgKey = (k) =>
      k === "party_damage_up" || k === "party_crit_rate_up" || k === "party_agi_up" ||
      k === "party_high_hp_damage_up" || k === "party_stunned_damage_up" ||
      (k === "party_boss_damage_up" && options.monsterIsBoss) ||
      (k === "party_elite_damage_up" && options.monsterIsElite && !options.monsterIsBoss);
    for (const [k, cands] of _extByKey) {
      if (!_isDmgKey(k)) continue;
      const vMax = Math.max(...cands.map(_vOf));
      _distribute((totalDamage || 0) * vMax / (100 + vMax), cands);
    }
    // 治療：實際生效總量（fold 只套用最高者）→ 按治療光環提供者數值分帳；救命加成記給分帳後最大者
    const _healCands = [...(_extByKey.get("party_heal") || []), ...(_extByKey.get("heal_over_time") || [])];
    let _healTotal = 0;
    for (const [, h] of _kdaHealBySource) _healTotal += h;
    const _healShare = new Map();
    const _creditHeal = (id, amt) => { _addA(id, amt); _healShare.set(id, (_healShare.get(id) || 0) + amt); };
    if (_healTotal > 0 && _healCands.length > 0) _distribute(_healTotal, _healCands, _creditHeal);
    else for (const [id, h] of _kdaHealBySource) _creditHeal(id, h);
    if (_shadowDeadRound != null && outcome !== "lose" && _healShare.size > 0) {
      const _extra = Math.max(0, _fought - _shadowDeadRound + 1);
      if (_extra > 0) {
        const _top = [..._healShare.entries()].sort((a, b) => b[1] - a[1])[0][0];
        _addA(_top, _extra * ((totalDamage || 0) / _fought));
      }
    }
    // 減傷/爆傷減免：實際擋下總量 → 按對應 key 提供者分帳
    let _prevTotal = 0;
    for (const [, p] of _kdaPreventedBySource) _prevTotal += p;
    const _drCands = [...(_extByKey.get("party_damage_reduction") || []), ...(_extByKey.get("party_crit_damage_reduction") || [])];
    if (_prevTotal > 0 && _drCands.length > 0) _distribute(_prevTotal, _drCands);
    else for (const [id, p] of _kdaPreventedBySource) _addA(id, p);
  } catch (_) { /* 歸戶失敗不影響戰鬥結果 */ }

  // 🏁 結尾統計列（戰報重整：總輸出/承傷/最痛一擊——與未來 KDA 貢獻榜同款數字，先讓玩家看習慣）
  {
    const _oTxt = outcome === "win" ? "🏆 勝利" : (outcome === "lose" ? "💀 敗北" : `⏱ 撐滿 ${Math.max(1, round - 1)} 回合`);
    roundLogs.push(`🏁 **戰鬥結束**｜${_oTxt}｜總輸出 **${Math.round(totalDamage || 0).toLocaleString()}**｜承傷 **${Math.round(_totalDmgTaken || 0).toLocaleString()}**｜最痛一擊 **${Math.round(_maxHitTaken || 0)}**`);
  }

  return {
    outcome,
    roundLogs,
    totalDamage,
    finalMonsterHp: Math.max(0, mHp),
    finalPlayerHp:  Math.max(0, pHp),
    combatStats,
    monsterActiveEffects,
    stunRoundsLeft,
    cardCooldowns,
    nextRound: round,
    damageTaken: _totalDmgTaken,  // 沒苦硬吃任務指標
    healDone: _totalHealDone, lifestealDone: _totalLifestealDone, // 聖人／鮮血任務指標
    // 連擊氣條（影舞者）：戰後氣量；滿氣觸發了但戰鬥先結束 → 還原成滿格帶去下一場
    shadowGauge: shadowCfg ? (_shadowBurstNext ? shadowCfg.GAUGE_MAX : _shadowGrids) : null,
    // 職業技能成本（cost.type === "combo"）本場總消耗量 → 呼叫端要從 zoneCombo 扣掉並落地
    jobSkillComboSpent: _jobSkillComboSpent,
    maxHitTaken: _maxHitTaken, // 本場最大單發承傷（爆發條件驗收用）
    // KDA・A 值歸戶（附錄C v3）：bySource＝{提供者discordId: 本場傷害當量}；
    // stunPreventedDmg＝團隊暈眩擋下的傷害當量（歸戶對象＝敲滿條的人，呼叫端從 dwarfStunGauge 取）
    assistLedger: {
      bySource: _assistBySource,
      stunSkippedRounds: _kdaStunSkippedRounds,
      stunPreventedDmg: _kdaStunSkippedRounds > 0
        ? Math.round(_kdaStunSkippedRounds * (_totalDmgTaken / Math.max(1, (round - 1) - _kdaStunSkippedRounds)))
        : 0,
    },
    // 氣力格（劍鬼）：同一規則——滿了但還沒斬出去 → 滿格帶去下一場
    oniGauge: oniCfg ? (_oniBurstNext ? oniCfg.ONI_GAUGE_MAX : _oniGrids) : null,
    // 震盪值（神射手）：戰後格數（跨場沿用由呼叫端持久化）
    sniperGauge: sniperCfg ? _sniperGrids : null,
    // 計謀值（兵聖）：戰後格數
    sageGauge: sageCfg ? _sageGrids : null,
    // 命運骰（賭神）：戰後格數＋手氣層數（跨場沿用由呼叫端持久化）
    diceGauge: diceGodCfg ? _diceGrids : null,
    diceLuck: diceGodCfg ? _diceLuck : null,
    // 符文結界（聖域師）：戰後狀態（結界每場重新展開，不跨場；此欄供顯示/驗證）
    sanctum: sanctumCfg ? {
      barrier: Math.max(0, _sanctumBarrier),
      max: _sanctumMax,
      absorbed: _sanctumAcc,
      detonated: _sanctumDetonated,
    } : null,
    // 日之精靈（聖靈師）：戰後血量 %（倒下＝0，下一場由呼叫端依重召規則給 50%）
    sunSpirit: sunSpiritCfg ? {
      hp: Math.max(0, _spiritHp),
      maxHp: _spiritMaxHp,
      hpPct: Math.max(0, Math.round((_spiritHp / Math.max(1, _spiritMaxHp)) * 1000) / 10)
    } : null
  };
}

module.exports = { runCombatLoop };
