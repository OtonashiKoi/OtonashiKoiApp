import { BattleViewerApi } from "../services/battleViewerApi";

const POLL_MS = 3500;
const MAX_PLAYERS_ON_FIELD = 5;
const PLAYER_LANES_Y = [254, 320, 386, 288, 352];
const PLAYER_START_X = [150, 198, 246, 294, 342];
const DEFAULT_WEAPON_POSITION_RULES = {
  default: { preferredRange: 210, minRange: 150, maxRange: 320, laneBias: 0, xOffset: 0, yOffset: 0 },
  sword_1h: { preferredRange: 180, minRange: 120, maxRange: 230, laneBias: 0, xOffset: 0, yOffset: 0 },
  sword_2h: { preferredRange: 170, minRange: 115, maxRange: 220, laneBias: 0, xOffset: 4, yOffset: 0 },
  dagger: { preferredRange: 145, minRange: 95, maxRange: 200, laneBias: -1, xOffset: 10, yOffset: 0 },
  mace_1h: { preferredRange: 175, minRange: 115, maxRange: 230, laneBias: 0, xOffset: 2, yOffset: 0 },
  mace_2h: { preferredRange: 168, minRange: 110, maxRange: 225, laneBias: 0, xOffset: 4, yOffset: 0 },
  axe_1h: { preferredRange: 172, minRange: 112, maxRange: 230, laneBias: 0, xOffset: 4, yOffset: 0 },
  axe_2h: { preferredRange: 162, minRange: 102, maxRange: 220, laneBias: 0, xOffset: 8, yOffset: 0 },
  staff_1h: { preferredRange: 250, minRange: 190, maxRange: 340, laneBias: 1, xOffset: -6, yOffset: 0 },
  staff_2h: { preferredRange: 265, minRange: 205, maxRange: 360, laneBias: 1, xOffset: -8, yOffset: 0 },
  bow: { preferredRange: 300, minRange: 240, maxRange: 390, laneBias: 1, xOffset: -14, yOffset: 0 },
};

