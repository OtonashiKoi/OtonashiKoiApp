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
  calcAttackTierProbs,
  calcDefenseTierProbs,
  rollAttackTier,
  rollDefenseTier,
  ATTACK_TIER_MULT,
  DEFENSE_TIER_MULT,
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
  bow: ["拉弓射擊", "瞄準放箭", "急速連射", "精準狙擊", "拉弦破空", "連珠齊射"]
};
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
  const id = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const name = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();

  const has = (needle) => id.includes(needle) || name.includes(needle);
  let archetype = "default";
  if (has("swordsman")) archetype = "swordsman";
  else if (has("warrior") && has("dwarf")) archetype = "dwarf_warrior";
  else if (has("warrior")) archetype = "warrior";
  else if (has("archer")) archetype = "archer";
  else if (has("healer")) archetype = "healer";
  else if (has("mage")) archetype = "mage";
  else if (has("rogue")) archetype = "rogue";
  else {
    const weaponType = equipped?.weapon?.weaponType || "";
    if (weaponType.startsWith("staff")) archetype = activeJobEffects.some((e) => e.target === "party") ? "healer" : "mage";
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
        // 格擋率提升（新屬性，暫不實現）
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
  // 即時技能傷害也走目標防禦減免(由呼叫端提供 mitigate,例如 applyDefense)
  const damage = typeof mitigate === "function" ? Math.max(1, Math.round(mitigate(rawDamage))) : rawDamage;
  applyTargetDamage(damage);
  log.push(`🎴 **${ownerLabel}** 發動【${skillName}】！${skillDescription || ""} 對 **${targetLabel}** 造成 **${damage}** 點${damageLabel}傷害！`);
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
  const remainingHp = applyTargetHeal(heal);
  const remainText = Number.isFinite(Number(remainingHp)) ? `（${targetLabel} 剩 ${Math.max(0, Math.round(Number(remainingHp)))} HP）` : "";
  log.push(`🎴 **${ownerLabel}** 發動【${skillName}】！${skillDescription || ""} 回復 **${heal}** HP！${remainText}`);
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
  log = []
}) {
  let nextOwnerActiveEffects = Array.isArray(ownerActiveEffects) ? ownerActiveEffects : [];
  let nextTargetActiveEffects = Array.isArray(targetActiveEffects) ? targetActiveEffects : [];
  const hpGatedEffects = procEffects.filter(effectHasHpThreshold);
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

  if (Number(cooldownTurns) > 0 && cooldownBucket && cooldownKey != null) {
    cooldownBucket[cooldownKey] = Number(cooldownTurns);
  }

  for (const procEffect of matchedEffects) {
    if (!procEffect || !procEffect.key) continue;

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
      continue;
    }
    if (applyImmediateCardHealEffect({
      procEffect,
      ownerLabel,
      skillName: skillName || cardName,
      skillDescription,
      targetLabel: ownerLabel === "你" ? "你" : "自己",
      sourceAtk,
      targetMaxHp: ownerMaxHp,
      applyTargetHeal: applyOwnerHeal,
      log,
    })) {
      continue;
    }

    if (procEffect.target === 'self' || buffKeys.has(procEffect.key)) {
      nextOwnerActiveEffects = addOrStackCardEffect(nextOwnerActiveEffects, effectEntry);
    } else if (procEffect.target === 'enemy' || debuffKeys.has(procEffect.key)) {
      nextTargetActiveEffects = addOrStackCardEffect(nextTargetActiveEffects, effectEntry);
    }
  }

  if (!matchedEffects.some((effect) => shouldSuppressImmediateLog(effect))) {
    log.push(`🎴 **${ownerLabel}** 發動【${skillName || cardName}】！${skillDescription || ""}`);
  }

  return {
    ownerActiveEffects: nextOwnerActiveEffects,
    targetActiveEffects: nextTargetActiveEffects,
    applied: true,
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
  const LEVEL_DIFF_CAP_DOWN = 50;
  const calcLevelMult = (atkLv, dstLv) => {
    const diff = Math.max(1, atkLv || 1) - Math.max(1, dstLv || 1);
    if (diff >= 0) return 1 + Math.min(LEVEL_DIFF_CAP_UP, diff * LEVEL_DIFF_PCT) / 100;
    return 1 - Math.min(LEVEL_DIFF_CAP_DOWN, -diff * LEVEL_DIFF_PCT) / 100;
  };
  const playerLevel = Math.max(1, Number(options.playerLevel || pStats.level || 1));
  const monsterLevel = Math.max(1, Number(mCalc?.level || options.monsterLevel || 1));
  const playerAttackLevelMult = calcLevelMult(playerLevel, monsterLevel);
  const monsterAttackLevelMult = calcLevelMult(monsterLevel, playerLevel);

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
  const mDmgMin = (typeof mCalc?.dmgMin === 'number')
    ? mCalc.dmgMin
    : Math.min(1.0, 0.7 + Math.max(0, Number(mCalc?.int) || 0) * 0.01);
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
  let _endureBurst = null;  // 沒苦硬吃：{ round, mult }
  let _endureFired = false;
  let _healToDamage = 0;    // 聖人比拳頭：回血→對敵傷害倍率(0=關)
  let _healImmune = false;  // 對鮮血的渴望：無法被治療(自身吸血除外)
  let _extendRounds = 0;    // 時間管理大師：回合上限改為此值(0=不變)
  let _noPlayerAtk = false; // 沒苦硬吃：無法造成一般攻擊傷害(只靠 endure_burst 反彈)
  let _totalHealDone = 0;   // 聖人任務指標 heal_done：實際回血量累計
  const _hurt = (d) => { const x = Math.max(0, Number(d) || 0); pHp = pHp - x; _totalDmgTaken += x; };
  const _healPlayer = (h, opts) => {
    const amt = Math.max(0, Number(h) || 0);
    if (amt <= 0) return pHp;
    if (opts && opts.lifesteal) { _totalHealDone += amt; pHp = Math.min(pStats.maxHp, pHp + amt); return pHp; } // 吸血是自身機制，不受治療攔截影響
    if (_healImmune) return pHp;                          // 對鮮血的渴望：外部治療一律無效
    if (_healToDamage > 0) { const dmg = Math.round(amt * _healToDamage); mHp -= dmg; totalDamage += dmg; return pHp; } // 聖人：回血轉為對敵傷害、不回血
    _totalHealDone += amt;
    pHp = Math.min(pStats.maxHp, pHp + amt); return pHp;
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
  let round = Math.max(1, Math.floor(Number(options.startRound || 1)));
  let endRound = round + Math.max(1, Math.floor(Number(MAX_ROUNDS) || 1)) - 1;
  // BOSS 單位判定（世界王/區域王）：暈眩抗性與格擋規則會用到
  const monsterIsBossUnit = Boolean(options.monsterIsBoss || options.isBoss || options.isWorldBoss || mCalc?.isBoss);
  // BOSS 暈眩抗性：被擊暈最多 1 回合（防多段/永暈鏈）；一般怪不受影響
  const capMonsterStun = (v) => (monsterIsBossUnit ? Math.min(v, 1) : v);
  let stunRoundsLeft = capMonsterStun(Math.max(0, Math.floor(Number(options.stunRoundsLeft || 0)))); // 怪物剩餘擊暈回合數
  let monsterActiveEffects = Array.isArray(options.monsterActiveEffects)
    ? options.monsterActiveEffects.map((effect) => ({ ...effect, params: { ...(effect.params || {}) } }))
    : []; // 怪物的 active effects（Buff/Debuff）
  const cardCooldowns = {
    player: { ...(options.cardCooldowns?.player || {}) },
    monster: { ...(options.cardCooldowns?.monster || {}) },
  };
  const jobSkillCooldowns = {}; // { [skillKey]: remainingTurns }
  let jobSkillUsedThisRound = false;
  const combatStats = {
    comboCount: 0,
    dodgeCount: 0,
    blockCount: 0,
    stunCount: 0,
    burnTriggerCount: 0,
    attackCount: 0
  };
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
          // build 錨點四件（沒苦硬吃 / 聖人比拳頭 / 對鮮血的渴望 / 時間管理大師）
          if (ep.key === "endure_burst") {
            _endureBurst = { round: Math.max(1, Number(ep.params?.round) || 14), mult: Math.max(1, Number(ep.params?.mult) || 5) };
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
              const amt = Math.max(1, Math.round((pStats.maxHp || 0) * pct / 100));
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

  while (round <= endRound && outcome === null) {
    const log = [`**【第 ${round} 回合】**`];
    // 沒苦硬吃：扛到指定回合仍不死 → 對敵爆發「累積承受總傷害 × 倍率」
    if (_endureBurst && !_endureFired && round >= _endureBurst.round && pHp > 0 && _totalDmgTaken > 0) {
      _endureFired = true;
      const _burst = Math.round(_totalDmgTaken * _endureBurst.mult);
      mHp -= _burst;
      totalDamage += _burst;
      log.push(`💥【沒苦硬吃】扛過 ${_endureBurst.round} 回合的痛，全數奉還！造成 **${_burst}** 爆發傷害（承受總傷 ${_totalDmgTaken} × ${_endureBurst.mult}）`);
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
    if (round === 1 && jobProfile.jobName) {
      log.push(`✨ ${jobProfile.jobName} ${rand(jobFlavor.intro)}`);
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
            mHp = Math.min(mHpInit, mHp + heal);
            log.push(`💚 ${mName} 生命力逐漸恢復，回復 **${heal}** HP！（${mName} 剩 ${mHp} HP）`);
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

    // ── 應用怪物的 DOT 效果（燒傷/freeze/麻痺） ──
    let monsterFrozenThisRound = false;
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
          mHp -= burnDmg;
          totalDamage += burnDmg;
          combatStats.burnTriggerCount += 1; // 焰獄審判任務:玩家施加給怪的燃燒每跳一次算「觸發燃燒」1 次
          log.push(`🔥 燒傷持續！${mName} 受到 **${burnDmg}** 點灼燒傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
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
          mHp -= poisonDmg;
          totalDamage += poisonDmg;
          log.push(`☠️ 中毒持續！${mName} 受到 **${poisonDmg}** 點毒素傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
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
            stunRoundsLeft = capMonsterStun(Math.max(stunRoundsLeft, stunEnd - round + 1));
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
          mHp -= bleedDmg;
          totalDamage += bleedDmg;
          log.push(`🩸 流血持續！${mName} 受到 **${bleedDmg}** 點流血傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
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
          mHp -= shockDmg;
          totalDamage += shockDmg;
          log.push(`⚡ 感電持續！${mName} 受到 **${shockDmg}** 點電擊傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
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
          mHp -= curseDmg;
          totalDamage += curseDmg;
          log.push(`🕯️ 詛咒持續！${mName} 受到 **${curseDmg}** 點暗影傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
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
          mHp -= lightDmg;
          totalDamage += lightDmg;
          log.push(`⚡ 閃電持續！${mName} 受到 **${lightDmg}** 點雷電傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 震盪：每回合對怪物造成 value% 傷害
        if (mEff.key === 'shock_dot') {
          const shockPct = Number(mParams.value ?? 20);
          const shockBase = mParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(mParams.casterAtk || 1))
            : mHpInit;
          let shockDmg = Math.max(1, Math.round(shockBase * (shockPct / 100)));
          if (Number.isFinite(Number(mParams.maxDamage))) shockDmg = Math.min(shockDmg, Number(mParams.maxDamage));
          shockDmg = Math.max(1, Math.round(shockDmg * playerAttackLevelMult * wbDotMult)); // DOT 也吃等級壓制(世界王再吃 def%)
          if (_noPlayerAtk) shockDmg = 0;
          mHp -= shockDmg;
          totalDamage += shockDmg;
          log.push(`⚡ 震盪持續！${mName} 受到 **${shockDmg}** 點震盪傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 詛咒：每回合對怪物造成 value% 傷害
        if (mEff.key === 'curse_dot') {
          const cursePct = Number(mParams.value ?? 20);
          const curseBase = mParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(mParams.casterAtk || 1))
            : mHpInit;
          let curseDmg = Math.max(1, Math.round(curseBase * (cursePct / 100)));
          if (Number.isFinite(Number(mParams.maxDamage))) curseDmg = Math.min(curseDmg, Number(mParams.maxDamage));
          curseDmg = Math.max(1, Math.round(curseDmg * playerAttackLevelMult * wbDotMult)); // DOT 也吃等級壓制(世界王再吃 def%)
          mHp -= curseDmg;
          totalDamage += curseDmg;
          log.push(`🌑 詛咒持續！${mName} 受到 **${curseDmg}** 點詛咒傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }
      }
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
    const mitigateDot = (dmg) => applyDefense(dmg, pStats.flatDef || 0, pStats.def || 0, mCalc.atk || 1);
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
        if (dotEffect.key === 'heal_over_time') {
          const healPct = Number(dotParams.value ?? 0);
          const heal = dotParams.mode === 'flat'
            ? Math.max(0, Math.round(healPct))
            : Math.max(0, Math.round((pStats.maxHp || 1) * (healPct / 100)));
          if (heal > 0) {
            pHp = _healPlayer(heal);
            log.push(`💚 回復效果發動！你恢復 **${heal}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
          }
        }

        if (dotEffect.key === 'poison') {
          const damagePercent = Number(dotParams.damagePercent ?? dotParams.value ?? 5);
          const dotBase = dotParams.mode === 'caster_atk_pct'
            ? Math.max(1, Number(dotParams.casterAtk || 1))
            : (pStats.maxHp || 1);
          let dotDmg = Math.max(1, Math.round(dotBase * (damagePercent / 100)));
          if (Number.isFinite(Number(dotParams.maxDamage))) dotDmg = Math.min(dotDmg, Number(dotParams.maxDamage));
          dotDmg = mitigateDot(dotDmg);
          _hurt(dotDmg);
          log.push(`☠️ 中毒傷害！造成 **${dotDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
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
          _hurt(bleedDmg);
          log.push(`🩸 流血持續！你受到 **${bleedDmg}** 點流血傷害！（你剩 ${Math.max(0, pHp)} HP）`);
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
          _hurt(burnDmg);
          log.push(`🔥 燒傷持續！你受到 **${burnDmg}** 點灼燒傷害！（你剩 ${Math.max(0, pHp)} HP）`);
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
          _hurt(lightDmg);
          log.push(`⚡ 閃電傷害！你受到 **${lightDmg}** 點雷電傷害！（你剩 ${Math.max(0, pHp)} HP）`);
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
          _hurt(shockDmg);
          log.push(`⚡ 震盪傷害！你受到 **${shockDmg}** 點震盪傷害！（你剩 ${Math.max(0, pHp)} HP）`);
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
          _hurt(curseDmg);
          log.push(`🌑 詛咒傷害！你受到 **${curseDmg}** 點詛咒傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
      }
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
    try {
      // 光環不疊加:同一效果(key)只保留數值最高的提供者版本(跨 DC/網頁一致),
      // 連帶讓下方戰報「✨ 光環加持」也只列出最高的那個來源,不會每位提供者各列一行疊加。
      const _rawPartyEffects = Array.isArray(options.partyEffects) ? options.partyEffects : [];
      const _bestEffByKey = new Map();
      for (const pe of _rawPartyEffects) {
        if (!pe || !pe.key) continue;
        const v = Math.abs(Number(pe.params?.value ?? pe.value ?? 0));
        const prev = _bestEffByKey.get(pe.key);
        const pv = prev ? Math.abs(Number(prev.params?.value ?? prev.value ?? 0)) : -Infinity;
        if (v > pv) _bestEffByKey.set(pe.key, pe);
      }
      const partyEffects = Array.from(_bestEffByKey.values());
      const auraDetails = new Map(); // 依 sourceName 分組光環效果

      for (const pe of partyEffects) {
        if (!pe || !pe.key) continue;
        const sourceName = pe.sourceName || "未知";
        if (!auraDetails.has(sourceName)) {
          auraDetails.set(sourceName, {
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
            comboBoost: 0
          });
        }

        // 支援治療 over-time 的簡單實作：key 可為 'heal_over_time' 或自訂 'party_heal'
        if (pe.key === 'heal_over_time' || pe.key === 'party_heal') {
          const mode = String(pe.params?.mode || '').toLowerCase();
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (!Number.isFinite(val) || val === 0) continue;
          const heal = mode === 'pct' ? Math.max(0, Math.round((pStats.maxHp || 0) * (val / 100))) : Math.max(0, Math.round(val));
          if (heal > 0) {
            // 聖者（heal_to_damage）：外部隊友的治療光環直接「取消」（不回血也不轉傷害）；
            // 自己的治療光環則照走 _healPlayer → 在聖者下轉成 ×7 傷害。
            if (_healToDamage > 0 && pe.isSelfAura === false) continue;
            const _mBefore = mHp;
            pHp = _healPlayer(heal);
            const detail = auraDetails.get(sourceName);
            if (_healToDamage > 0) {
              // 聖者：自己的治療化為傷害 → 戰報明講（避免玩家看到「回復」誤會）
              const _dealt = _mBefore - mHp;
              if (_dealt > 0) log.push(`🩸 **聖者・回血化刃**！${sourceName} 的治療 **${heal}** 化為 **${_dealt}** 傷害（×${_healToDamage}）！（怪物剩 ${Math.max(0, mHp)} HP）`);
              detail.healToDmg = (detail.healToDmg || 0) + Math.max(0, _dealt);
            } else {
              detail.heal = heal;
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
            const detail = auraDetails.get(sourceName);
            detail.damageReduction = val;
          }
        }
        if (pe.key === 'party_crit_damage_reduction') {
          const val = Math.abs(Number(pe.params?.value ?? pe.value ?? 0));
          if (Number.isFinite(val) && val !== 0) {
            roundPartyCritDamageReductionPct += val;
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
      }

      // 第 1 回合宣告全部光環加持（整理成單一區塊，每位提供者一行；後續回合略過）
      if (round === 1) {
        const auraLines = [];
        for (const [sourceName, detail] of auraDetails) {
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
          if (detail.heal > 0) parts.push(`每回合回復 ${detail.heal} HP`);
          if (detail.healToDmg > 0) parts.push(`🩸 聖者：回血化為傷害（本回合 ${detail.healToDmg}）`);
          if (parts.length === 0) continue;
          const jobTag = detail.jobName ? `（${detail.jobName}）` : "";
          const who = (sourceName && sourceName !== "未知") ? `${sourceName}${jobTag}` : (detail.jobName || "光環");
          auraLines.push(`　• ${who}：${parts.join("、")}`);
        }
        if (auraLines.length > 0) {
          log.push("✨ **光環加持**");
          for (const line of auraLines) log.push(line);
        }
      }
    } catch (e) {}

    const monsterIsStunned = stunRoundsLeft > 0;
    const getRoundTargetDamageMultiplier = () => {
      let multiplier = 1;
      if (roundHighHpDmgBoostPct > 0 && mHp > mHpInit * 0.5) {
        multiplier *= (1 + roundHighHpDmgBoostPct / 100);
      }
      if (roundStunnedDmgBoostPct > 0) {
        const targetIsStunned = stunRoundsLeft > 0 || monsterActiveEffects.some(e => e.key === 'stun' && effectIsActive(e, round));
        if (targetIsStunned) multiplier *= (1 + roundStunnedDmgBoostPct / 100);
      }
      return multiplier;
    };

    // 怪物自身的卡片技能
    const monsterEquipped = options.monsterEquipped || {};
    const monsterHasCardSkill = !!(monsterEquipped.special_1?.monsterCardSkill?.key);
    if (monsterIsStunned && monsterHasCardSkill) {
      log.push(`😵 ${mName} 仍處於擊暈狀態，無法發動技能！`);
    } else if (monsterIsSilenced && monsterHasCardSkill) {
      log.push(`🔇 ${mName} 陷入沉默，無法發動技能！`);
    }
    if (!monsterIsStunned && !monsterIsSilenced && monsterEquipped.special_1 && monsterEquipped.special_1.monsterCardSkill && monsterEquipped.special_1.monsterCardSkill.key) {
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
          skillDescription: skill.description || '',
          cooldownBucket: cardCooldowns.monster,
          cooldownKey,
          cooldownTurns: Number(skill.cooldownTurns) || 0,
            ownerActiveEffects: monsterActiveEffects,
            targetActiveEffects: options.playerActiveEffects || [],
            ownerLabel: mName,
            sourceAtk: adjustedMCalc.atk || mCalc.atk || 1,
            ownerMaxHp: mHpInit || mHp || 1,
            targetMaxHp: pStats.maxHp || pHp || 1,
            targetLabel: '你',
            applyTargetDamage: (damage) => { _hurt(damage); return pHp; },
            applyOwnerHeal: (heal) => { mHp = Math.min(mHpInit, mHp + reduceMonsterHeal(heal)); return mHp; },
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

        for (const procEffect of normalProcEffects) {
          if (!procEffect || !procEffect.key) continue;
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
            skillDescription: skill.description || '',
            targetLabel: '你',
            sourceAtk: adjustedMCalc.atk || mCalc.atk || 1,
            targetMaxHp: pStats.maxHp || pHp || 1,
            applyTargetDamage: (damage) => { _hurt(damage); },
            mitigate: (d) => applyDefense(d, pStats.flatDef || 0, pStats.def || 0, mCalc.atk || 1), // 即時技能也吃玩家防禦
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
            skillDescription: skill.description || '',
            targetLabel: mName,
            sourceAtk: adjustedMCalc.atk || mCalc.atk || 1,
            targetMaxHp: mHpInit || mHp || 1,
            applyTargetHeal: (heal) => { mHp = Math.min(mHpInit, mHp + reduceMonsterHeal(heal)); return mHp; },
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
            // 怪物DEBUFF → 施加給玩家（同 key 先清舊的，防止 DOT 疊加）
            if (!options.playerActiveEffects) options.playerActiveEffects = [];
            options.playerActiveEffects = addOrStackCardEffect(options.playerActiveEffects, effectEntry);
            appliedAnyNormalProc = true;
          }
        }
        if (appliedAnyNormalProc && !loggedImmediateNormalProc) {
          log.push(`🎴 **${mName}** 發動【${skill.name || cardName}】！${skill.description ? skill.description : ''}`);
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
    if (worldBossHasLightning) {
      if (Math.random() * 100 < worldBossLightningHitChance) {
        // 生命%傷：算完最大生命 × pct 後，也走玩家防禦(flatDef + def%)，不再無視防禦
        const lightningRaw = Math.max(1, Math.round(Math.max(1, pStats.maxHp || pHp) * (worldBossLightningHpPct / 100)));
        const lightningDmg = applyDefense(lightningRaw, pStats.flatDef || 0, pStats.def || 0, mCalc.atk || 1);
        _hurt(lightningDmg);
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
    log.push(`──── ⚔️ 你的回合 ────`);
    const attackCount = pStats.isDualWield ? 2 : 1;
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
    const specialSlots = ['special_1', 'special_2', 'special_3'];
    for (const slot of specialSlots) {
      const slotItem = options.equipped?.[slot];
      if (!playerIsSilenced && slotItem && slotItem.monsterCardSkill && slotItem.monsterCardSkill.key
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
            skillDescription: skill.description || '',
            cooldownBucket: cardCooldowns.player,
            cooldownKey,
            cooldownTurns: Number(skill.cooldownTurns) || 0,
            ownerActiveEffects: options.playerActiveEffects || [],
            targetActiveEffects: monsterActiveEffects,
            ownerLabel: playerBattleName,
            sourceAtk: pStats.atk || 1,
            ownerMaxHp: pStats.maxHp || pHp || 1,
            targetMaxHp: mHpInit || mHp || 1,
            targetLabel: mName,
            applyTargetDamage: (damage) => { mHp -= damage; totalDamage += Math.max(0, Number(damage) || 0); return mHp; }, // 玩家卡即時傷害要計入總傷害(否則世界王落地會回彈)
            applyOwnerHeal: (heal) => { pHp = _healPlayer(heal); return pHp; },
            buffKeys: PLAYER_CARD_OFFENSIVE_KEYS,
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
              stunRoundsLeft = capMonsterStun(Math.max(stunRoundsLeft, stunDur));
            }
          }
        }

      if (normalProcEffects.length > 0 && (cardCooldowns.player[cooldownKey] || 0) <= 0 && Math.random() * 100 < triggerChance) {
        if (Number(skill.cooldownTurns) > 0) cardCooldowns.player[cooldownKey] = Number(skill.cooldownTurns);
        const shouldShowGenericSkillLine = !normalProcEffects.some((effect) => shouldSuppressImmediateLog(effect));
        let appliedAnyNormalProc = false;

        for (const procEffect of normalProcEffects) {
          if (!procEffect || !procEffect.key) continue;
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
            const extraDmg = Math.max(1, Math.round((pStats.atk || 1) * pct));
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
              const chainDmg = Math.max(1, Math.round((pStats.atk || 1) * chainPct));
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
            pHp = _healPlayer(healAmt);
            log.push(`💚 **${playerBattleName}** 發動【${skill.name || cardName}】恢復 **${healAmt}** HP！（剩 ${pHp}）`);
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
            skillDescription: skill.description || '',
            targetLabel: mName,
            sourceAtk: pStats.atk || 1,
            targetMaxHp: mHpInit || mHp || 1,
            applyTargetDamage: (damage) => { mHp -= damage; totalDamage += Math.max(0, Number(damage) || 0); }, // 同上:即時傷害計入總傷害
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
            skillDescription: skill.description || '',
            targetLabel: playerBattleName,
            sourceAtk: pStats.atk || 1,
            targetMaxHp: pStats.maxHp || pHp || 1,
            applyTargetHeal: (heal) => { pHp = _healPlayer(heal); return pHp; },
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
              stunRoundsLeft = capMonsterStun(Math.max(stunRoundsLeft, stunDur));
            }
          } else {
            if (!options.playerActiveEffects) options.playerActiveEffects = [];
            options.playerActiveEffects = addOrStackCardEffect(options.playerActiveEffects, effectEntry);
            appliedAnyNormalProc = true;
          }
        }
        if (shouldShowGenericSkillLine && appliedAnyNormalProc && !hpGatedAppliedThisRound) {
          log.push(`🎴 **${playerBattleName}** 發動【${skill.name || cardName}】！${skill.description ? skill.description : ''}`);
        }
      }
    }
    }

    // ── 職業技能觸發（35% 機率，每回合限一次，回合開頭讀取 HP 條件後發動）──
    if (!jobSkillUsedThisRound && !playerIsStunned && !playerIsFrozen && outcome === null) {
      const jobSkills = Array.isArray(options.equipped?.job_eq?.jobSkills)
        ? options.equipped.job_eq.jobSkills : [];
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
          return true;
        });
        if (available.length > 0) {
          const chosen = available[Math.floor(Math.random() * available.length)];
          jobSkillUsedThisRound = true;
          if (Number(chosen.cooldownTurns) > 0) jobSkillCooldowns[chosen.key] = Number(chosen.cooldownTurns);
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
              pHp = _healPlayer(heal);
              log.push(`✨ **(${jobProfile.jobName || '職業技能'})** 發動【${chosen.name}】！回復 **${heal}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
              skillApplied = true;
              continue;
            }
            const entry = makeCardEffectEntry(pe, round - 1, 'job_skill', {}, `job:${chosen.key}:${pe.key}`);
            entry.params.sourceName = jobProfile.jobName || '職業技能';
            if (pe.target === 'enemy' || JOB_SKILL_OFFENSIVE.has(pe.key)) {
              monsterActiveEffects = addOrStackCardEffect(monsterActiveEffects, entry);
              if (entry.key === 'stun') {
                const stunDur = Number(entry.params?.duration?.value ?? 1);
                stunRoundsLeft = capMonsterStun(Math.max(stunRoundsLeft, stunDur));
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
              log.push(`✨ **(${jobProfile.jobName || '職業技能'})** 發動【${chosen.name}】！${chosen.description || ''}`);
            }
          }
        }
      }
    }

    // ── 計算玩家主動效果倍率 ──
    let playerAtkMultiplier = 1;
    let playerCritRateBonus = 0;
    let playerCritDamageMultiplier = 1;
    let playerLifestealPct = 0;
    let playerLifestealStrongPct = 0;
    let playerDefBonusPct = 0;
    let playerDefDownPct = 0;
    let playerDefFlatBonus = 0;
    let playerDodgeBonus = 0;
    let playerBlockBonus = 0;
    let playerHitPenalty = 0;
    let playerDefIgnorePct = 0;
    let playerDamageReductionPct = 0;
    let playerFinalDamageMultiplier = 1;
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
    let playerLifeRegenPct = 0;            // 救護系：每 interval 回合回復 value% MaxHP
    let playerLifeRegenInterval = 0;
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
        } else if (eff.key === 'crit_rate_up') {
          // 玩家爆擊率提升（來自玩家卡片技能）
          playerCritRateBonus += effValue;
        } else if (eff.key === 'hit_up') {
          playerHitBonus += effValue;
        } else if (eff.key === 'crit_damage_up') {
          playerCritDamageMultiplier *= (1 + Math.abs(effValue) / 100);
        } else if (eff.key === 'lifesteal') {
          // 玩家吸血（來自玩家卡片技能）
          playerLifestealPct += effValue;
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
        } else if (eff.key === 'agi_up') {
          playerDodgeBonus += Math.abs(effValue) * 0.5;
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
          if (effParams.mode === 'flat') playerHotFlat += Math.abs(effValue);
          else playerHotPct += Math.abs(effValue);
        } else if (eff.key === 'life_regen') {
          // value 為 %MaxHP、每 interval 回合回一次（依戒指/卡片說明）
          playerLifeRegenPct += Math.abs(effValue);
          const iv = Math.max(1, Number(effParams.interval) || 1);
          if (playerLifeRegenInterval === 0 || iv < playerLifeRegenInterval) playerLifeRegenInterval = iv;
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
          const n = Math.max(2, Math.round(Number(effValue) || Number(effParams.hits) || 3));
          if (n > playerTripleStrike) playerTripleStrike = n;
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

    for (let a = 0; a < attackCount && outcome === null && !playerIsStunned && !playerIsFrozen; a++) {
      const hitChance = calcHitChance({
        hit: (pStats.hit + playerHitBonus - playerHitPenalty),
        dodge: adjustedMCalc.dodge,
        min: 20,
      });

      // ── 擲攻擊階級（5 階：大失敗/失敗/成功/大成功/完美）──
      const atkTierProbs = calcAttackTierProbs(pStats.dex || 0, pStats.luk || 0);
      const atkTier = rollAttackTier(atkTierProbs);

      // 大失敗：自殘 30%，跳過本次攻擊
      if (atkTier === 'critFail') {
        const selfBase = Math.max(1, Math.round((pStats.atk || 1) * playerAttackLevelMult));
        const selfDmg = Math.max(1, Math.round(selfBase * 0.3 * (0.7 + Math.random() * 0.3)));
        _hurt(selfDmg);
        log.push(`💥 **大失敗**！你揮拳失手砸到自己，受到 **${selfDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
        if (pHp <= 0) { outcome = "lose"; break; }
        continue;
      }
      // 失敗：強制 miss（不看 HIT/DODGE）
      if (atkTier === 'fail') {
        log.push(`❌ **失敗**！你手滑揮空，沒打到 ${mName}！`);
        continue;
      }

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
            stunRoundsLeft = capMonsterStun(Math.max(stunRoundsLeft, stunDur));
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'stun', params: { value: 100, duration: { mode: 'turns', value: stunDur } },
              appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:stun'
            });
            log.push(`😵 ${mName} 被重擊擊暈！接下來 ${stunDur} 回合無法攻擊！`);
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
            const healAmt = Math.max(1, Math.round((pStats.maxHp || 100) * (Number(pp.value ?? 5) / 100)));
            pHp = _healPlayer(healAmt);
            log.push(`💚 戰鬥回復！恢復 **${healAmt}** HP！（你剩 ${pHp}）`);
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
      if (outcome !== null) break;

      // 大成功 / 完美：跳過 HIT/DODGE 必中
      const forceHit = (atkTier === 'great' || atkTier === 'perfect');

      if (monsterIsStunned || forceHit || Math.random() * 100 < hitChance) {
        // 破防判定（斧）
        const isBreak = Math.random() * 100 < pStats.armorBreakChance;
        const effectiveDef = isBreak ? 0 : Math.max(0, adjustedMCalc.def * (1 - Math.min(95, roundMonsterDefDownPct) / 100));
        // 法杖無視怪物 DEF 的 bypassMonsterDefPct%（預設0，法杖50）
        const bypassPct = pStats.bypassMonsterDefPct ?? 0;
        const combinedBypassPct = Math.min(100, Math.max(0, bypassPct + playerDefIgnorePct + roundPartyDefIgnorePct));
        const finalDef = Math.max(0, effectiveDef * (1 - combinedBypassPct / 100));

        let conditionalBonusMultiplier = getRoundTargetDamageMultiplier();
        // 怪物圖鑑加成：對該怪累積擊殺愈多,傷害愈高（最高 +25%；由呼叫端依玩家進度計算後傳入）
        const _bestiaryBonusPct = Math.max(0, Math.min(25, Number(options.bestiaryBonusPct) || 0));
        if (_bestiaryBonusPct > 0) {
          conditionalBonusMultiplier *= (1 + _bestiaryBonusPct / 100);
        }
        if (playerBonusVsPoisonedPct > 0 && monsterActiveEffects.some(e => e.key === 'poison' && effectIsActive(e, round))) {
          conditionalBonusMultiplier *= (1 + playerBonusVsPoisonedPct / 100);
        }
        if (playerBonusVsDebuffedPct > 0 && hasAnyDebuff(monsterActiveEffects, round)) {
          conditionalBonusMultiplier *= (1 + playerBonusVsDebuffedPct / 100);
        }
        if (playerBonusVsBurningPct > 0 && monsterActiveEffects.some(e => e.key === 'burn' && effectIsActive(e, round))) {
          conditionalBonusMultiplier *= (1 + playerBonusVsBurningPct / 100);
        }
        if (playerBonusVsStunnedPct > 0 && (stunRoundsLeft > 0 || monsterActiveEffects.some(e => e.key === 'stun' && effectIsActive(e, round)))) {
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
          const monsterIsStunned = Array.isArray(monsterActiveEffects) && monsterActiveEffects.some((e) => e && e.key === 'stun' && effectIsActive(e, round));
          if (monsterIsStunned && Number.isFinite(Number(pStats.dwarfWarriorBonusVsStunnedPct)) && Number(pStats.dwarfWarriorBonusVsStunnedPct) > 0) {
            conditionalBonusMultiplier *= (1 + Number(pStats.dwarfWarriorBonusVsStunnedPct) / 100);
          }
        }
        const attackBase = Math.max(
          1,
          Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * roundBossDmgMultiplier * roundEliteDmgMultiplier * playerFinalDamageMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier * conditionalBonusMultiplier * playerAttackLevelMult)
        );
        // 新公式 B：flatDef 在 ATK 階段壓制（傳 pStats.atk 作為 rawAtk）
        let dmg = rollDmg(applyDefense(attackBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk));

        // ── 套攻擊階級乘數（成功 ×1.0 / 大成功 ×1.3；完美走爆擊另算）──
        const atkTierMult = ATTACK_TIER_MULT[atkTier] ?? 1.0;
        if (atkTier !== 'perfect' && atkTierMult !== 1.0) {
          dmg = Math.max(1, Math.round(dmg * atkTierMult));
        }

        // ── 擲防禦階級（4 階）──
        const defTierProbs = calcDefenseTierProbs(adjustedMCalc.dex || 0, adjustedMCalc.luk || 0);
        const defTier = rollDefenseTier(defTierProbs);
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

        // 爆擊判定：完美攻擊階級 = 必爆擊；否則照原本爆擊率
        const effectiveCrit = Math.min(100, (pStats.crit || 0) + playerCritRateBonus + extraHighHpCrit);
        isCrit = (atkTier === 'perfect') || (Math.random() * 100 < effectiveCrit);

        let finalDamage = dmg;
        if (isCrit) {
          const critPostDef = applyDefense(attackBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk);
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
        if (finalDamage > 0) finalDamage += weaponMainBonus;

        // 每擊傷害上限（金錢袋怪等「必定格擋、每擊只扣N」）：所有加成/爆擊算完後硬性夾住上限
        if (adjustedMCalc.incomingDamageCap > 0 && finalDamage > adjustedMCalc.incomingDamageCap) {
          finalDamage = adjustedMCalc.incomingDamageCap;
        }

        dmg = finalDamage;

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
          pHp = _healPlayer(healAmt);
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

        // ── 三元牌：固定補打 N-1 段（每段獨立擲爆擊、吃連擊增傷、吃地圖特攻；算連擊、可致命）──
        if (playerTripleStrike >= 2 && mHp > 0) {
          const _sanyuan = ["白", "發", "中"];
          // 每段基底＝未爆擊 1/N ×（地圖特攻/最終傷害%）→ 避免疊到主擊爆擊；再逐段各自吃連擊增傷+獨立爆擊
          const _tsCleanBase = Math.max(1, Math.round(nonCritDamageBase / playerTripleStrike * (equipZoneFinalDmgMult * roundScaleMult(round))));
          for (let _ts = 1; _ts < playerTripleStrike && mHp > 0; _ts++) {
            let tsDmg = Math.max(1, Math.round(_tsCleanBase * (pStats.comboDamageMultiplier || 1)));
            const tsCrit = (Math.random() * 100 < effectiveCrit);
            if (tsCrit) tsDmg = Math.max(1, Math.round(tsDmg * 2 * playerCritDamageMultiplier * tierCritDamageMultiplier));
            if (weaponMainBonus > 0) tsDmg += weaponMainBonus;
            if (_noPlayerAtk) tsDmg = 0;
            mHp -= tsDmg;
            totalDamage += tsDmg;
            combatStats.comboCount += 1;
            const _pai = _sanyuan[_ts % _sanyuan.length];
            const _tsCritNote = tsCrit ? `✨**${rand(critPhrases)}**！` : "";
            log.push(`🀄 ${_tsCritNote}**三元・${_pai}**！再造成 **${tsDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          }
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
          const weaponStunDur = pStats.stunDuration || 3;
          stunRoundsLeft = weaponStunDur;
          monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
            key: 'stun',
            params: { value: 100, duration: { mode: 'turns', value: weaponStunDur } },
            appliedAt: round,
            sourceType: 'job_proc',
            sourceId: 'dwarf_warrior:stun'
          });
          combatStats.stunCount += 1;
          log.push(`😵 ${mName} ${rand(stunPhrases)}！接下來 ${weaponStunDur} 回合無法攻擊！`);
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
              stunRoundsLeft = capMonsterStun(Math.max(stunRoundsLeft, stunDur));
              monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                key: 'stun', params: { value: 100, duration: { mode: 'turns', value: stunDur } },
                appliedAt: round, sourceType: 'job_proc', sourceId: 'badge:stun'
              });
              log.push(`😵 ${mName} 被重擊擊暈！接下來 ${stunDur} 回合無法攻擊！`);

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
              const extraDmg = Math.max(1, Math.round(dmg * Number(pp.damageMultiplier ?? 0.5)));
              mHp -= extraDmg;
              totalDamage += extraDmg;
              log.push(`✨ 追加攻擊！對 ${mName} 額外造成 **${extraDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              if (mHp <= 0) { outcome = "win"; break; }

            } else if (pe.key === 'proc_chain_hit') {
              const chainCount = Math.max(1, Math.floor(Number(pp.chainCount ?? 2)));
              const chainPct = Number(pp.damageMultiplier ?? 0.3);
              for (let c = 0; c < chainCount; c++) {
                const chainDmg = Math.max(1, Math.round(dmg * chainPct));
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
              pHp = _healPlayer(healAmt);
              log.push(`💚 戰鬥回復！恢復 **${healAmt}** HP！（你剩 ${pHp}）`);

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
          pHp = _healPlayer(healAmt);
          log.push(`💚 命中回血！恢復 **${healAmt}** HP！`);
        }
        if (isCrit && playerOnCritHealPct > 0) {
          const healAmt = Math.max(1, Math.round(dmg * (playerOnCritHealPct / 100)));
          pHp = _healPlayer(healAmt);
          log.push(`💚✨ 暴擊回血！恢復 **${healAmt}** HP！`);
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

        // ── 玩家吸血效果（來自卡片技能）──
        if (playerLifestealPct > 0) {
          const healAmt = Math.max(1, Math.round(dmg * (playerLifestealPct / 100)));
          pHp = _healPlayer(healAmt, { lifesteal: true });
          log.push(`💚 吸取生命力！恢復 **${healAmt}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
        }
        // ── 強力吸血效果（林地妖靈卡）──
        if (playerLifestealStrongPct > 0) {
          const sHeal = Math.max(1, Math.round(dmg * (playerLifestealStrongPct / 100)));
          pHp = _healPlayer(sHeal, { lifesteal: true });
          log.push(`💜 強力吸血！恢復 **${sHeal}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
        }

        // ── 檢查怪物反彈傷害效果 ──
        if (Array.isArray(monsterActiveEffects)) {
          for (const reflectEff of monsterActiveEffects) {
            if (reflectEff && reflectEff.key === 'reflect_damage') {
              const reflectParams = reflectEff.params || {};
              const reflectPercent = Number(reflectParams.reflectPercent ?? reflectParams.value ?? 50);
              const reflectDmg = Math.max(1, Math.round(dmg * (reflectPercent / 100)));
              _hurt(reflectDmg);
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
              const counterDmg = Math.max(1, Math.round(dmg * (counterDmgPct / 100)));
              _hurt(counterDmg);
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
        let comboHitsThisAttack = 0;
        let comboKilled = false;
        while (comboHitsThisAttack < MAX_COMBO_PER_ROUND && (comboHitsThisAttack < playerGuaranteedCombo || Math.random() * 100 < comboChance)) {
          // 連擊逐段命中判定：被迴避/未命中 → 立即中斷連段（怪被暈時無法閃避、必中；不吃主擊的大成功/完美必中）
          const comboConnects = comboHitsThisAttack < playerGuaranteedCombo || monsterIsStunned || Math.random() * 100 < hitChance;
          if (!comboConnects) {
            log.push(`💨 ${mName} ${rand(jobFlavor.dodge)}，連擊被閃開，連段中斷！`);
            break;
          }
          comboHitsThisAttack += 1;
          combatStats.comboCount += 1;
          // 龍王戰意：連擊傷害吃「目前已疊加、超出主攻擊基準」的攻擊層數（含主攻擊命中那一層），連擊愈多愈痛
          const comboStackEscalationPct = Math.max(0, stackOnHitStacks - attackStackPctBase);
          // 連擊:用「未含追加值」的傷害乘連擊倍率 ×龍王戰意疊加成長,再額外加一次武器主屬性追加(固定,不被倍率縮放)
          let cdmg = Math.max(1, Math.round(Math.max(1, dmg - weaponMainBonus) * (pStats.comboDamageMultiplier || 1) * (1 + comboStackEscalationPct / 100)) + weaponMainBonus);
          // 連擊逐段格檔判定：被格檔不中斷連段，只把該段傷害壓到 1（連擊為非爆擊，不走爆擊破格）
          let comboBlockNote = "";
          if (adjustedMCalc.blockChance > 0 && Math.random() * 100 < adjustedMCalc.blockChance) {
            cdmg = 1;
            comboBlockNote = `，但 ${mName} ${rand(BLOCK_PHRASES)}，傷害降至 **1**`;
          }
          // 每擊傷害上限（同主攻擊）：連擊段也夾住上限
          if (adjustedMCalc.incomingDamageCap > 0 && cdmg > adjustedMCalc.incomingDamageCap) cdmg = adjustedMCalc.incomingDamageCap;
          if (_noPlayerAtk) cdmg = 0; // 沒苦硬吃：連擊也不造成傷害
          mHp -= cdmg;
          totalDamage += cdmg;
          const comboLabel = comboHitsThisAttack >= 2 ? `${comboHitsThisAttack} 連擊` : "連擊";
          log.push(`⚡ **${rand(jobFlavor.combo)}** ${comboLabel}！再造成 **${cdmg}** 點傷害${comboBlockNote}！（怪物剩 ${Math.max(0, mHp)} HP）`);

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

        if (comboKilled) { outcome = "win"; break; }
      } else {
        log.push(`💨 ${mName} ${rand(jobFlavor.dodge)}，你的攻擊落空了！`);
      }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 怪物攻擊 ──
    log.push(`──── 🛡️ ${mName} 的回合 ────`);
    // AGI 優勢判定：第1回合先手，或偶數回合才反擊
    let monsterAttackCount = 0;
    let monsterDmgThisRound = 0; // 怪物本回合總傷害（甲蟹反擊用）
    let skipMonsterAttackReason = null;

    if (stunRoundsLeft > 0) {
      stunRoundsLeft--;
      skipMonsterAttackReason = "stun";
    } else if (monsterFrozenThisRound) {
      skipMonsterAttackReason = "freeze";
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
      }
    }

    if (skipMonsterAttackReason === "stun") {
      log.push(`😵 ${mName} 仍處於擊暈狀態，無法攻擊！`);
    } else if (skipMonsterAttackReason === "freeze") {
      log.push(`🧊 ${mName} 被冰凍住，此回合無法攻擊！`);
    } else if (skipMonsterAttackReason === "agi_first_strike") {
      log.push(`⚡ ${mName} ${rand(agiFirstStrikePhrases)}，無法反擊！`);
    } else if (skipMonsterAttackReason === "agi_slowed") {
      log.push(`⚡ ${mName} ${rand(agiSlowedAttackPhrases)}，無法即時反擊！`);
    }

    let blockedThisRound = false;
    let lastMonsterDmg = 0;  // 給連擊用
    for (let ma = 0; ma < monsterAttackCount && outcome === null; ma++) {
      const monsterHitChance = playerIsStunned
        ? 100
        : calcHitChance({
            hit: adjustedMCalc.hit,
            dodge: pStats.dodge * (1 + roundPartyAgiBoostPct / 100) + playerDodgeBonus,
            min: 20,
          });

      // ── 怪物擲攻擊階級 ──
      const mAtkTierProbs = calcAttackTierProbs(adjustedMCalc.dex || 0, adjustedMCalc.luk || 0);
      const mAtkTier = rollAttackTier(mAtkTierProbs);

      // 🐺 狼王・連牙亂舞：前 2 段必定命中且必連(無視玩家迴避與怪物自身失誤)；第 3 段起「任何未命中」(玩家迴避 or 怪物自己揮空/大失敗)都打斷剩餘連段
      const hellfangGuaranteedSeg = _hellfangCombo && ma < 2;

      // 大失敗：怪自殘 30%，跳過本次怪攻(狼王保底段不會失誤)
      if (mAtkTier === 'critFail' && !hellfangGuaranteedSeg) {
        const mSelfBase = Math.max(1, Math.round((adjustedMCalc.atk || 1) * monsterAttackLevelMult));
        const mSelfDmg = Math.max(1, Math.round(mSelfBase * 0.3 * (0.7 + Math.random() * 0.3)));
        mHp -= mSelfDmg;
        totalDamage += mSelfDmg;
        log.push(`💥 **${mName} 大失敗**！自亂招式砸到自己，受到 **${mSelfDmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
        if (mHp <= 0) { outcome = "win"; break; }
        if (_hellfangCombo) break; // 🐺 第3段起自己大失敗也打斷連段
        continue;
      }
      // 失敗：強制 miss(狼王保底段不會失誤)
      if (mAtkTier === 'fail' && !hellfangGuaranteedSeg) {
        log.push(`❌ **${mName} 失敗**！揮空了！`);
        if (_hellfangCombo) break; // 🐺 第3段起自己揮空也打斷連段
        continue;
      }
      const mForceHit = (mAtkTier === 'great' || mAtkTier === 'perfect');

      if (playerIsStunned || mForceHit || hellfangGuaranteedSeg || Math.random() * 100 < monsterHitChance) {
        // 盾格擋判定（含主動技能臨時格擋加成，例如劍士「舉步若堅」+25%，上限 95% 與被動一致）
        if (Math.random() * 100 < Math.min(95, (pStats.blockChance || 0) + playerBlockBonus)) {
          blockedThisRound = true;
          combatStats.blockCount += 1;
          if (monsterIsBossUnit) {
            // BOSS 攻勢沉重：格擋不再降至 1，改為卸去 70% 傷害（用未爆擊的基礎傷害計算）
            const bMonsterDefIgnorePct = Math.min(100, Math.max(0, Number(adjustedMCalc.defIgnorePct || 0)));
            const bEffectivePlayerDef = Math.min(95, Math.max(0, ((pStats.def * (1 + playerDefBonusPct / 100) * (1 - playerDefDownPct / 100)) + playerDefFlatBonus) * (1 - bMonsterDefIgnorePct / 100)));
            const bMonsterBaseAtk = Math.max(1, Math.round(adjustedMCalc.atk * (adjustedMCalc.finalDamageMultiplier || 1) * monsterAttackLevelMult));
            const bBaseDmg = playerInvincible ? 0 : rollMDmg(applyDefense(bMonsterBaseAtk, pStats.flatDef || 0, bEffectivePlayerDef, adjustedMCalc.atk));
            const blockedDmg = Math.max(1, Math.round(bBaseDmg * 0.3));
            log.push(`🛡️ ${rand(jobFlavor.block)}！${mName} 的攻勢沉重，格擋卸去 70% 傷害，仍受到 **${blockedDmg}** 點！`);
            _hurt(blockedDmg);
          } else {
            log.push(`🛡️ ${rand(jobFlavor.block)}！${mName} 的攻擊被格擋，傷害降至 **1**！`);
            pHp -= 1;
          }
          if (pHp <= 0) { outcome = "lose"; break; }
        } else {
          const monsterDefIgnorePct = Math.min(100, Math.max(0, Number(adjustedMCalc.defIgnorePct || 0)));
          const effectivePlayerDef = Math.min(95, Math.max(0, ((pStats.def * (1 + playerDefBonusPct / 100) * (1 - playerDefDownPct / 100)) + playerDefFlatBonus) * (1 - monsterDefIgnorePct / 100)));
          // 新公式 B：flatDef 在 ATK 階段壓制（傳 adjustedMCalc.atk 作為 rawAtk）
          const monsterBaseAtk = Math.max(1, Math.round(adjustedMCalc.atk * (adjustedMCalc.finalDamageMultiplier || 1) * monsterAttackLevelMult));
          let dmg = playerInvincible
            ? 0
            : rollMDmg(applyDefense(monsterBaseAtk, pStats.flatDef || 0, effectivePlayerDef, adjustedMCalc.atk));

          // ── 套怪攻擊階級乘數（成功 ×1.0 / 大成功 ×1.3；完美走爆擊另算）──
          const mAtkTierMult = ATTACK_TIER_MULT[mAtkTier] ?? 1.0;
          if (mAtkTier !== 'perfect' && mAtkTierMult !== 1.0) {
            dmg = Math.max(1, Math.round(dmg * mAtkTierMult));
          }

          // ── 玩家擲防禦階級 ──
          const pDefTierProbs = calcDefenseTierProbs(pStats.dex || 0, pStats.luk || 0);
          const pDefTier = rollDefenseTier(pDefTierProbs);
          const pDefTierMult = DEFENSE_TIER_MULT[pDefTier] ?? 1.0;
          if (pDefTierMult !== 1.0) {
            dmg = Math.max(1, Math.round(dmg * pDefTierMult));
          }
          if (!playerInvincible && playerDamageReductionPct > 0) {
            dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, playerDamageReductionPct) / 100)));
          }
          // ── 物理減傷（怪物普攻視為物理）──
          if (!playerInvincible && playerPhysDrPct > 0) {
            dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, playerPhysDrPct) / 100)));
          }
          // ── 狂血右：HP 低時受傷減免 ──
          if (!playerInvincible && playerHpLowReductionPct > 0) {
            const hpPctNow = (pStats.maxHp > 0) ? (pHp / pStats.maxHp) * 100 : 0;
            if (hpPctNow <= playerHpLowReductionThreshold) {
              dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, playerHpLowReductionPct) / 100)));
            }
          }
          // ── 戰意右：受擊累積（依玩家防禦堆疊轉化為減傷）──
          if (stackOnTakenStacks > 0) {
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
            // 爆擊倍率 ×2（與玩家對齊）
            dmg = Math.round(dmg * (2 * (adjustedMCalc.critDamageMultiplier || 1)));
            if (!playerInvincible && roundPartyCritDamageReductionPct > 0) {
              dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, roundPartyCritDamageReductionPct) / 100)));
            }
          }
          if (!playerInvincible && roundPartyDamageReductionPct > 0) {
            dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, roundPartyDamageReductionPct) / 100)));
          }

          // 構建傷害敘述
          let mAtkNote = "";
          if (mAtkTier === 'great') mAtkNote += "⚡**怪物大成功**！";
          else if (mAtkTier === 'perfect') mAtkNote += "🌟**怪物完美**！";
          if (hasMonsterCrit) mAtkNote += "✨**會心一擊**！";
          if (pDefTier === 'crushed') mAtkNote += "💢被爆打！";
          else if (pDefTier === 'reduce') mAtkNote += "🛡️減傷！";
          else if (pDefTier === 'graze') mAtkNote += "🌬️擦傷！";

          // ── 護盾吸收（shield / barrier）──
          let shieldAbsorbed = 0;
          if (!playerInvincible && dmg > 0 && Array.isArray(options.playerActiveEffects)) {
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
          if (!playerInvincible && playerDamageToHealPct > 0 && dmg > 0) {
            damageToHealAmount = Math.max(1, Math.round(dmg * (playerDamageToHealPct / 100)));
          }
          // ── 免死一次（death_prevent_once）──
          if (!deathPreventUsed && pHp - dmg <= 0 && Array.isArray(options.playerActiveEffects)
              && options.playerActiveEffects.some(e => e && e.key === 'death_prevent_once' && effectIsActive(e, round))) {
            dmg = Math.max(0, pHp - 1);
            deathPreventUsed = true;
            log.push(`✨ **死亡迴避**！你保留了最後 1 HP！`);
          }
          _hurt(dmg);
          if (damageToHealAmount > 0) {
            pHp = _healPlayer(damageToHealAmount);
            log.push(`💗 受傷反饋！回復 **${damageToHealAmount}** HP！（你剩 ${Math.max(0, pHp)} HP）`);
          }
          // ── 戰意右：每次受擊累積 stack ──
          if (stackOnTakenValue > 0 && stackOnTakenStacks < stackOnTakenCap && dmg > 0) {
            stackOnTakenStacks = Math.min(stackOnTakenCap, stackOnTakenStacks + stackOnTakenValue);
            log.push(`🐉 **龍王戰意**：受擊疊加！減傷 **+${Math.min(95, stackOnTakenStacks)}%**（最高 +${Math.min(95, stackOnTakenCap)}%）`);
          }
          monsterDmgThisRound += dmg;
          lastMonsterDmg = dmg;
          const invincibleText = playerInvincible ? "（免疫傷害）" : (shieldAbsorbed > 0 ? `（護盾吸收 ${shieldAbsorbed}）` : "");
          log.push(`💥 ${mAtkNote}${mName} ${rand(mAtkPhrases)}，造成 **${dmg}** 點傷害${invincibleText}！（你剩 ${Math.max(0, pHp)} HP）`);
          // ── 反傷（thorns）──
          if (playerThornsPct > 0 && dmg > 0) {
            const thornsDmg = Math.max(1, Math.round(dmg * (playerThornsPct / 100)));
            mHp -= thornsDmg;
            totalDamage += thornsDmg;
            log.push(`🌵 **反傷**！${mName} 受到 **${thornsDmg}** 點反彈傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
            if (mHp <= 0) { outcome = "win"; }
          }
          // ── 玩家反彈（reflect_damage / 鏡映系戒指 / 龍蜥武士卡）──
          if (outcome === null && dmg > 0 && Array.isArray(options.playerActiveEffects)) {
            for (const rEff of options.playerActiveEffects) {
              if (!rEff || rEff.key !== 'reflect_damage') continue;
              const reflectPct = Math.max(0, Number(rEff.params?.value ?? 0));
              if (reflectPct <= 0) continue;
              const reflectDmg = Math.max(1, Math.round(dmg * (reflectPct / 100)));
              mHp -= reflectDmg;
              totalDamage += reflectDmg;
              log.push(`🪞 **反彈**！${mName} 受到 **${reflectDmg}** 點鏡映傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
              if (mHp <= 0) { outcome = "win"; break; }
            }
          }
          // ── 玩家反擊（counter_attack / 鏡映系戒指）──
          if (outcome === null && dmg > 0 && Array.isArray(options.playerActiveEffects)) {
            for (const cEff of options.playerActiveEffects) {
              if (!cEff || cEff.key !== 'counter_attack') continue;
              const counterChance = Math.max(0, Number(cEff.params?.value ?? 0));
              if (Math.random() * 100 >= counterChance) continue;
              const counterDmg = Math.max(1, Math.round((pStats.atk || 1) * 0.5)) + weaponMainBonus;
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
                mHp = Math.min(mHpInit, mHp + reduceMonsterHeal(healAmount));
                log.push(`💚 ${mName} 吸取生命力，恢復 **${healAmount}** HP！（${mName} 剩 ${mHp} HP）`);
              }
            }
          }

          if (pHp <= 0) { outcome = "lose"; break; }
        }
      } else {
        combatStats.dodgeCount += 1;
        log.push(`🛡️ ${mName} 猛撲而來，你${rand(jobFlavor.dodge)}，躲過了攻擊！`);

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
              ownerHpPct: pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100,
              targetHpPct: mHpInit > 0 ? (mHp / mHpInit) * 100 : 100,
              round, sourceType: 'player_card',
              cardName: dItem.itemName || dItem.name || '卡片',
              skillName: dSkill.name || '', skillDescription: dSkill.description || '',
              cooldownBucket: cardCooldowns.player, cooldownKey: dItem.itemId || dItem.id || dSlot,
              cooldownTurns: Number(dSkill.cooldownTurns) || 0,
              ownerActiveEffects: options.playerActiveEffects || [],
              targetActiveEffects: monsterActiveEffects,
              ownerLabel: playerBattleName, sourceAtk: pStats.atk || 1,
              ownerMaxHp: pStats.maxHp || pHp || 1, targetMaxHp: mHpInit || mHp || 1, targetLabel: mName,
              applyTargetDamage: (d) => { mHp -= d; totalDamage += Math.max(0, Number(d) || 0); return mHp; },
              applyOwnerHeal: (h) => { pHp = _healPlayer(h); return pHp; },
              buffKeys: PLAYER_CARD_OFFENSIVE_KEYS, debuffKeys: PLAYER_CARD_OFFENSIVE_KEYS,
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
            const counterDmg = Math.max(1, Math.round(rollDmg(applyDefense(counterBase, adjustedMCalc.flatDef || 0, finalDef, pStats.atk)) * (equipZoneFinalDmgMult * roundScaleMult(round)))) + weaponMainBonus;
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

    // ── 怪物連擊（AGI 驅動）── 簡化：觸發後同一次傷害再扣一次（× 2 效果）
    const monsterComboChance = adjustedMCalc.comboChance || 0;
    // 🐺 狼王：連擊由「連牙亂舞」段數機制負責(含迴避打斷)，關掉這套 AGI 額外連擊避免雙重連擊架空打斷
    if (monsterComboChance > 0 && !skipMonsterAttackReason && outcome === null && lastMonsterDmg > 0 && !_hellfangCombo) {
      if (Math.random() * 100 < monsterComboChance) {
        const comboDmg = lastMonsterDmg;
        _hurt(comboDmg);
        monsterDmgThisRound += comboDmg;
        log.push(`⚡ **${mName} 連擊**！再造成 **${comboDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
        if (pHp <= 0) { outcome = "lose"; }
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
          const counterDmg = Math.max(1, Math.round(monsterDmgThisRound * (counterDmgPct / 100)));
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
              const counterDmg = Math.max(1, Math.round(monsterDmgThisRound * (counterDmgPct / 100)));
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

    // ── 盾格擋反擊（單手劍+盾，必中）── 走獨立階級擲骰
    if (blockedThisRound && pStats.blockCounter && outcome === null) {
      const counterAtkTier = rollAttackTier(calcAttackTierProbs(pStats.dex || 0, pStats.luk || 0));
      // 大失敗 / 失敗 階級時，反擊也會出包
      if (counterAtkTier === 'critFail') {
        const selfBase = Math.max(1, Math.round((pStats.atk || 1) * playerAttackLevelMult));
        const selfDmg = Math.max(1, Math.round(selfBase * 0.3 * (0.7 + Math.random() * 0.3)));
        _hurt(selfDmg);
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
        if (adjustedMCalc.damageTakenMultiplier > 1) dmg = Math.max(1, Math.round(dmg * adjustedMCalc.damageTakenMultiplier));
        { const _ezm = equipZoneFinalDmgMult * roundScaleMult(round); if (_ezm !== 1) dmg = Math.max(1, Math.round(dmg * _ezm)); }

        let tierNote = "";
        if (counterAtkTier === 'great') tierNote = "⚡大成功 ";
        else if (counterAtkTier === 'perfect') tierNote = "🌟完美 ";

        mHp -= dmg;
        totalDamage += dmg;
        log.push(`⚔️✨ **${tierNote}盾反**！${rand(jobFlavor.counter)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
        if (mHp <= 0) { outcome = "win"; }
      }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // 副手追擊機制已移除（2026-05-26）

    // ── 玩家 HOT/life_regen 結算（每回合結束）──
    if (outcome === null && pHp > 0 && pHp < pStats.maxHp) {
      let totalHot = 0;
      if (playerHotPct > 0) totalHot += Math.round(pStats.maxHp * (playerHotPct / 100));
      if (playerHotFlat > 0) totalHot += Math.round(playerHotFlat);
      if (playerLifeRegenPct > 0 && playerLifeRegenInterval > 0 && (round % playerLifeRegenInterval === 0)) {
        totalHot += Math.round((pStats.maxHp || 0) * (playerLifeRegenPct / 100));
      }
      if (totalHot > 0) {
        const before = pHp;
        pHp = _healPlayer(totalHot);
        const actual = pHp - before;
        if (actual > 0) log.push(`💚 持續回復！回復 **${actual}** HP！（你剩 ${pHp} HP）`);
      }
    }

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
    pHp = _healPlayer(healAmt);
    const actual = pHp - before;
    if (actual > 0) roundLogs.push(`💖 **戰後回血**！回復 **${actual}** HP！（你剩 ${pHp} HP）`);
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
    healDone: _totalHealDone       // 聖人任務指標
  };
}

module.exports = { runCombatLoop };
