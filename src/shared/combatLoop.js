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
  const existingIndex = next.findIndex((entry) => (
    entry?.key === effectEntry.key &&
    (entry.source === effectEntry.source || entry.sourceType === effectEntry.sourceType)
  ));

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

function applyImmediateCardDamageEffect({
  procEffect,
  ownerLabel = "怪物",
  skillName = "卡片",
  skillDescription = "",
  targetLabel = "目標",
  sourceAtk = 1,
  targetMaxHp = 1,
  applyTargetDamage = null,
  log = []
}) {
  if (!procEffect || !IMMEDIATE_DAMAGE_EFFECT_KEYS.has(procEffect.key) || typeof applyTargetDamage !== "function") {
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
  const damage = params.mode === "flat"
    ? Math.max(1, Math.round(Number.isFinite(Number(params.value)) ? Number(params.value) : 1))
    : Math.max(1, Math.round(base * (pct / 100)));
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
  if (!procEffect || !IMMEDIATE_HEAL_EFFECT_KEYS.has(procEffect.key) || typeof applyTargetHeal !== "function") {
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

  if (!matchedEffects.some((effect) => IMMEDIATE_LOG_SUPPRESS_KEYS.has(effect.key))) {
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

  // 傷害浮動：min~1.3，INT 縮小下限
  const rollDmg = (base) => {
    const roll = pStats.dmgMin + Math.random() * (pStats.dmgMax - pStats.dmgMin);
    return Math.max(1, Math.round(base * roll));
  };
  // 怪物攻擊固定 0.8~1.2 浮動
  const rollMDmg = (base) => Math.max(1, Math.round(base * (0.8 + Math.random() * 0.4)));

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

  let mHp = mHpInit;
  let pHp = pStats.maxHp;
  let outcome = null;
  let totalDamage = 0;
  let round = 1;
  let stunRoundsLeft = 0; // 怪物剩餘擊暈回合數
  let monsterActiveEffects = []; // 怪物的 active effects（Buff/Debuff）
  let warriorLowHpTriggered = false; // 戰士低血量加成只提示一次
  const lowHpTriggerText = pStats.hasWarriorBadge
    ? "⚔️ 戰士低血量加成觸發！"
    : "⚡ 低血量觸發！";
  const cardCooldowns = { player: {}, monster: {} };
  const combatStats = {
    comboCount: 0,
    dodgeCount: 0,
    blockCount: 0,
    stunCount: 0,
    burnTriggerCount: 0
  };

  const roundLogs = [];
  const tierDamageMultiplier = Math.max(0.1, Number(pStats.tierDamageMultiplier) || 1);
  const tierFinalDamageMultiplier = Math.max(0.1, Number(pStats.tierFinalDamageMultiplier) || 1);
  const tierBossDamageMultiplier = options.monsterIsBoss ? Math.max(0.1, Number(pStats.tierBossDamageMultiplier) || 1) : 1;
  const tierCritDamageMultiplier = Math.max(0.1, Number(pStats.tierCritDamageMultiplier) || 1);

  while (round <= MAX_ROUNDS && outcome === null) {
    const log = [`**【第 ${round} 回合】**`];
    for (const bucket of Object.values(cardCooldowns)) {
      for (const key of Object.keys(bucket)) {
        bucket[key] = Math.max(0, Number(bucket[key] || 0) - 1);
      }
    }
    if (round === 1 && jobProfile.jobName) {
      log.push(`✨ ${jobProfile.jobName} ${rand(jobFlavor.intro)}`);
      // 職業配武器效果提示（只顯示本場實際生效的）
      const wt = pStats.weaponType || "";
      const jobHints = [];
      if (pStats.hasMageBadge && wt.startsWith("staff")) {
        const tier = wt === "staff_2h" ? "屬性攻擊(中)" : "屬性攻擊(小)";
        jobHints.push(`🔮 **(法師)** ${tier}：法杖傷害提升，命中後有機率觸發燒傷/麻痺/冰凍`);
      }
      if (pStats.hasArcherBadge && wt === "bow") {
        jobHints.push(`🏹 **(弓箭手)** 命中要害(中)：弓傷害提升，命中要害機制啟動`);
      }
      if (pStats.hasWarriorBadge && wt === "axe_1h") {
        jobHints.push(`🪓 **(戰士)** 單手斧強化：HP 50% 以下觸發傷害加成，命中後有機率觸發破甲（降低敵方 DEF）`);
      }
      if (pStats.hasWarriorBadge && wt === "axe_2h") {
        jobHints.push(`🪓 **(戰士)** 雙手斧強化：HP 50% 以下觸發傷害加成、爆擊傷害提升，命中後有機率觸發破甲`);
      }
      if (pStats.hasDwarfWarriorBadge && wt && wt.startsWith("mace")) {
        const tier = wt === "mace_2h" ? "擊暈(中)" : "擊暈(小)";
        const stunDetail = wt === "mace_2h"
          ? "基礎擊暈 30%，HP 60% 以上再 +10%，對暈眩目標增傷 +25%"
          : "基礎擊暈 20%，HP 60% 以上再 +10%，對暈眩目標增傷 +15%";
        jobHints.push(`🔨 **(矮人戰士)** ${tier}：${stunDetail}${wt === "mace_2h" ? "，命中後有機率額外擊暈" : ""}`);
      }
      if (pStats.hasRogueBadge && wt === "dagger") {
        jobHints.push(`🗡️ **(盜賊)** 中毒(小)＋連擊強化：命中後有機率中毒疊加，連擊傷害提升`);
      }
      if (pStats.hasSwordsmanBadge && wt === "sword_1h" && pStats.blockChance > 0) {
        jobHints.push(`⚔️ **(劍士)** 盾反強化(小)：格擋反擊命中率與爆擊率提升`);
      }
      if (pStats.hasHealerBadge) {
        if (wt === "staff_1h") jobHints.push(`💚 **(治療師)** 回血(小)＋輸出提升：單手杖傷害提升，每回合自我回血`);
        else if (wt === "staff_2h") jobHints.push(`💚 **(治療師)** 回血(小)＋輸出提升(中)：雙手杖傷害提升，每回合自我回血`);
        else jobHints.push(`💚 **(治療師)** 回血(小)：每回合自我回血`);
      }
      for (const hint of jobHints) log.push(hint);
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
          const heal = mode === 'pct' ? Math.max(0, Math.round(mHpInit * (val / 100))) : Math.max(0, Math.round(val));
          if (heal > 0) {
            mHp = Math.min(mHpInit, mHp + heal);
            log.push(`💚 ${mName} 生命力逐漸恢復，回復 **${heal}** HP！（${mName} 剩 ${mHp} HP）`);
          }
        }
      }
    }

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
          mHp -= burnDmg;
          totalDamage += burnDmg;
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
          mHp -= poisonDmg;
          totalDamage += poisonDmg;
          log.push(`☠️ 中毒持續！${mName} 受到 **${poisonDmg}** 點毒素傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }

        // 冰凍：此回合怪物無法攻擊（一次性，appliedAt 回合消耗）
        if (mEff.key === 'freeze') {
          if (round === (mEff.appliedAt || round)) {
            monsterFrozenThisRound = true;
          }
        }

        // 擊暈（卡片觸發）：設定 stunRoundsLeft
        if (mEff.key === 'stun') {
          const stunTurns = Number(mParams.duration?.value ?? 1);
          // appliedAt 回合起持續 stunTurns 回合
          const stunEnd = (mEff.appliedAt || 1) + stunTurns;
          if (round <= stunEnd && stunRoundsLeft < stunTurns) {
            stunRoundsLeft = Math.max(stunRoundsLeft, stunEnd - round + 1);
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
          mHp -= bleedDmg;
          totalDamage += bleedDmg;
          log.push(`🩸 流血持續！${mName} 受到 **${bleedDmg}** 點流血傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
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
          mHp -= curseDmg;
          totalDamage += curseDmg;
          log.push(`🌑 詛咒持續！${mName} 受到 **${curseDmg}** 點詛咒傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
          if (mHp <= 0) { outcome = "win"; break; }
        }
      }
    }
    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 應用玩家的 DOT 效果（如中毒） ──
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
            pHp = Math.min(pStats.maxHp, pHp + heal);
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
          pHp -= dotDmg;
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
          pHp -= bleedDmg;
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
          pHp -= burnDmg;
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
          pHp -= lightDmg;
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
          pHp -= shockDmg;
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
          pHp -= curseDmg;
          log.push(`🌑 詛咒傷害！你受到 **${curseDmg}** 點詛咒傷害！（你剩 ${Math.max(0, pHp)} HP）`);
          if (pHp <= 0) { outcome = "lose"; break; }
        }
      }
    }

    // ── 套用來自隊伍（party）的被動 aura，例如治療師提供的每回合回復 ──
    let roundDmgMultiplier = 1; // 每回合重置，累積本回合所有 party_damage_up
    try {
      const partyEffects = Array.isArray(options.partyEffects) ? options.partyEffects : [];
      const healerAuraDetails = new Map(); // 依 sourceName 分組光環效果

      for (const pe of partyEffects) {
        if (!pe || !pe.key) continue;
        const sourceName = pe.sourceName || "未知";
        if (!healerAuraDetails.has(sourceName)) {
          healerAuraDetails.set(sourceName, { heal: 0, dmgBoost: 0 });
        }

        // 支援治療 over-time 的簡單實作：key 可為 'heal_over_time' 或自訂 'party_heal'
        if (pe.key === 'heal_over_time' || pe.key === 'party_heal') {
          const mode = String(pe.params?.mode || '').toLowerCase();
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (!Number.isFinite(val) || val === 0) continue;
          const heal = mode === 'pct' ? Math.max(0, Math.round((pStats.maxHp || 0) * (val / 100))) : Math.max(0, Math.round(val));
          if (heal > 0) {
            pHp = Math.min(pStats.maxHp, pHp + heal);
            const detail = healerAuraDetails.get(sourceName);
            detail.heal = heal;
          }
        }
        // 支援隊伍傷害加成（每回合生效）
        if (pe.key === 'party_damage_up') {
          const val = Number(pe.params?.value ?? pe.value ?? 0);
          if (Number.isFinite(val) && val !== 0) {
            roundDmgMultiplier *= (1 + val / 100);
            const detail = healerAuraDetails.get(sourceName);
            detail.dmgBoost = val;
          }
        }
      }

      // 輸出合併的光環效果
      for (const [sourceName, detail] of healerAuraDetails) {
        if (detail.heal > 0 || detail.dmgBoost !== 0) {
          const healerTag = sourceName !== "未知" ? `（${sourceName}）` : "";
          const parts = [];
          if (detail.heal > 0) parts.push(`回復 **${detail.heal}** HP`);
          if (detail.dmgBoost !== 0) parts.push(`傷害提升 ${detail.dmgBoost}%`);
          log.push(`💚 **(治療師)** 光環${healerTag} ${parts.join("、")}`);
        }
      }
    } catch (e) {}

    // ── 治療師自我回血（每回合 3% 最大 HP） ──
    if (pStats.hasHealerBadge) {
      const selfHeal = Math.max(1, Math.round(pStats.maxHp * 0.03));
      if (pHp < pStats.maxHp) {
        pHp = Math.min(pStats.maxHp, pHp + selfHeal);
        log.push(`💚 **(治療師)** 自我回復 **${selfHeal}** HP`);
      }
    }

    const monsterIsStunned = stunRoundsLeft > 0;

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
            applyTargetDamage: (damage) => { pHp -= damage; return pHp; },
            applyOwnerHeal: (heal) => { mHp = Math.min(mHpInit, mHp + heal); return mHp; },
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
            applyTargetDamage: (damage) => { pHp -= damage; },
            log
          })) {
            appliedAnyNormalProc = true;
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
            applyTargetHeal: (heal) => { mHp = Math.min(mHpInit, mHp + heal); return mHp; },
            log
          })) {
            appliedAnyNormalProc = true;
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
        if (appliedAnyNormalProc) {
          log.push(`🎴 **${mName}** 發動【${skill.name || cardName}】！${skill.description ? skill.description : ''}`);
        }
      }
    }

    // ── 世界王雷擊術（第二 / 第三階段）──
    if (worldBossHasLightning) {
      if (Math.random() * 100 < worldBossLightningHitChance) {
        const lightningDmg = Math.max(1, Math.round(Math.max(1, pStats.maxHp || pHp) * (worldBossLightningHpPct / 100)));
        pHp -= lightningDmg;
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
    const attackCount = pStats.isDualWield ? 2 : 1;
    // 擊暈中：怪物無法閃避

    // ── 檢查玩家受到的狀態效果（怪物施加的 debuff）──
    let playerIsStunned = false;
    let playerIsFrozen = false;
    let playerIsSilenced = false;
    if (Array.isArray(options.playerActiveEffects)) {
      for (const pEff of options.playerActiveEffects) {
        if (!pEff || !pEff.key) continue;
        const pDur = pEff.params?.duration || {};
        if (pDur.mode === 'turns') {
          const pEnd = (pEff.appliedAt || 1) + (pDur.value || 1);
          if (round > pEnd) continue;
        }
        // stun：value 為觸發機率（40% = 40），每回合重新判定
        if (pEff.key === 'stun') {
          const stunChance = Number(pEff.params?.value ?? 100);
          if (Math.random() * 100 < stunChance) playerIsStunned = true;
        }
        // freeze：攻速 -50% → 每 2 回合跳過 1 次攻擊（偶數回合才攻擊）
        if (pEff.key === 'freeze') {
          if (round % 2 !== 0) playerIsFrozen = true;
        }
        if (pEff.key === 'silence') playerIsSilenced = true;
      }
    }
    if (playerIsStunned) {
      log.push(`😵 **擊暈**！你無法行動，此回合無法攻擊！`);
    } else if (playerIsFrozen) {
      log.push(`🧊 **冰凍**！行動遲緩，此回合無法攻擊！`);
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
      if (!playerIsSilenced && slotItem && slotItem.monsterCardSkill && slotItem.monsterCardSkill.key) {
        const skill = slotItem.monsterCardSkill;
        const cardName = slotItem.itemName || slotItem.name || '卡片';
        const playerHpPct = pStats.maxHp > 0 ? (pHp / pStats.maxHp) * 100 : 100;
        const monsterHpPct = mHpInit > 0 ? (mHp / mHpInit) * 100 : 100;

        const cooldownKey = slotItem.itemId || slotItem.id || `${slot}:${cardName}`;
        const triggerChance = Math.min(100, Math.max(0, Number(skill.chance ?? slotItem.cardProcChance ?? 5)));
        const procEffects = Array.isArray(skill.procEffects) ? skill.procEffects : [];
        const hpGatedEffects = procEffects.filter(effectHasHpThreshold);
        const normalProcEffects = hpGatedEffects.length > 0 ? procEffects.filter((effect) => !effectHasHpThreshold(effect)) : procEffects;

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
            applyTargetDamage: (damage) => { mHp -= damage; return mHp; },
            applyOwnerHeal: (heal) => { pHp = Math.min(pStats.maxHp, pHp + heal); return pHp; },
            buffKeys: PLAYER_CARD_OFFENSIVE_KEYS,
            debuffKeys: PLAYER_CARD_OFFENSIVE_KEYS,
            sourceId: slotItem.uuid || slotItem.itemId || slotItem.id || cardName,
            log
          });
          options.playerActiveEffects = result.ownerActiveEffects;
          monsterActiveEffects = result.targetActiveEffects;
        }

      if (normalProcEffects.length > 0 && (cardCooldowns.player[cooldownKey] || 0) <= 0 && Math.random() * 100 < triggerChance) {
        if (Number(skill.cooldownTurns) > 0) cardCooldowns.player[cooldownKey] = Number(skill.cooldownTurns);
        const shouldShowGenericSkillLine = !normalProcEffects.some((effect) => IMMEDIATE_LOG_SUPPRESS_KEYS.has(effect?.key));
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
            applyTargetDamage: (damage) => { mHp -= damage; },
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
            applyTargetHeal: (heal) => { pHp = Math.min(pStats.maxHp, pHp + heal); return pHp; },
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
          } else {
            if (!options.playerActiveEffects) options.playerActiveEffects = [];
            options.playerActiveEffects = addOrStackCardEffect(options.playerActiveEffects, effectEntry);
            appliedAnyNormalProc = true;
          }
        }
        if (shouldShowGenericSkillLine && appliedAnyNormalProc) {
          log.push(`🎴 **${playerBattleName}** 發動【${skill.name || cardName}】！${skill.description ? skill.description : ''}`);
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
    let playerHitPenalty = 0;
    let playerDefIgnorePct = 0;
    let playerDamageReductionPct = 0;
    let playerFinalDamageMultiplier = 1;
    let playerInvincible = false;
    let playerBonusVsPoisonedPct = 0;
    let playerBonusVsDebuffedPct = 0;
    let playerHitBonus = 0;
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
        }
      }
    }

    for (let a = 0; a < attackCount && outcome === null && !playerIsStunned && !playerIsFrozen; a++) {
      const hitChance = (pStats.hit + playerHitBonus - playerHitPenalty) - adjustedMCalc.dodge;
      if (monsterIsStunned || Math.random() * 100 < hitChance) {
        // 破防判定（斧）
        const isBreak = Math.random() * 100 < pStats.armorBreakChance;
        const effectiveDef = isBreak ? 0 : adjustedMCalc.def;
        // 法杖無視怪物 DEF 的 bypassMonsterDefPct%（預設0，法杖50）
        const bypassPct = pStats.bypassMonsterDefPct ?? 0;
        const combinedBypassPct = Math.min(100, Math.max(0, bypassPct + playerDefIgnorePct));
        const finalDef = Math.max(0, effectiveDef * (1 - combinedBypassPct / 100));

        let conditionalBonusMultiplier = 1;
        if (playerBonusVsPoisonedPct > 0 && monsterActiveEffects.some(e => e.key === 'poison' && effectIsActive(e, round))) {
          conditionalBonusMultiplier *= (1 + playerBonusVsPoisonedPct / 100);
        }
        if (playerBonusVsDebuffedPct > 0 && hasAnyDebuff(monsterActiveEffects, round)) {
          conditionalBonusMultiplier *= (1 + playerBonusVsDebuffedPct / 100);
        }
        if (pStats.hasDwarfWarriorBadge && pStats.weaponType && pStats.weaponType.startsWith("mace")) {
          const monsterIsStunned = Array.isArray(monsterActiveEffects) && monsterActiveEffects.some((e) => e && e.key === 'stun' && effectIsActive(e, round));
          if (monsterIsStunned && Number.isFinite(Number(pStats.dwarfWarriorBonusVsStunnedPct)) && Number(pStats.dwarfWarriorBonusVsStunnedPct) > 0) {
            conditionalBonusMultiplier *= (1 + Number(pStats.dwarfWarriorBonusVsStunnedPct) / 100);
          }
        }
        const attackBase = Math.max(
          1,
          Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * playerFinalDamageMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier * conditionalBonusMultiplier)
        );
        let dmg = rollDmg(Math.max(1, Math.round(attackBase * (1 - finalDef / 100))));

        // 職業傷害倍率
        // 弓箭手：弓傷害 ×1.2
        if (pStats.hasArcherBadge && pStats.weaponType === "bow") {
          dmg = Math.round(dmg * pStats.archerBowDamageBoost);
        }

        // 法師：法杖傷害 ×1.15
        if (pStats.hasMageBadge && pStats.weaponType && pStats.weaponType.startsWith("staff")) {
          dmg = Math.round(dmg * pStats.mageDamageMultiplier);
        }

        // --- Compute on_high_hp bonuses (per-effect threshold) early so they affect crit checks ---
        let extraHighHpCrit = 0;
        let extraHighHpStun = 0;
        try {
          const equippedCtx = options.equipped || null;
          if (equippedCtx) {
            const highEffects = collectEquipmentEffects(equippedCtx, 'on_high_hp', { equipped: equippedCtx, inventory: options.inventory || [] });
            for (const he of highEffects) {
              if (!he || !he.params) continue;
              const thresholdPct = Number.isFinite(Number(he.params.thresholdPct)) ? Number(he.params.thresholdPct) : 90;
              if (pHp >= Math.ceil((pStats.maxHp || 1) * (thresholdPct / 100))) {
                if (he.key === 'stun_chance_up' && Number.isFinite(Number(he.params.value))) {
                  extraHighHpStun += Number(he.params.value);
                }
                if (he.key === 'crit_rate_up' && Number.isFinite(Number(he.params.value))) {
                  extraHighHpCrit += Number(he.params.value);
                }
              }
            }
          }
        } catch (e) {}

        // Crit check：獨立判斷普通爆擊和弓箭手命中要害（可同時發生 - 疊加機制）
        let isCrit = false;
        let isArcherCrit = false;

        if (pStats.hasArcherBadge && pStats.weaponType === "bow") {
          dmg = Math.round(dmg * pStats.archerBowDamageBoost);
        }
        if (pStats.hasMageBadge && pStats.weaponType?.startsWith("staff")) {
          dmg = Math.round(dmg * (pStats.mageDamageMultiplier || 1.15));
        }

        // 低血量傷害加成（若 equipped 傳入且玩家 HP <= 50%）
        try {
          const equipped = options.equipped || null;
          if (equipped && pHp <= Math.floor((pStats.maxHp || 1) * 0.50)) {
            const lowHpEffects = collectEquipmentEffects(equipped, 'on_low_hp', { equipped, inventory: options.inventory || [] });
            for (const eff of lowHpEffects) {
              if (!eff || !eff.params) continue;
              if (eff.key === 'final_damage_up' && Number.isFinite(Number(eff.params.value))) {
                if (!warriorLowHpTriggered) {
                  log.push(lowHpTriggerText);
                  warriorLowHpTriggered = true;
                }
                dmg = Math.max(1, Math.round(dmg * Number(eff.params.value)));
              }
            }
          }
        } catch (e) {}

        let wasBlocked = false;
        let blockNote = "";
        if (adjustedMCalc.blockChance > 0 && Math.random() * 100 < adjustedMCalc.blockChance) {
          wasBlocked = true;
          blockNote = `，但 ${mName} ${rand(BLOCK_PHRASES)}`;
        }

        // 先記住「未爆擊」的傷害，格擋穿防時會回退到這個值
        const nonCritDamageBase = dmg;

        // 爆擊與要害
        const effectiveCrit = Math.min(100, (pStats.crit || 0) + playerCritRateBonus);
        isCrit = Math.random() * 100 < effectiveCrit;
        isArcherCrit = false;
        if (pStats.hasArcherBadge && pStats.weaponType === "bow" && pStats.archerCritRate > 0) {
          isArcherCrit = Math.random() * 100 < pStats.archerCritRate;
        }

        let finalDamage = dmg;
        if (isCrit) {
          const critBase = attackBase;
          const critMultiplier = (2.5 * playerCritDamageMultiplier * tierCritDamageMultiplier) + (pStats.warriorCritDamageBonus || 0);
          finalDamage = Math.round(rollDmg(Math.max(1, critBase)) * critMultiplier);
          if (pStats.hasArcherBadge && pStats.weaponType === "bow") {
            finalDamage = Math.round(finalDamage * pStats.archerBowDamageBoost);
          }
        }
        if (isArcherCrit) {
          finalDamage = Math.round(finalDamage * (pStats.archerCritMultiplier || 1.5));
        }

        if (wasBlocked) {
          if (isCrit || isArcherCrit) {
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
        if (monsterActiveEffects.some(e => e.key === 'invincible_short' && effectIsActive(e, round))) {
          finalDamage = 0;
        }

        dmg = finalDamage;

        mHp -= dmg;
        totalDamage += dmg;
        const breakNote = isBreak ? "💥**破防**！" : "";
        let critNote = "";

        // 顯示爆擊和要害的組合
        if (isCrit && isArcherCrit) {
          // 同時觸發爆擊和要害
          critNote = `✨${rand(critPhrases)}！🎯**(弓箭手)** ${rand(['命中要害', '精準破綻', '弱點命中'])}！`;
        } else if (isArcherCrit) {
          // 只觸發要害
          critNote = `🎯**(弓箭手)** **${rand(['命中要害', '精準破綻', '弱點命中', '一擊斃命'])}**！`;
        } else if (isCrit) {
          // 只觸發爆擊
          if (pStats.hasWarriorBadge && pStats.weaponType === "axe_2h" && Number(pStats.warriorCritDamageBonus || 0) > 0) {
            critNote = `✨**${rand(critPhrases)}**！🔥**(戰士)** **暴擊增傷**！`;
          } else {
            critNote = `✨**${rand(critPhrases)}**！`;
          }
        }

        log.push(`⚔️ ${critNote}${breakNote}${rand(jobFlavor.hit)}，${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

        // ── 玩家吸血效果（來自卡片技能）──
        if (playerLifestealPct > 0) {
          const healAmt = Math.max(1, Math.round(dmg * (playerLifestealPct / 100)));
          pHp = Math.min(pStats.maxHp, pHp + healAmt);
          log.push(`💚 吸取生命力！恢復 **${healAmt}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
        }
        // ── 強力吸血效果（林地妖靈卡）──
        if (playerLifestealStrongPct > 0) {
          const sHeal = Math.max(1, Math.round(dmg * (playerLifestealStrongPct / 100)));
          pHp = Math.min(pStats.maxHp, pHp + sHeal);
          log.push(`💜 強力吸血！恢復 **${sHeal}** HP（你剩 ${pHp} / ${pStats.maxHp}）`);
        }

        // ── 檢查怪物反彈傷害效果 ──
        if (Array.isArray(monsterActiveEffects)) {
          for (const reflectEff of monsterActiveEffects) {
            if (reflectEff && reflectEff.key === 'reflect_damage') {
              const reflectParams = reflectEff.params || {};
              const reflectPercent = Number(reflectParams.reflectPercent ?? reflectParams.value ?? 50);
              const reflectDmg = Math.max(1, Math.round(dmg * (reflectPercent / 100)));
              pHp -= reflectDmg;
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
              pHp -= counterDmg;
              log.push(`🦀 ${mName} **反擊**！以受到傷害的 ${counterDmgPct}% 回擊，造成 **${counterDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
              if (pHp <= 0) { outcome = "lose"; }
            }
            break; // 只處理第一個 counter 效果
          }
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
          stunRoundsLeft = 3;
          combatStats.stunCount += 1;
          log.push(`😵 ${mName} ${rand(stunPhrases)}！接下來 3 回合無法攻擊！`);
        }

        // 戰士：破甲（斧類命中後 25% 機率，DEF 降低 30%，持續 2 回合）
        if (pStats.hasWarriorBadge && pStats.weaponType && pStats.weaponType.startsWith("axe")) {
          if (Math.random() * 100 < 25) {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'def_down',
              params: { value: 30, duration: { mode: 'turns', value: 2 } },
              appliedAt: round,
              sourceType: 'job_proc',
              sourceId: 'warrior:armor_break'
            });
            log.push(`🪓 **(戰士)** **破甲**！${mName} 防禦降低 30%，持續 2 回合！`);
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

        // ── 職業徽章 on_hit proc（全部硬寫，確保觸發）──

        // 法師：命中後各 20% 觸發燒傷 / 麻痺 / 冰凍（需法杖）
        if (pStats.hasMageBadge && wt && wt.startsWith("staff")) {
          if (Math.random() * 100 < 20) {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'burn',
              params: { value: 0.5, mode: 'pct', duration: { mode: 'turns', value: 3 } },
              appliedAt: round,
              sourceType: 'job_proc',
              sourceId: 'mage:burn'
            });
            combatStats.burnTriggerCount += 1;
            log.push(`🔥 **(法師)** **燒傷**！${mName} 陷入燃燒狀態，持續 3 回合！`);
          }
          if (Math.random() * 100 < 20) {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'hit_rate_down',
              params: { value: 30, duration: { mode: 'turns', value: 3 } },
              appliedAt: round,
              sourceType: 'job_proc',
              sourceId: 'mage:paralysis'
            });
            log.push(`⚡ **(法師)** **麻痺**！${mName} 行動遲緩，命中率下降，持續 3 回合！`);
          }
          const recentFreeze = monsterActiveEffects.find(e => e.key === 'freeze' && e.appliedAt >= round - 1);
          if (!recentFreeze && Math.random() * 100 < 20) {
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'freeze',
              params: { duration: { mode: 'turns', value: 1 }, bossImmune: true },
              appliedAt: round + 1,
              sourceType: 'job_proc',
              sourceId: 'mage:freeze'
            });
            log.push(`🧊 **(法師)** **冰凍**！${mName} 被凍結，下回合無法攻擊！`);
          }
        }

        // 盜賊：命中後 40% 觸發中毒（需匕首），DEX 加深毒量，可疊加上限 3.5%
        if (pStats.hasRogueBadge && wt === "dagger") {
          if (Math.random() * 100 < 40) {
            const poisonSourceId = 'rogue:poison';
            const existing = monsterActiveEffects.find((e) => e.key === 'poison' && e.sourceId === poisonSourceId);
            const prevPct = existing ? Number(existing.params?.value ?? 0) : 0;
            const dexBonus = existing ? 0 : Number(pStats.dex ?? 0) * 0.02;
            const nextPctRaw = Math.min(3.5, prevPct + (existing ? 1 : 0.5) + dexBonus);
            const nextPct = Math.ceil(nextPctRaw * 10) / 10;
            monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
              key: 'poison',
              params: { value: nextPct, mode: 'pct', duration: { mode: 'turns', value: 5 } },
              appliedAt: round,
              sourceType: 'job_proc',
              sourceId: poisonSourceId
            });
            if (existing) {
              log.push(`☠️ **(盜賊)** **中毒加深**！${mName} 毒性增強至每回合 ${nextPct}% HP 傷害！`);
            } else {
              log.push(`☠️ **(盜賊)** **中毒**！${mName} 陷入中毒狀態，每回合損失 ${nextPct}% HP！（DEX: +${dexBonus.toFixed(2)}%）`);
            }
          }
        }

        // 連擊（匕首+20%，AGI驅動）
        // 盜賊：連擊機率加成（+30%）
        let comboChance = pStats.combo;
        if (pStats.hasRogueBadge && pStats.weaponType === "dagger") {
          comboChance = Math.min(80, comboChance + 30);
        }

        if (Math.random() * 100 < comboChance) {
          combatStats.comboCount += 1;
          const comboBase = Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * playerFinalDamageMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier * conditionalBonusMultiplier * (1 - finalDef / 100)));
          let cdmg = Math.max(1, Math.round(rollDmg(comboBase) * (pStats.comboDamageMultiplier || 1)));

          // 盜賊：連擊傷害倍率加成（×1.3）
          if (pStats.hasRogueBadge && pStats.weaponType === "dagger") {
            cdmg = Math.round(cdmg * 1.3);
          }

          try {
            const equipped = options.equipped || null;
            if (equipped && pHp <= Math.floor((pStats.maxHp || 1) * 0.50)) {
              const lowHpEffects = collectEquipmentEffects(equipped, 'on_low_hp', { equipped, inventory: options.inventory || [] });
              for (const eff of lowHpEffects) {
                if (!eff || !eff.params) continue;
                if (eff.key === 'final_damage_up' && Number.isFinite(Number(eff.params.value))) {
                  if (!warriorLowHpTriggered) {
                    log.push(lowHpTriggerText);
                    warriorLowHpTriggered = true;
                  }
                  cdmg = Math.max(1, Math.round(cdmg * Number(eff.params.value)));
                }
              }
            }
          } catch (e) {}
          mHp -= cdmg;
          totalDamage += cdmg;
          log.push(`⚡ **${rand(jobFlavor.combo)}** 追加攻擊造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

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
        }
      } else {
        log.push(`💨 ${mName} ${rand(jobFlavor.dodge)}，你的攻擊落空了！`);
      }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 怪物攻擊 ──
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
    for (let ma = 0; ma < monsterAttackCount && outcome === null; ma++) {
      const monsterHitChance = adjustedMCalc.hit - (pStats.dodge + playerDodgeBonus);
      if (Math.random() * 100 < monsterHitChance) {
        // 盾格擋判定
        if (Math.random() * 100 < pStats.blockChance) {
          blockedThisRound = true;
          combatStats.blockCount += 1;
          log.push(`🛡️ ${rand(jobFlavor.block)}！${mName} 的攻擊被格擋，傷害降至 **1**！`);
          pHp -= 1;
          if (pHp <= 0) { outcome = "lose"; break; }
        } else {
          const monsterDefIgnorePct = Math.min(100, Math.max(0, Number(adjustedMCalc.defIgnorePct || 0)));
          const effectivePlayerDef = Math.min(95, Math.max(0, ((pStats.def * (1 + playerDefBonusPct / 100) * (1 - playerDefDownPct / 100)) + playerDefFlatBonus) * (1 - monsterDefIgnorePct / 100)));
          let dmg = playerInvincible
            ? 0
            : rollMDmg(Math.max(1, Math.round(adjustedMCalc.atk * (adjustedMCalc.finalDamageMultiplier || 1) * (1 - effectivePlayerDef / 100))));
          if (!playerInvincible && playerDamageReductionPct > 0) {
            dmg = Math.max(1, Math.round(dmg * (1 - Math.min(95, playerDamageReductionPct) / 100)));
          }

          // ── 檢查怪物的要害率 ──
          let hasWeaknessCrit = false;
          let weaknessCritRate = 0;
          if (Array.isArray(monsterActiveEffects)) {
            for (const wEff of monsterActiveEffects) {
              if (wEff && wEff.key === 'weakness_hit_rate') {
                const wParams = wEff.params || {};
                weaknessCritRate += Number(wParams.value || 0);
              }
            }
          }
          if (weaknessCritRate > 0 && Math.random() * 100 < weaknessCritRate) {
            hasWeaknessCrit = true;
            dmg = Math.round(dmg * 1.5);
          }

          // ── 檢查怪物的爆擊率（基礎值來自 LUK，可疊加 buff）──
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
          if (monsterCritRate > 0 && Math.random() * 100 < monsterCritRate) {
            hasMonsterCrit = true;
            dmg = Math.round(dmg * (2.5 * (adjustedMCalc.critDamageMultiplier || 1)));
          }

          // 構建傷害敘述
          let mAtkNote = "";
          if (hasWeaknessCrit && hasMonsterCrit) {
            mAtkNote = "🎯✨**要害爆擊**！";
          } else if (hasWeaknessCrit) {
            mAtkNote = "🎯**要害命中**！";
          } else if (hasMonsterCrit) {
            mAtkNote = "✨**會心一擊**！";
          }

          pHp -= dmg;
          monsterDmgThisRound += dmg;
          const invincibleText = playerInvincible ? "（免疫傷害）" : "";
          log.push(`💥 ${mAtkNote}${mName} ${rand(mAtkPhrases)}，造成 **${dmg}** 點傷害${invincibleText}！（你剩 ${Math.max(0, pHp)} HP）`);

          // ── 檢查怪物吸血效果 ──
          if (Array.isArray(monsterActiveEffects)) {
            for (const lifeEff of monsterActiveEffects) {
              if (lifeEff && lifeEff.key === 'lifesteal') {
                const lifeParams = lifeEff.params || {};
                const lifePercent = Number(lifeParams.value || 0);
                const healAmount = Math.max(1, Math.round(dmg * (lifePercent / 100)));
                mHp = Math.min(mHpInit, mHp + healAmount);
                log.push(`💚 ${mName} 吸取生命力，恢復 **${healAmount}** HP！（${mName} 剩 ${mHp} HP）`);
              }
            }
          }

          if (pHp <= 0) { outcome = "lose"; break; }
        }
      } else {
        combatStats.dodgeCount += 1;
        log.push(`🛡️ ${mName} 猛撲而來，你${rand(jobFlavor.dodge)}，躲過了攻擊！`);

        // 弓：閃躲後追擊
        if (pStats.weaponType === 'bow' && outcome === null) {
          const isBreak = Math.random() * 100 < pStats.armorBreakChance;
          const finalDef = isBreak ? 0 : adjustedMCalc.def;
          let cdmg = rollDmg(Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier * (1 - finalDef / 100))));

          // 應用弓的傷害倍率（1.2）
          cdmg = Math.round(cdmg * (pStats.archerBowDamageBoost || 1.2));

          // 檢查追擊要害（獨立判定）
          const hasCounterCrit = Math.random() * 100 < (pStats.bowDodgeCounterCritRate || 5);
          if (hasCounterCrit) {
            const counterCritMultiplier = pStats.bowDodgeCounterCritMultiplier || 1.2;
            cdmg = Math.round(cdmg * counterCritMultiplier);
          }

          mHp -= cdmg;
          totalDamage += cdmg;
          const archerTag = pStats.hasArcherBadge ? " **(弓箭手)**" : "";
          const critMarker = hasCounterCrit ? '🎯 **命中要害**！' : '';
          log.push(`🏹 **閃躲後追擊**${archerTag}！${rand(jobFlavor.counter)}，${critMarker}對 ${mName} 造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);

          if (mHp <= 0) { outcome = "win"; }
        }
      }
    }

    // ── 怪物連擊（AGI 驅動，同玩家公式：3 + AGI×0.5）──
    const monsterComboChance = adjustedMCalc.comboChance || 0;
    if (monsterComboChance > 0 && !skipMonsterAttackReason && outcome === null) {
      if (Math.random() * 100 < monsterComboChance) {
        const monsterDefIgnorePctC = Math.min(100, Math.max(0, Number(adjustedMCalc.defIgnorePct || 0)));
        const effectivePlayerDefC = Math.min(95, Math.max(0, ((pStats.def * (1 + playerDefBonusPct / 100) * (1 - playerDefDownPct / 100)) + playerDefFlatBonus) * (1 - monsterDefIgnorePctC / 100)));
        let comboDmg = playerInvincible
          ? 0
          : rollMDmg(Math.max(1, Math.round(adjustedMCalc.atk * (adjustedMCalc.finalDamageMultiplier || 1) * (1 - effectivePlayerDefC / 100))));
        if (!playerInvincible && playerDamageReductionPct > 0) {
          comboDmg = Math.max(1, Math.round(comboDmg * (1 - Math.min(95, playerDamageReductionPct) / 100)));
        }
        pHp -= comboDmg;
        monsterDmgThisRound += comboDmg;
        log.push(`⚡ **${mName} 連擊**！追加攻擊造成 **${comboDmg}** 點傷害！（你剩 ${Math.max(0, pHp)} HP）`);
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

    // ── 盾格擋反擊（單手劍+盾，必中）──
    if (blockedThisRound && pStats.blockCounter && outcome === null) {
      const isBreak = Math.random() * 100 < pStats.armorBreakChance;
      const finalDef = isBreak ? 0 : adjustedMCalc.def;
      const counterBase = Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier));
      let dmg = rollDmg(Math.max(1, Math.round(counterBase * (1 - finalDef / 100))));

      // 劍士：格擋反擊命中率加成（+20%）
      let counterHitChance = pStats.hit;
      if (pStats.hasSwordsmanBadge && (pStats.weaponType === "sword_1h" || pStats.weaponType === "sword_2h")) {
        counterHitChance = Math.min(100, counterHitChance + pStats.swordsmanBlockCritBoost);
      }

      // 劍士：格擋反擊爆擊檢測
      let isCrit = Math.random() * 100 < pStats.crit;
      if (pStats.hasSwordsmanBadge && (pStats.weaponType === "sword_1h" || pStats.weaponType === "sword_2h")) {
        // 劍士格擋反擊有額外爆擊機率（+35%）
        isCrit = isCrit || Math.random() * 100 < 35;
      }
      if (isCrit) dmg = Math.round(rollDmg(counterBase) * 2.5 * tierCritDamageMultiplier);
      try {
        const equipped = options.equipped || null;
        if (equipped && pHp <= Math.floor((pStats.maxHp || 1) * 0.35)) {
          const lowHpEffects = collectEquipmentEffects(equipped, 'on_low_hp', { equipped, inventory: options.inventory || [] });
          for (const eff of lowHpEffects) {
            if (!eff || !eff.params) continue;
            if (eff.key === 'final_damage_up' && Number.isFinite(Number(eff.params.value))) {
              if (!warriorLowHpTriggered) {
                log.push(lowHpTriggerText);
                warriorLowHpTriggered = true;
              }
              dmg = Math.max(1, Math.round(dmg * Number(eff.params.value)));
            }
          }
        }
      } catch (e) {}

      mHp -= dmg;
      totalDamage += dmg;
      const swordsmanEffectNote = pStats.hasSwordsmanBadge
        ? " **(劍士)** **格擋反擊發動**"
        : " **格擋反擊**";
      log.push(`⚔️✨${swordsmanEffectNote}！${rand(jobFlavor.counter)}，${rand(atkVerbs)}，對 ${mName} 造成 **${dmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
      if (mHp <= 0) { outcome = "win"; }
    }

    if (outcome === "win") { roundLogs.push(log.join("\n")); break; }

    // ── 雙持副手追擊（怪物攻擊後觸發）──
    if (pStats.isDualWield && monsterAttackCount > 0 && outcome === null) {
      if (Math.random() * 100 < pStats.counterChance) {
        const hitChance = pStats.hit - adjustedMCalc.dodge;
        if (monsterIsStunned || Math.random() * 100 < hitChance) {
          // 法杖雙持：副手只觸發 proc 效果，傷害為 0
          if (pStats.counterIsStaffProc) {
            log.push(`🔮 副手接觸，魔力灌注！`);
            // 觸發法師屬性 proc（燒傷/麻痺/冰凍）—— 需要法師徽章
            if (pStats.hasMageBadge) {
              const procChance = 10;
              if (Math.random() * 100 < procChance) {
                monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                  key: 'burn',
                  params: { value: 0.5, duration: { mode: 'turns', value: 3 } },
                  appliedAt: round,
                  sourceType: 'mage_offhand',
                  sourceId: `${options.equipped?.weapon?.itemId || options.equipped?.weapon?.uuid || 'weapon'}:mage_offhand:burn`
                });
                combatStats.burnTriggerCount += 1;
                log.push(`🔥 **(法師)** **燒傷**！${mName} 陷入燃燒狀態，持續 3 回合！`);
              }
              if (Math.random() * 100 < procChance) {
                monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                  key: 'hit_rate_down',
                  params: { value: 30, duration: { mode: 'turns', value: 3 } },
                  appliedAt: round,
                  sourceType: 'mage_offhand',
                  sourceId: `${options.equipped?.weapon?.itemId || options.equipped?.weapon?.uuid || 'weapon'}:mage_offhand:hit_rate_down`
                });
                log.push(`⚡ **(法師)** **麻痺**！${mName} 行動遲緩，命中率下降，持續 3 回合！`);
              }
              const recentFreeze = monsterActiveEffects.find(e => e.key === 'freeze' && e.appliedAt >= round - 1);
              if (!recentFreeze && Math.random() * 100 < procChance) {
                monsterActiveEffects = upsertActiveEffectBySource(monsterActiveEffects, {
                  key: 'freeze',
                  params: { duration: { mode: 'turns', value: 1 } },
                  appliedAt: round + 1,
                  sourceType: 'mage_offhand',
                  sourceId: `${options.equipped?.weapon?.itemId || options.equipped?.weapon?.uuid || 'weapon'}:mage_offhand:freeze`
                });
                log.push(`🧊 **(法師)** **冰凍**！${mName} 被凍結，下回合無法攻擊！`);
              }
            }
          } else {
            const isBreak = pStats.counterInheritBreak && Math.random() * 100 < pStats.armorBreakChance;
            const finalDef = isBreak ? 0 : adjustedMCalc.def;
            let cdmg = rollDmg(Math.max(1, Math.round(pStats.atk * playerAtkMultiplier * roundDmgMultiplier * tierDamageMultiplier * tierFinalDamageMultiplier * tierBossDamageMultiplier * (1 - finalDef / 100))));
            try {
              const equipped = options.equipped || null;
              if (equipped && pHp <= Math.floor((pStats.maxHp || 1) * 0.35)) {
                const lowHpEffects = collectEquipmentEffects(equipped, 'on_low_hp', { equipped, inventory: options.inventory || [] });
                for (const eff of lowHpEffects) {
                  if (!eff || !eff.params) continue;
                  if (eff.key === 'final_damage_up' && Number.isFinite(Number(eff.params.value))) {
                    if (!warriorLowHpTriggered) {
                      log.push(lowHpTriggerText);
                      warriorLowHpTriggered = true;
                    }
                    cdmg = Math.max(1, Math.round(cdmg * Number(eff.params.value)));
                  }
                }
              }
            } catch (e) {}
            mHp -= cdmg;
            totalDamage += cdmg;
            log.push(`🗡️ **副手追擊**！${rand(jobFlavor.counter)}，造成 **${cdmg}** 點傷害！（怪物剩 ${Math.max(0, mHp)} HP）`);
            // 副手擊暈繼承（劍/匕首）
            if (pStats.counterInheritStun && Math.random() * 100 < pStats.stunChance) {
              stunRoundsLeft = 3;
              combatStats.stunCount += 1;
              log.push(`😵 ${mName} ${rand(stunPhrases)}！接下來 3 回合無法攻擊！`);
            }
            if (mHp <= 0) { outcome = "win"; }
          }
        } else {
          log.push(`🗡️ 副手追擊出手，但 ${mName} ${rand(dodgePhrases)}！`);
        }
      }
    }

    roundLogs.push(log.join("\n"));
    if (outcome !== null) break;

    // ── 清理過期的 activeEffects ──
    monsterActiveEffects = cleanExpiredEffects(monsterActiveEffects, round);
    if (options.playerActiveEffects) {
      options.playerActiveEffects = cleanExpiredEffects(options.playerActiveEffects, round);
    }

    round++;
  }

  if (outcome === null) outcome = "timeout";

  return {
    outcome,
    roundLogs,
    totalDamage,
    finalMonsterHp: Math.max(0, mHp),
    finalPlayerHp:  Math.max(0, pHp),
    combatStats
  };
}

module.exports = { runCombatLoop };
