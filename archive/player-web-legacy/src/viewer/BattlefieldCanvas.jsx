import React, { useEffect, useRef } from 'react';
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

const ARENA_WIDTH = 1600;
const ARENA_HEIGHT = 900;
const VIEWER_SLOTS = [
  { x: 245, y: 255, scale: 0.48 },
  { x: 320, y: 235, scale: 0.5 },
  { x: 395, y: 260, scale: 0.48 },
  { x: 470, y: 238, scale: 0.48 },
  { x: 545, y: 262, scale: 0.47 },
  { x: 620, y: 240, scale: 0.47 },
  { x: 695, y: 264, scale: 0.46 },
  { x: 770, y: 242, scale: 0.46 },
];

const FRONTLINE_SLOTS = [
  { x: 990, y: 610, scale: 0.92 },
  { x: 870, y: 660, scale: 0.88 },
  { x: 760, y: 610, scale: 0.84 },
];

const MIDLINE_SLOTS = [
  { x: 815, y: 550, scale: 0.8 },
  { x: 700, y: 595, scale: 0.77 },
];

const BACKLINE_SLOTS = [
  { x: 645, y: 500, scale: 0.72 },
  { x: 530, y: 545, scale: 0.69 },
  { x: 430, y: 500, scale: 0.66 },
];

function classifyWeaponLane(weaponType = '') {
  const normalized = String(weaponType).toLowerCase();
  if (normalized.startsWith('staff') || normalized === 'bow') return 'back';
  if (normalized === 'axe_2h' || normalized === 'mace_2h' || normalized === 'sword_2h' || normalized === 'spear') return 'mid';
  return 'front';
}

function buildFormationSlots(actors) {
  const laneCounts = { front: 0, mid: 0, back: 0 };
  return actors.map((actor, index) => {
    const lane = classifyWeaponLane(actor.weapon?.weaponType);
    const laneSlots = lane === 'front' ? FRONTLINE_SLOTS : lane === 'mid' ? MIDLINE_SLOTS : BACKLINE_SLOTS;
    const slotIndex = laneCounts[lane] % laneSlots.length;
    laneCounts[lane] += 1;
    return laneSlots[slotIndex] || FRONTLINE_SLOTS[index % FRONTLINE_SLOTS.length];
  });
}

function createHeroSprite(textureUrl) {
  const hasTexture = Boolean(textureUrl);
  const sprite = hasTexture ? Sprite.from(textureUrl) : Sprite.from(Texture.WHITE);
  sprite.anchor.set(0.5, 1);
  if (!hasTexture) {
    sprite.width = 88;
    sprite.height = 150;
    sprite.tint = 0xf0e7d8;
  }
  return sprite;
}

function drawGridFloor(graphics) {
  graphics.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT).fill(0x140d0a);
  graphics.rect(0, 0, ARENA_WIDTH, 240).fill(0x1a0f12);
  graphics.rect(0, 240, ARENA_WIDTH, 660).fill(0x0f1718);

  const cols = 9;
  const rows = 5;
  const startX = 270;
  const startY = 350;
  const tileW = 118;
  const tileH = 66;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = startX + col * tileW + row * 22;
      const y = startY + row * tileH;
      const fill = (row + col) % 2 === 0 ? 0x274847 : 0x1c3533;
      graphics.roundRect(x, y, tileW - 10, tileH - 8, 8).fill(fill).stroke({ color: 0x5eb7b0, width: 2, alpha: 0.18 });
    }
  }

  graphics.rect(0, 782, ARENA_WIDTH, 118).fill(0x0b0b0c);
}