function n(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function estimatePlayerMaxHp(player, index) {
  return 680 + Math.round(n(player?.damage, 0) * 0.1) + index * 30;
}

function estimatePlayerHp(player, index) {
  const maxHp = estimatePlayerMaxHp(player, index);
  return Math.max(1, maxHp - Math.round(n(player?.damageTaken, 0) * 0.1));
}

export class CloneBattleScene extends Phaser.Scene {
  constructor() {
    super("CloneBattleScene");
    this.api = new BattleViewerApi();
    this.zone = "normal";
    this.zoneButtons = [];
    this.zoneData = new Map();
    this.players = [];
    this.enemy = null;
    this.bullets = [];
    this.urlTextureCache = new Map();
    this.lastSource = "loading";
    this.simSpeed = 1;
    this.weaponPositionRules = { ...DEFAULT_WEAPON_POSITION_RULES };
    this.battleAssets = { monsters: [], characters: [] };
  }

  create() {
    this.drawBackdrop();
    this.drawTopLeftButtons();
    this.drawSpeedControls();
    this.drawBottomHud();
    this.drawRightStats();
    this.drawZoneControls();

    this.refreshFromCloud();
    this.time.addEvent({
      delay: POLL_MS,
      loop: true,
      callback: () => this.refreshFromCloud(),
    });
  }

  update(_time, deltaMs) {
    const dt = (deltaMs / 1000) * this.simSpeed;
    this.updateCombat(dt);
    this.updateBullets(dt);
    this.syncHud();
  }

  drawBackdrop() {
    const g = this.add.graphics();
    g.fillGradientStyle(0x552307, 0x6a2f09, 0x0d3e43, 0x082025, 1);
    g.fillRect(0, 0, this.scale.width, this.scale.height);

    for (let i = 0; i < 12; i += 1) {
      const x = i * 120 + Phaser.Math.Between(-20, 20);
      const trunkW = Phaser.Math.Between(62, 106);
      g.fillStyle(0x5d2f11, 0.95);
      g.fillRoundedRect(x, 0, trunkW, 280, 12);
      g.fillStyle(0x7a3f17, 0.35);
      g.fillRoundedRect(x + 10, 10, 12, 260, 6);
    }

    g.fillStyle(0x0d5055, 0.92);
    g.fillRoundedRect(0, 184, this.scale.width, 286, 18);
    g.fillStyle(0x53bdc7, 0.2);
    g.fillRoundedRect(0, 220, this.scale.width, 240, 18);

    for (const y of PLAYER_LANES_Y.slice(0, 3)) {
      g.lineStyle(1, 0x88dfe7, 0.18);
      g.lineBetween(40, y + 26, this.scale.width - 40, y + 26);
    }

    const vignette = this.add.graphics();
    vignette.fillStyle(0x000000, 0.14);
    vignette.fillRect(0, 0, this.scale.width, 52);
    vignette.fillStyle(0x000000, 0.2);
    vignette.fillRect(0, this.scale.height - 204, this.scale.width, 204);

    this.add.text(22, 18, "1/15 回合", {
      fontFamily: "Microsoft JhengHei, sans-serif",
      fontSize: "34px",
      color: "#ffd196",
      stroke: "#2f1206",
      strokeThickness: 6,
    });
  }

  drawTopLeftButtons() {
    const items = ["半軍團模式", "均衡陣列", "次序調整"];
    items.forEach((label, idx) => {
      const y = 72 + idx * 40;
      const btn = this.add.rectangle(90, y, 136, 30, 0x2a3f50, 0.94).setStrokeStyle(2, 0x9fcbdf, 0.75);
      const txt = this.add
        .text(90, y, label, {
          fontFamily: "Microsoft JhengHei, sans-serif",
          fontSize: "14px",
          color: "#f4f8ff",
        })
        .setOrigin(0.5);
      btn.setInteractive({ useHandCursor: true });
      btn.on("pointerdown", () => this.showToast(`已切換：${label}`));
      txt.setDepth(2);
    });
  }

  drawSpeedControls() {
    const speeds = [1, 2, 3];
    this.speedButtons = [];
    speeds.forEach((speed, idx) => {
      const x = this.scale.width - 212 + idx * 66;
      const y = 44;
      const circle = this.add.circle(x, y, 23, speed === this.simSpeed ? 0x8ed86a : 0x2b4a58, 1).setStrokeStyle(2, 0xcde7f5, 0.85);
      const text = this.add
        .text(x, y, `x${speed}`, {
          fontFamily: "Consolas, monospace",
          fontSize: "20px",
          color: "#eff8ff",
        })
        .setOrigin(0.5);
      circle.setInteractive({ useHandCursor: true });
      circle.on("pointerdown", () => {
        this.simSpeed = speed;
        this.speedButtons.forEach((entry) => {
          entry.circle.setFillStyle(entry.speed === speed ? 0x8ed86a : 0x2b4a58, 1);
        });
      });
      this.speedButtons.push({ speed, circle, text });
    });
  }

  drawZoneControls() {
    const zoneDefs = [
      { key: "normal", label: "普通區" },
      { key: "mid", label: "進階區" },
    ];
    zoneDefs.forEach((zone, idx) => {
      const x = 26 + idx * 96;
      const y = 176;
      const rect = this.add.rectangle(x, y, 88, 28, 0x3b4f2f, 0.9).setStrokeStyle(2, 0xc8e8b0, 0.7).setOrigin(0, 0.5);
      const txt = this.add
        .text(x + 44, y, zone.label, {
          fontFamily: "Microsoft JhengHei, sans-serif",
          fontSize: "14px",
          color: "#f7ffea",
        })
        .setOrigin(0.5);
      rect.setInteractive({ useHandCursor: true });
      rect.on("pointerdown", () => {
        this.zone = zone.key;
        this.updateZoneButtonStyle();
        this.renderCurrentZone();
      });
      this.zoneButtons.push({ key: zone.key, rect, txt });
    });
    this.updateZoneButtonStyle();
  }

  updateZoneButtonStyle() {
    this.zoneButtons.forEach((item) => {
      const active = item.key === this.zone;
      item.rect.setFillStyle(active ? 0x5c7a42 : 0x3b4f2f, 0.96);
      item.txt.setColor(active ? "#fff8d0" : "#f7ffea");
    });
  }

  drawBottomHud() {
    const y = this.scale.height - 186;
    const g = this.add.graphics();
    g.fillStyle(0x111827, 0.94);
    g.fillRect(0, y, this.scale.width, 186);
    g.lineStyle(2, 0x8a633d, 0.9);
    g.strokeRect(0, y, this.scale.width, 186);

    g.fillStyle(0x1d2638, 0.97);
    g.fillRoundedRect(14, y + 16, 392, 154, 10);
    g.fillStyle(0x1d2638, 0.97);
    g.fillRoundedRect(418, y + 16, 432, 154, 10);
    g.fillStyle(0x1d2638, 0.97);
    g.fillRoundedRect(862, y + 16, 490, 154, 10);

    this.add.text(24, y + 20, "隊伍狀態", {
      fontFamily: "Microsoft JhengHei, sans-serif",
      fontSize: "16px",
      color: "#f3c78c",
    });
    this.add.text(428, y + 20, "技能欄", {
      fontFamily: "Microsoft JhengHei, sans-serif",
      fontSize: "16px",
      color: "#f3c78c",
    });
    this.add.text(872, y + 20, "戰場資訊", {
      fontFamily: "Microsoft JhengHei, sans-serif",
      fontSize: "16px",
      color: "#f3c78c",
    });

    this.playerRows = [];
    for (let i = 0; i < MAX_PLAYERS_ON_FIELD; i += 1) {
      const rowY = y + 46 + i * 26;
      this.add.text(26, rowY, `${i + 1}.`, {
        fontFamily: "Consolas, monospace",
        fontSize: "13px",
        color: "#d7e7ff",
      });
      const name = this.add.text(50, rowY, "等待參戰玩家", {
        fontFamily: "Microsoft JhengHei, sans-serif",
        fontSize: "13px",
        color: "#ffe0a8",
      });
      const hpBg = this.add.rectangle(188, rowY + 8, 160, 10, 0x342b3a, 1).setOrigin(0, 0.5);
      const hpBar = this.add.rectangle(188, rowY + 8, 160, 10, 0x4fd977, 1).setOrigin(0, 0.5);
      const hpText = this.add.text(353, rowY, "--/--", {
        fontFamily: "Consolas, monospace",
        fontSize: "12px",
        color: "#ecf7ff",
      });
      this.playerRows.push({ name, hpBg, hpBar, hpText });
    }

    this.skillSlots = [];
    for (let i = 0; i < 10; i += 1) {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const x = 438 + col * 78;
      const slotY = y + 56 + row * 54;
      const slot = this.add.rectangle(x, slotY, 64, 42, 0x32405d, 1).setStrokeStyle(2, 0xb28c57, 0.9).setOrigin(0, 0.5);
      const icon = this.add.rectangle(x + 6, slotY, 30, 30, 0x4d628f, 1).setOrigin(0, 0.5);
      const label = this.add
        .text(x + 42, slotY, `${i + 1}`, {
          fontFamily: "Consolas, monospace",
          fontSize: "14px",
          color: "#d8e7ff",
        })
        .setOrigin(0.5);
      this.skillSlots.push({ slot, icon, label });
    }

    this.monsterNameText = this.add.text(878, y + 48, "怪物載入中...", {
      fontFamily: "Microsoft JhengHei, sans-serif",
      fontSize: "18px",
      color: "#ffe3bc",
    });
    this.monsterHpBg = this.add.rectangle(878, y + 88, 320, 14, 0x332630, 1).setOrigin(0, 0.5);
    this.monsterHpBar = this.add.rectangle(878, y + 88, 320, 14, 0xe97449, 1).setOrigin(0, 0.5);
    this.monsterHpText = this.add.text(1204, y + 78, "--/--", {
      fontFamily: "Consolas, monospace",
      fontSize: "13px",
      color: "#fff2de",
    });
  }

  drawRightStats() {
    this.rightInfo = this.add
      .text(this.scale.width - 24, this.scale.height - 24, "", {
        fontFamily: "Consolas, monospace",
        fontSize: "26px",
        color: "#ffd98e",
        stroke: "#30170b",
        strokeThickness: 5,
        align: "right",
      })
      .setOrigin(1, 1);
  }

  async refreshFromCloud() {
    try {
      const payload = await this.api.fetchZones();
      this.lastSource = payload.source;
      const remoteRules = payload?.battleConfig?.weaponPositionRules;
      if (remoteRules && typeof remoteRules === "object") {
        this.weaponPositionRules = { ...DEFAULT_WEAPON_POSITION_RULES, ...remoteRules };
      } else {
        this.weaponPositionRules = { ...DEFAULT_WEAPON_POSITION_RULES };
      }
      this.battleAssets = {
        monsters: payload?.battleConfig?.assets?.monsters || [],
        characters: payload?.battleConfig?.assets?.characters || [],
      };
      this.zoneData.clear();
      (payload.zones || []).forEach((zone) => {
        if (zone?.zone) this.zoneData.set(zone.zone, zone);
      });
      this.renderCurrentZone();
    } catch (error) {
      this.lastSource = "error";
      this.rightInfo.setText(`資料來源：錯誤\n${error.message || "無法讀取雲端資料"}`);
    }
  }

  async renderCurrentZone() {
    const zone = this.zoneData.get(this.zone) || this.zoneData.get("normal") || this.zoneData.values().next().value;
    if (!zone) return;

    this.clearFieldActors();

    const players = (zone.damageLeaderboard || []).slice(0, MAX_PLAYERS_ON_FIELD);
    const monster = {
      id: zone.monsterId || null,
      name: zone.monsterName || "未知怪物",
      imageUrl: zone.monsterImageUrl || null,
      maxHp: Math.max(1, n(zone.maxHp, 1200)),
      hp: Math.max(0, n(zone.currentHp, n(zone.maxHp, 1200))),
    };

    await this.spawnEnemy(monster);
    await this.spawnPlayers(players);
    this.syncHud();
  }

  clearFieldActors() {
    this.players.forEach((p) => p.nodes.forEach((node) => node.destroy()));
    this.players = [];
    if (this.enemy) {
      this.enemy.nodes.forEach((node) => node.destroy());
      this.enemy = null;
    }
    this.bullets.forEach((b) => b.dot.destroy());
    this.bullets = [];
  }

  async ensureTexture(url) {
    if (!url) return null;
    if (this.urlTextureCache.has(url)) return this.urlTextureCache.get(url);

    const key = `img_${Date.now()}_${this.urlTextureCache.size}`;
    const textureKey = await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.textures.addImage(key, img);
        resolve(key);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    if (textureKey) this.urlTextureCache.set(url, textureKey);
    return textureKey;
  }

  async spawnEnemy(monster) {
    const x = this.scale.width - 216;
    const y = 322;
    const template = this.resolveMonsterTemplate(monster);
    const texture = await this.ensureTexture(template?.imageUrl || monster.imageUrl);

    let sprite;
    if (texture) {
      sprite = this.add.image(x, y, texture).setDisplaySize(250, 250);
    } else {
      sprite = this.add.circle(x, y, 98, 0xd95a47, 1).setStrokeStyle(4, 0x2a1010, 1);
    }
    const hpBg = this.add.rectangle(x - 134, y - 146, 268, 14, 0x33272f, 1).setOrigin(0, 0.5);
    const hpBar = this.add.rectangle(x - 134, y - 146, 268, 14, 0xe97449, 1).setOrigin(0, 0.5);
    const name = this.add
      .text(x, y + 146, monster.name, {
        fontFamily: "Microsoft JhengHei, sans-serif",
        fontSize: "21px",
        color: "#ffdfb0",
        stroke: "#291208",
        strokeThickness: 5,
      })
      .setOrigin(0.5);

    this.enemy = {
      x,
      y,
      hp: monster.hp,
      maxHp: monster.maxHp,
      cooldown: 1.3,
      sprite,
      hpBg,
      hpBar,
      name,
      nodes: [sprite, hpBg, hpBar, name],
    };
  }

  async spawnPlayers(players) {
    for (let i = 0; i < MAX_PLAYERS_ON_FIELD; i += 1) {
      const info = players[i];
      if (!info) continue;

      const point = this.resolvePlayerPoint(info, i);
      const x = point.x;
      const y = point.y;
      const template = this.resolveCharacterTemplate(info);
      const texture = await this.ensureTexture(template?.imageUrl || info.avatarUrl || info.weaponImageUrl || null);
      const maxHp = estimatePlayerMaxHp(info, i);
      const hp = estimatePlayerHp(info, i);

      let sprite;
      if (texture) {
        sprite = this.add.image(x, y, texture).setDisplaySize(78, 78);
      } else {
        sprite = this.add.circle(x, y, 30, 0xff8d5a, 1).setStrokeStyle(3, 0x180d08, 1);
      }

      const hpBg = this.add.rectangle(x - 36, y - 48, 72, 8, 0x342b38, 1).setOrigin(0, 0.5);
      const hpBar = this.add.rectangle(x - 36, y - 48, 72 * (hp / maxHp), 8, 0x52da76, 1).setOrigin(0, 0.5);
      const name = this.add
        .text(x, y + 42, info.name || `玩家${i + 1}`, {
          fontFamily: "Microsoft JhengHei, sans-serif",
          fontSize: "13px",
          color: "#ffffff",
          stroke: "#111111",
          strokeThickness: 3,
        })
        .setOrigin(0.5);

      this.players.push({
        id: info.discordId || `player-${i}`,
        name: info.name || `玩家${i + 1}`,
        x,
        y,
        hp,
        maxHp,
        atk: Math.max(18, 26 + Math.round(n(info.damage, 0) * 0.02)),
        weaponType: info?.weaponType || null,
        offhandWeaponType: info?.offhandWeaponType || null,
        cooldown: 0.75 + i * 0.14,
        sprite,
        hpBg,
        hpBar,
        label: name,
        nodes: [sprite, hpBg, hpBar, name],
      });
    }
  }

  getWeaponRule(weaponType) {
    const key = weaponType && this.weaponPositionRules[weaponType] ? weaponType : "default";
    const rule = this.weaponPositionRules[key] || DEFAULT_WEAPON_POSITION_RULES.default;
    const fallback = DEFAULT_WEAPON_POSITION_RULES.default;
    return {
      preferredRange: Number.isFinite(rule.preferredRange) ? rule.preferredRange : fallback.preferredRange,
      minRange: Number.isFinite(rule.minRange) ? rule.minRange : fallback.minRange,
      maxRange: Number.isFinite(rule.maxRange) ? rule.maxRange : fallback.maxRange,
      laneBias: Number.isFinite(rule.laneBias) ? rule.laneBias : fallback.laneBias,
      xOffset: Number.isFinite(rule.xOffset) ? rule.xOffset : fallback.xOffset,
      yOffset: Number.isFinite(rule.yOffset) ? rule.yOffset : fallback.yOffset,
    };
  }

  resolveMonsterTemplate(monster) {
    const assets = Array.isArray(this.battleAssets?.monsters) ? this.battleAssets.monsters : [];
    if (!assets.length) return null;
    const byMonsterId = assets.find(
      (asset) =>
        asset &&
        (asset.actionKey || "idle") === "idle" &&
        asset.bindMonsterId &&
        monster?.id &&
        String(asset.bindMonsterId) === String(monster.id) &&
        asset.imageUrl,
    );
    if (byMonsterId) return byMonsterId;
    return assets.find((asset) => asset && !asset.bindMonsterId && (asset.actionKey || "idle") === "idle" && asset.imageUrl) || null;
  }

  isOffhandMatch(asset, offhandWeaponType) {
    const mode = asset?.bindOffhandMode || "any";
    if (mode === "any") return true;
    if (mode === "none") return !offhandWeaponType;
    if (mode === "specific") return !!offhandWeaponType && String(asset.bindOffhandType || "") === String(offhandWeaponType);
    return true;
  }

  resolveCharacterTemplate(info) {
    const assets = Array.isArray(this.battleAssets?.characters) ? this.battleAssets.characters : [];
    if (!assets.length) return null;
    const weaponType = info?.weaponType || null;
    const offhandWeaponType = info?.offhandWeaponType || null;

    const strict = assets.find(
      (asset) =>
        asset &&
        (asset.actionKey || "idle") === "idle" &&
        asset.bindWeaponType &&
        weaponType &&
        String(asset.bindWeaponType) === String(weaponType) &&
        this.isOffhandMatch(asset, offhandWeaponType) &&
        asset.imageUrl,
    );
    if (strict) return strict;

    return (
      assets.find(
        (asset) =>
          asset &&
          !asset.bindWeaponType &&
          (asset.actionKey || "idle") === "idle" &&
          this.isOffhandMatch(asset, offhandWeaponType) &&
          asset.imageUrl,
      ) || null
    );
  }

  resolvePlayerPoint(info, index) {
    const enemyX = this.enemy?.x || this.scale.width - 216;
    const anchorX = enemyX - 84;
    const rule = this.getWeaponRule(info?.weaponType || null);

    const preferred = Phaser.Math.Clamp(rule.preferredRange, rule.minRange, rule.maxRange);
    const targetX = anchorX - preferred + rule.xOffset;
    const clampedX = Phaser.Math.Clamp(targetX + index * 6, 120, anchorX - 36);

    const baseLane = index % PLAYER_LANES_Y.length;
    const laneIdx = Phaser.Math.Clamp(baseLane + Math.round(rule.laneBias), 0, PLAYER_LANES_Y.length - 1);
    const y = (PLAYER_LANES_Y[laneIdx] || PLAYER_LANES_Y[baseLane] || 320) + rule.yOffset;

    return {
      x: clampedX,
      y: Phaser.Math.Clamp(y, 232, 430),
    };
  }

  updateCombat(dt) {
    if (!this.enemy || this.enemy.hp <= 0) return;

    this.players.forEach((p) => {
      if (p.hp <= 0) return;
      p.cooldown -= dt;
      if (p.cooldown <= 0) {
        p.cooldown = 0.78 + Phaser.Math.FloatBetween(0, 0.68);
        this.fireBullet(p, this.enemy, 420 + Phaser.Math.Between(-40, 70), p.atk, "ally");
      }
    });

    this.enemy.cooldown -= dt;
    if (this.enemy.cooldown <= 0) {
      const alive = this.players.filter((p) => p.hp > 0);
      if (!alive.length) return;
      this.enemy.cooldown = 1.2 + Phaser.Math.FloatBetween(0.4, 0.8);
      const target = Phaser.Utils.Array.GetRandom(alive);
      this.fireBullet(this.enemy, target, 340 + Phaser.Math.Between(-30, 40), Math.max(14, this.enemy.maxHp * 0.009), "enemy");
    }
  }

  fireBullet(from, to, speed, damage, side) {
    const color = side === "ally" ? 0xff6d44 : 0x78e9ff;
    const dot = this.add.circle(from.x, from.y, 8, color, 0.95).setStrokeStyle(2, 0xffffff, 0.45);
    this.bullets.push({ dot, to, speed, damage });
  }

  updateBullets(dt) {
    this.bullets = this.bullets.filter((b) => {
      if (!b.to || b.to.hp <= 0) {
        b.dot.destroy();
        return false;
      }
      const dx = b.to.x - b.dot.x;
      const dy = b.to.y - b.dot.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 12) {
        b.to.hp = Math.max(0, b.to.hp - b.damage);
        this.tweens.add({
          targets: b.to.sprite,
          alpha: 0.35,
          yoyo: true,
          duration: 70,
        });
        if (b.to.hp <= 0) {
          this.tweens.add({
            targets: [b.to.sprite, b.to.label, b.to.hpBg, b.to.hpBar],
            alpha: 0.2,
            duration: 220,
          });
        }
        b.dot.destroy();
        return false;
      }
      const move = b.speed * dt;
      b.dot.x += (dx / Math.max(1, dist)) * move;
      b.dot.y += (dy / Math.max(1, dist)) * move;
      return true;
    });
  }

  syncHud() {
    this.playerRows.forEach((row, idx) => {
      const p = this.players[idx];
      if (!p) {
        row.name.setText("等待參戰玩家");
        row.hpText.setText("--/--");
        row.hpBar.width = 0;
        return;
      }
      const ratio = p.maxHp <= 0 ? 0 : p.hp / p.maxHp;
      row.name.setText(p.name);
      row.hpText.setText(`${Math.round(p.hp)}/${p.maxHp}`);
      row.hpBar.width = 160 * ratio;
      row.hpBar.fillColor = ratio > 0.5 ? 0x4fd977 : ratio > 0.2 ? 0xe8c14d : 0xff6e6e;
    });

    if (this.enemy) {
      const ratio = this.enemy.maxHp <= 0 ? 0 : this.enemy.hp / this.enemy.maxHp;
      this.monsterNameText.setText(this.enemy.name.text || "怪物");
      this.monsterHpText.setText(`${Math.round(this.enemy.hp)}/${this.enemy.maxHp}`);
      this.monsterHpBar.width = 320 * ratio;
      this.enemy.hpBar.width = 268 * ratio;
    }

    const alive = this.players.filter((p) => p.hp > 0).length;
    const total = this.players.reduce((sum, p) => sum + (p.maxHp - p.hp), 0);
    this.rightInfo.setText(
      [
        `資料 ${this.lastSource}`,
        `區域 ${this.zone}`,
        `存活 ${alive}/${Math.max(1, this.players.length)}`,
        `總傷 ${Math.round(total)}`,
      ].join("\n"),
    );
  }

  showToast(text) {
    const toast = this.add
      .text(this.scale.width / 2, 92, text, {
        fontFamily: "Microsoft JhengHei, sans-serif",
        fontSize: "24px",
        color: "#fff4df",
        backgroundColor: "#152531dd",
        padding: { left: 14, right: 14, top: 8, bottom: 8 },
      })
      .setOrigin(0.5);
    this.tweens.add({
      targets: toast,
      y: 62,
      alpha: 0,
      duration: 720,
      onComplete: () => toast.destroy(),
    });
  }
}
