const MAX_ROUNDS = 30;

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function keyOf(pos) {
  return `${pos.x},${pos.y}`;
}

function inBounds(pos, map) {
  return pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height;
}

function toInitialPosition(unit, indexBySide, map) {
  if (unit.initialGrid) return { ...unit.initialGrid };
  const pool = unit.side === "ally" ? map.allyDeployArea : map.enemyDeployArea;
  const fallback =
    pool[indexBySide % pool.length] || (unit.side === "ally" ? { x: 0, y: 0 } : { x: map.width - 1, y: map.height - 1 });
  return { ...fallback };
}

function nextStepToward(actor, target, occupiedSet, map) {
  const candidates = [
    { x: actor.position.x + 1, y: actor.position.y },
    { x: actor.position.x - 1, y: actor.position.y },
    { x: actor.position.x, y: actor.position.y + 1 },
    { x: actor.position.x, y: actor.position.y - 1 },
  ].filter((candidate) => inBounds(candidate, map));

  const valid = candidates.filter((candidate) => !occupiedSet.has(keyOf(candidate)));
  if (!valid.length) return null;

  valid.sort((a, b) => {
    const d = manhattan(a, target.position) - manhattan(b, target.position);
    if (d !== 0) return d;
    return a.x - b.x || a.y - b.y;
  });
  return valid[0];
}

function chooseTarget(actor, livingEnemies) {
  if (!livingEnemies.length) return null;
  return [...livingEnemies].sort((a, b) => {
    const distanceDiff = manhattan(actor.position, a.position) - manhattan(actor.position, b.position);
    if (distanceDiff !== 0) return distanceDiff;
    const hpDiff = a.currentHp - b.currentHp;
    if (hpDiff !== 0) return hpDiff;
    return a.id.localeCompare(b.id);
  })[0];
}

function computeDamage(actor, target) {
  return Math.max(1, Math.round(actor.stats.atk - target.stats.def * 0.55));
}

export function runAutoBattle(bootstrap) {
  const units = bootstrap.units.map((unit, index) => {
    const sideIndex = bootstrap.units.filter((u, i) => i <= index && u.side === unit.side).length - 1;
    return {
      ...unit,
      position: toInitialPosition(unit, sideIndex, bootstrap.map),
      currentHp: unit.stats.hp,
      alive: true,
    };
  });

  const actions = [];
  let round = 1;

  while (round <= MAX_ROUNDS) {
    const alliesAlive = units.some((unit) => unit.side === "ally" && unit.alive);
    const enemiesAlive = units.some((unit) => unit.side === "enemy" && unit.alive);
    if (!alliesAlive || !enemiesAlive) break;

    actions.push({
      type: "roundStart",
      round,
      text: `第 ${round} 回合開始`,
    });

    const turnOrder = units
      .filter((unit) => unit.alive)
      .sort((a, b) => b.stats.spd - a.stats.spd || a.id.localeCompare(b.id));

    for (const actor of turnOrder) {
      if (!actor.alive) continue;
      const livingEnemies = units.filter((unit) => unit.alive && unit.side !== actor.side);
      if (!livingEnemies.length) break;

      const target = chooseTarget(actor, livingEnemies);
      if (!target) continue;

      const occupied = new Set(units.filter((unit) => unit.alive && unit.id !== actor.id).map((unit) => keyOf(unit.position)));
      const startPos = { ...actor.position };
      let steps = actor.stats.moveRange;

      while (steps > 0 && manhattan(actor.position, target.position) > actor.stats.attackRange) {
        const next = nextStepToward(actor, target, occupied, bootstrap.map);
        if (!next) break;
        actor.position = next;
        steps -= 1;
      }

      if (startPos.x !== actor.position.x || startPos.y !== actor.position.y) {
        actions.push({
          type: "move",
          round,
          actorId: actor.id,
          actorName: actor.name,
          from: startPos,
          to: { ...actor.position },
          text: `${actor.name} 移動到 (${actor.position.x}, ${actor.position.y})`,
        });
      }

      const distanceAfterMove = manhattan(actor.position, target.position);
      if (distanceAfterMove <= actor.stats.attackRange && target.alive) {
        const damage = computeDamage(actor, target);
        target.currentHp = Math.max(0, target.currentHp - damage);
        if (target.currentHp <= 0) target.alive = false;

        actions.push({
          type: "attack",
          round,
          actorId: actor.id,
          actorName: actor.name,
          targetId: target.id,
          targetName: target.name,
          damage,
          targetHpAfter: target.currentHp,
          targetDead: !target.alive,
          text: !target.alive
            ? `${actor.name} 攻擊 ${target.name}，造成 ${damage} 傷害並擊倒對手`
            : `${actor.name} 攻擊 ${target.name}，造成 ${damage} 傷害（剩餘 ${target.currentHp} HP）`,
        });
      } else {
        actions.push({
          type: "wait",
          round,
          actorId: actor.id,
          actorName: actor.name,
          text: `${actor.name} 本回合無可攻擊目標`,
        });
      }
    }

    round += 1;
  }

  const alliesAlive = units.some((unit) => unit.side === "ally" && unit.alive);
  const enemiesAlive = units.some((unit) => unit.side === "enemy" && unit.alive);

  const outcome = alliesAlive && !enemiesAlive ? "ally_win" : !alliesAlive && enemiesAlive ? "enemy_win" : "draw";
  actions.push({
    type: "battleEnd",
    round: Math.min(round, MAX_ROUNDS),
    outcome,
    text:
      outcome === "ally_win" ? "戰鬥結束：我方勝利" : outcome === "enemy_win" ? "戰鬥結束：敵方勝利" : "戰鬥結束：平手",
  });

  return {
    rounds: round - 1,
    outcome,
    actions,
    units,
  };
}