export function BattlefieldCanvas({ scene, isBattling }) {
  const hostRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const app = new Application();
    let mounted = true;
    let initialized = false;

    const build = async () => {
      await app.init({
        width: ARENA_WIDTH,
        height: ARENA_HEIGHT,
        antialias: false,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      initialized = true;
      if (!mounted) return;

      hostRef.current.innerHTML = '';
      hostRef.current.appendChild(app.canvas);

      const root = new Container();
      app.stage.addChild(root);

      const bg = new Graphics();
      drawGridFloor(bg);
      root.addChild(bg);

      const viewerLine = new Graphics();
      viewerLine.rect(180, 300, 690, 8).fill({ color: 0x7fe0d6, alpha: 0.25 });
      root.addChild(viewerLine);

      const formationSlots = buildFormationSlots(scene.playerActors);

      const buildActor = (actor, slot, isViewer = false) => {
        const container = new Container();
        container.x = slot.x;
        container.y = slot.y;
        container.scale.set(slot.scale);

        const tileShadow = new Graphics();
        tileShadow.ellipse(0, -4, isViewer ? 40 : 56, isViewer ? 12 : 18).fill({ color: 0x000000, alpha: 0.28 });
        container.addChild(tileShadow);

        const name = new Text({
          text: actor.name,
          style: {
            fill: '#ffffff',
            fontSize: isViewer ? 16 : 22,
            fontFamily: 'monospace',
            fontWeight: 'bold',
            stroke: { color: '#000000', width: 4 },
          },
        });
        name.anchor.set(0.5, 1);
        name.y = isViewer ? -110 : -160;
        container.addChild(name);

        const hpBg = new Graphics();
        hpBg.rect(-50, isViewer ? -102 : -148, 100, 8).fill(0x120000);
        const hpFill = new Graphics();
        const hpRatio = Math.max(0.04, (actor.hp || 1) / Math.max(1, actor.maxHp || 1));
        hpFill.rect(-48, isViewer ? -100 : -146, 96 * hpRatio, 4).fill(isViewer ? 0xf2b84d : 0x78f267);
        container.addChild(hpBg);
        container.addChild(hpFill);

        const hero = createHeroSprite(actor.avatarUrl);
        hero.y = -4;
        hero.width = isViewer ? 62 : 88;
        hero.height = isViewer ? 88 : 126;
        if (!actor.avatarUrl) {
          hero.tint = isViewer ? [0xd8f4ff, 0xffe4ad, 0xc8ffd8, 0xffc8d7][actor.tint || 0] : 0xf7e6cf;
        }
        container.addChild(hero);

        if (actor.weapon?.imageUrl) {
          const weaponSprite = Sprite.from(actor.weapon.imageUrl);
          weaponSprite.anchor.set(0.5);
          weaponSprite.x = 30;
          weaponSprite.y = isViewer ? -62 : -92;
          weaponSprite.width = isViewer ? 24 : 32;
          weaponSprite.height = isViewer ? 44 : 58;
          container.addChild(weaponSprite);
        } else {
          const weapon = new Graphics();
          weapon.roundRect(18, isViewer ? -76 : -104, isViewer ? 16 : 20, isViewer ? 44 : 56, 3).fill(0xd5d2c9).stroke({ color: 0x111111, width: 3 });
          const weaponTip = new Text({
            text: actor.weapon?.glyph || actor.glyph || 'W',
            style: {
              fill: '#241405',
              fontSize: isViewer ? 11 : 13,
              fontFamily: 'monospace',
              fontWeight: 'bold',
            },
          });
          weaponTip.anchor.set(0.5);
          weaponTip.x = 26;
          weaponTip.y = isViewer ? -56 : -76;
          container.addChild(weapon);
          container.addChild(weaponTip);
        }

        return container;
      };

      scene.playerActors.forEach((actor, index) => {
        const slot = formationSlots[index] || FRONTLINE_SLOTS[index % FRONTLINE_SLOTS.length];
        root.addChild(buildActor(actor, slot, false));
      });

      scene.viewerActors.forEach((actor, index) => {
        const slot = VIEWER_SLOTS[index] || VIEWER_SLOTS[VIEWER_SLOTS.length - 1];
        root.addChild(buildActor(actor, slot, true));
      });

      const monsterLayer = new Container();
      monsterLayer.x = 1260;
      monsterLayer.y = 610;
      root.addChild(monsterLayer);

      const monsterShadow = new Graphics();
      monsterShadow.ellipse(0, 4, 190, 40).fill({ color: 0x000000, alpha: 0.34 });
      monsterLayer.addChild(monsterShadow);

      if (scene.zone?.monsterImageUrl) {
        const monsterSprite = Sprite.from(scene.zone.monsterImageUrl);
        monsterSprite.anchor.set(0.5, 1);
        monsterSprite.width = 260;
        monsterSprite.height = 220;
        monsterLayer.addChild(monsterSprite);
      } else {
        const monsterBody = new Graphics();
        monsterBody.roundRect(-118, -152, 246, 176, 28).fill(0xc12d17).stroke({ color: 0x340807, width: 10 });
        monsterBody.circle(-58, -98, 40).fill(0x1c1111);
        monsterBody.circle(58, -88, 34).fill(0x1c1111);
        monsterBody.circle(-48, -96, 10).fill(0xfff082);
        monsterBody.circle(54, -88, 10).fill(0xfff082);
        for (let index = 0; index < 5; index += 1) {
          monsterBody.roundRect(-120 + index * 55, 2, 20, 82, 8).fill(0x8f1f11);
        }
        monsterLayer.addChild(monsterBody);
      }

      const monsterLabel = new Text({
        text: scene.zone?.monsterName || 'Monster',
        style: {
          fill: '#ffffff',
          fontSize: 28,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          stroke: { color: '#000000', width: 5 },
        },
      });
      monsterLabel.anchor.set(0.5, 1);
      monsterLabel.y = -190;
      monsterLayer.addChild(monsterLabel);

      const globalAttackFx = new Graphics();
      root.addChild(globalAttackFx);

      app.ticker.add((ticker) => {
        const t = ticker.lastTime / 220;
        monsterLayer.y = 610 + Math.sin(t) * (isBattling ? 8 : 3);

        globalAttackFx.clear();
        if (isBattling) {
          const alpha = 0.08 + ((Math.sin(t * 1.6) + 1) * 0.04);
          globalAttackFx.rect(250, 340, 1080, 380).fill({ color: 0xff7a4a, alpha });
          globalAttackFx.rect(250, 340, 1080, 380).stroke({ color: 0xffd56a, width: 3, alpha: 0.18 });
        }
      });
    };

    build();

    return () => {
      mounted = false;
      if (initialized) {
        app.destroy(true, { children: true });
      }
    };
  }, [scene, isBattling]);

  return <div ref={hostRef} className="viewer-canvas-host" />;
}

export const VIEWER_ARENA_SIZE = { width: ARENA_WIDTH, height: ARENA_HEIGHT };
