"use strict";

// 胡桃的命中卡在第一段真正接觸後判定一次；拆段不增加觸發機率。
function isHutaoHitCard(card) {
  const skill = card?.monsterCardSkill?.monsterSkill || card?.monsterCardSkill;
  return skill?.key === "hutao_four_winds" && skill.trigger === "on_hit";
}

function createHutaoHitCast({ card, cooldowns, sourceAtk, alive, applyDamage, log, ownerLabel, silenced }) {
  let checked = false;
  return () => {
    if (checked || silenced || !isHutaoHitCard(card) || !alive()) return;
    checked = true;
    const skill = card.monsterCardSkill.monsterSkill || card.monsterCardSkill;
    const cooldownKey = card.itemId || card.id || card.itemName || card.name || "卡片";
    if ((cooldowns[cooldownKey] || 0) > 0) return;
    if (Math.random() * 100 >= Math.min(100, Math.max(0, Number(skill.chance ?? 12)))) return;
    let applied = false;
    for (const effect of skill.procEffects || []) {
      if (effect.key !== "proc_chain_hit" || effect.target !== "enemy") continue;
      if (Math.random() * 100 >= Number(effect.chance ?? 100)) continue;
      const count = Math.max(1, Math.floor(Number(effect.params?.chainCount ?? 4)));
      const damage = Math.max(1, Math.round(sourceAtk * Number(effect.params?.damageMultiplier ?? 0.45)));
      for (let hit = 0; hit < count && alive(); hit++) {
        const actual = applyDamage(damage);
        log.push(`⛓️ **${ownerLabel}** 發動【${skill.name || "東南西北"}】連鎖打擊，造成 **${actual}** 點傷害！`);
        applied = true;
      }
    }
    if (applied && Number(skill.cooldownTurns) > 0) cooldowns[cooldownKey] = Number(skill.cooldownTurns);
  };
}

module.exports = { isHutaoHitCard, createHutaoHitCast };
