import Phaser from "phaser";

const TILE_SIZE = 72;

function tileToPixel(grid) {
  return {
    x: grid.x * TILE_SIZE + TILE_SIZE / 2,
    y: grid.y * TILE_SIZE + TILE_SIZE / 2,
  };
}

function drawMap(scene, map) {
  const g = scene.add.graphics();
  g.fillStyle(0x1f2638, 1);
  g.fillRect(0, 0, map.width * TILE_SIZE, map.height * TILE_SIZE);

  const allySet = new Set(map.allyDeployArea.map((tile) => `${tile.x},${tile.y}`));
  const enemySet = new Set(map.enemyDeployArea.map((tile) => `${tile.x},${tile.y}`));

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const key = `${x},${y}`;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      if (allySet.has(key)) {
        g.fillStyle(0x1a3f74, 1);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      } else if (enemySet.has(key)) {
        g.fillStyle(0x5c1f2b, 1);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      } else {
        g.fillStyle(0x2a3143, 1);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      }

      g.lineStyle(2, 0x4a5580, 0.7);
      g.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    }
  }
}

function drawUnits(scene, units) {
  const sprites = new Map();

  units.forEach((unit) => {
    if (!unit.initialGrid) return;
    const pos = tileToPixel(unit.initialGrid);
    const color = unit.side === "ally" ? 0x4ee8ff : 0xff7a7a;

    const marker = scene.add.circle(pos.x, pos.y, 20, color, 0.95);
    marker.setStrokeStyle(3, 0x0a0c15, 1);

    const nameText = scene.add
      .text(pos.x, pos.y + 28, unit.name, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "13px",
        color: "#ffffff",
        stroke: "#111111",
        strokeThickness: 4,
      })
      .setOrigin(0.5);

    const hpText = scene.add
      .text(pos.x, pos.y - 34, `${unit.stats.hp}/${unit.stats.hp}`, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "11px",
        color: "#9ce77a",
        stroke: "#111111",
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    sprites.set(unit.id, { marker, nameText, hpText, maxHp: unit.stats.hp });
  });

  return sprites;
}

function playActions(scene, actions, spritesById) {
  let delay = 350;

  actions.forEach((action) => {
    if (action.type === "move") {
      const actor = spritesById.get(action.actorId);
      if (!actor) return;
      const targetPos = tileToPixel(action.to);
      scene.time.delayedCall(delay, () => {
        scene.tweens.add({
          targets: actor.marker,
          x: targetPos.x,
          y: targetPos.y,
          duration: 260,
          ease: "Sine.easeInOut",
        });
        scene.tweens.add({
          targets: actor.nameText,
          x: targetPos.x,
          y: targetPos.y + 28,
          duration: 260,
          ease: "Sine.easeInOut",
        });
        scene.tweens.add({
          targets: actor.hpText,
          x: targetPos.x,
          y: targetPos.y - 34,
          duration: 260,
          ease: "Sine.easeInOut",
        });
      });
      delay += 350;
      return;
    }

    if (action.type === "attack") {
      const actor = spritesById.get(action.actorId);
      const target = spritesById.get(action.targetId);
      if (!actor || !target) return;

      scene.time.delayedCall(delay, () => {
        scene.tweens.add({
          targets: actor.marker,
          scale: 1.18,
          yoyo: true,
          duration: 120,
        });
        scene.tweens.add({
          targets: target.marker,
          alpha: 0.45,
          yoyo: true,
          duration: 120,
        });

        target.hpText.setText(`${Math.max(0, action.targetHpAfter)}/${target.maxHp}`);
        if (action.targetDead) {
          target.marker.setFillStyle(0x747474, 0.45);
          target.nameText.setAlpha(0.55);
          target.hpText.setAlpha(0.55);
        }
      });

      delay += 380;
    }
  });
}

export function createBattlefieldGame({ mountElement, bootstrap, battleResult }) {
  const width = bootstrap.map.width * TILE_SIZE;
  const height = bootstrap.map.height * TILE_SIZE;

  const scene = {
    key: "Battlefield",
    create() {
      drawMap(this, bootstrap.map);
      const spritesById = drawUnits(this, bootstrap.units);
      if (battleResult?.actions?.length) {
        playActions(this, battleResult.actions, spritesById);
      }
    },
  };

  return new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    parent: mountElement,
    backgroundColor: "#111522",
    scene: [scene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
}
