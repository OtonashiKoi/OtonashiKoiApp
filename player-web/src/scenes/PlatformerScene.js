import Phaser from "phaser";

const WORLD_WIDTH = 2600;
const WORLD_HEIGHT = 720;
const REQUIRED_SHARDS = 6;

const platforms = [
  [120, 650, 420, 42],
  [520, 560, 260, 34],
  [820, 480, 230, 34],
  [1140, 570, 320, 34],
  [1510, 455, 250, 34],
  [1830, 540, 310, 34],
  [2210, 430, 360, 34],
  [2470, 610, 320, 42],
];

const shardSpawns = [
  [510, 500],
  [825, 420],
  [1200, 510],
  [1515, 395],
  [1850, 480],
  [2250, 370],
];

export class PlatformerScene extends Phaser.Scene {
  constructor() {
    super("PlatformerScene");
    this.shards = 0;
    this.vitality = 3;
    this.canDash = true;
    this.isComplete = false;
  }

  preload() {
    this.load.spritesheet("hero", "/assets/luna-platformer-sheet.png", {
      frameWidth: 48,
      frameHeight: 64,
    });
    this.load.image("portrait", "/assets/hd-pixel-portrait.png");
  }

  create() {
    this.shards = 0;
    this.vitality = 3;
    this.canDash = true;
    this.isComplete = false;

    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.createTextures();
    this.createBackground();
    this.createPlatforms();
    this.createPlayer();
    this.createCollectibles();
    this.createHazards();
    this.createGoal();
    this.createHud();
    this.createControls();
    this.createMobileControls();

    this.physics.add.collider(this.player, this.platformGroup);
    this.physics.add.collider(this.hazardGroup, this.platformGroup);
    this.physics.add.overlap(this.player, this.shardGroup, this.collectShard, null, this);
    this.physics.add.overlap(this.player, this.hazardGroup, this.takeDamage, null, this);
    this.physics.add.overlap(this.player, this.goalZone, this.tryFinish, null, this);

    this.cameras.main.startFollow(this.player, true, 0.08, 0.12);
    this.cameras.main.setDeadzone(120, 80);
  }

  createTextures() {
    const shard = this.make.graphics({ x: 0, y: 0, add: false });
    shard.fillStyle(0x9ee8ff, 1);
    shard.fillRect(7, 0, 4, 18);
    shard.fillRect(0, 7, 18, 4);
    shard.fillStyle(0xffffff, 1);
    shard.fillRect(8, 4, 2, 10);
    shard.generateTexture("moonShard", 18, 18);

    const wisp = this.make.graphics({ x: 0, y: 0, add: false });
    wisp.fillStyle(0x402b78, 1);
    wisp.fillRect(6, 0, 18, 6);
    wisp.fillRect(0, 6, 30, 18);
    wisp.fillStyle(0x81dcff, 1);
    wisp.fillRect(8, 10, 4, 4);
    wisp.fillRect(18, 10, 4, 4);
    wisp.generateTexture("shadowWisp", 30, 24);
  }

  createBackground() {
    this.add.rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0x0b1025).setOrigin(0);

    const moon = this.add.circle(185, 125, 64, 0xdfe7ff, 0.92);
    moon.setScrollFactor(0.16);

    for (let i = 0; i < 90; i += 1) {
      const x = Phaser.Math.Between(0, WORLD_WIDTH);
      const y = Phaser.Math.Between(32, 360);
      const star = this.add.rectangle(x, y, 2, 2, 0xdee8ff, Phaser.Math.FloatBetween(0.35, 0.9));
      star.setScrollFactor(Phaser.Math.FloatBetween(0.12, 0.38));
    }

    this.add.image(98, 438, "portrait").setOrigin(0.5, 1).setScale(1.15).setAlpha(0.18).setScrollFactor(0.08);

    for (let i = 0; i < 8; i += 1) {
      const x = i * 380 - 80;
      const mountain = this.add.triangle(x, 650, 0, 240, 220, 0, 460, 240, 0x141a38, 0.78);
      mountain.setScrollFactor(0.38);
    }

    this.add.rectangle(0, 674, WORLD_WIDTH, 46, 0x131829).setOrigin(0);
  }

  createPlatforms() {
    this.platformGroup = this.physics.add.staticGroup();
    platforms.forEach(([x, y, width, height]) => {
      const base = this.add.rectangle(x, y, width, height, 0x1c2340).setStrokeStyle(4, 0x6f65d6);
      const trim = this.add.rectangle(x, y - height / 2 + 5, width - 14, 8, 0x384184);
      this.platformGroup.add(base);
      this.platformGroup.add(trim);
      base.body.updateFromGameObject();
      trim.body.updateFromGameObject();
    });
  }

  createPlayer() {
    this.anims.create({
      key: "idle",
      frames: [{ key: "hero", frame: 0 }],
      frameRate: 1,
    });
    this.anims.create({
      key: "run",
      frames: this.anims.generateFrameNumbers("hero", { start: 1, end: 2 }),
      frameRate: 8,
      repeat: -1,
    });
    this.anims.create({
      key: "jump",
      frames: [{ key: "hero", frame: 3 }],
      frameRate: 1,
    });

    this.player = this.physics.add.sprite(128, 560, "hero", 0);
    this.player.setScale(2);
    this.player.setCollideWorldBounds(true);
    this.player.setDragX(880);
    this.player.setMaxVelocity(310, 720);
    this.player.body.setSize(22, 48);
    this.player.body.setOffset(13, 14);
    this.player.play("idle");
  }

  createCollectibles() {
    this.shardGroup = this.physics.add.group({ allowGravity: false, immovable: true });
    shardSpawns.forEach(([x, y], index) => {
      const shard = this.shardGroup.create(x, y, "moonShard");
      shard.setScale(2);
      shard.setData("baseY", y);
      shard.setData("phase", index * 0.55);
      this.tweens.add({
        targets: shard,
        angle: 360,
        duration: 2400,
        repeat: -1,
      });
    });
  }

  createHazards() {
    this.hazardGroup = this.physics.add.group({ allowGravity: true });
    [
      [680, 510, 560, 780],
      [1375, 520, 1290, 1450],
      [1995, 490, 1900, 2110],
    ].forEach(([x, y, left, right], index) => {
      const hazard = this.hazardGroup.create(x, y, "shadowWisp");
      hazard.setScale(2);
      hazard.setBounce(1, 0);
      hazard.setCollideWorldBounds(true);
      hazard.setVelocityX(index % 2 === 0 ? 84 : -84);
      hazard.setData("left", left);
      hazard.setData("right", right);
      hazard.body.setSize(24, 18);
      hazard.body.setOffset(3, 4);
    });
  }

  createGoal() {
    const shrine = this.add.container(2460, 544);
    shrine.add(this.add.rectangle(0, 56, 92, 18, 0x2c2759));
    shrine.add(this.add.rectangle(0, 20, 52, 82, 0xf5f3ff));
    shrine.add(this.add.rectangle(0, -24, 72, 14, 0x6d61d3));
    shrine.add(this.add.rectangle(0, 12, 28, 54, 0x20213a));
    shrine.add(this.add.rectangle(0, -50, 8, 28, 0x9ee8ff));
    shrine.add(this.add.rectangle(-10, -39, 28, 6, 0x9ee8ff));
    shrine.add(this.add.rectangle(10, -39, 28, 6, 0x9ee8ff));

    this.goalZone = this.add.zone(2460, 532, 124, 156);
    this.physics.add.existing(this.goalZone, true);
  }

  createHud() {
    this.hud = document.querySelector("#game-hud");
    this.message = document.querySelector("#game-message");
    this.setMessage("收集 6 枚月晶，抵達右側星花神龕。");
    this.updateHud();
  }

  createControls() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.W,
      dash: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      restart: Phaser.Input.Keyboard.KeyCodes.R,
    });
  }

  createMobileControls() {
    this.touch = { left: false, right: false, jump: false, dash: false };
    document.querySelectorAll("[data-control]").forEach((button) => {
      const control = button.getAttribute("data-control");
      const set = (value) => {
        this.touch[control] = value;
      };
      button.addEventListener("pointerdown", () => set(true));
      button.addEventListener("pointerup", () => set(false));
      button.addEventListener("pointerleave", () => set(false));
      button.addEventListener("pointercancel", () => set(false));
    });
  }

  update(time) {
    if (!this.player || this.isComplete) {
      return;
    }

    const touchingGround = this.player.body.blocked.down || this.player.body.touching.down;
    const moveLeft = this.cursors.left.isDown || this.keys.left.isDown || this.touch.left;
    const moveRight = this.cursors.right.isDown || this.keys.right.isDown || this.touch.right;
    const jumpPressed = Phaser.Input.Keyboard.JustDown(this.cursors.space) || Phaser.Input.Keyboard.JustDown(this.keys.up);
    const dashPressed = Phaser.Input.Keyboard.JustDown(this.keys.dash) || this.touch.dash;

    if (moveLeft) {
      this.player.setAccelerationX(-980);
      this.player.setFlipX(true);
    } else if (moveRight) {
      this.player.setAccelerationX(980);
      this.player.setFlipX(false);
    } else {
      this.player.setAccelerationX(0);
    }

    if ((jumpPressed || this.touch.jump) && touchingGround) {
      this.player.setVelocityY(-455);
      this.touch.jump = false;
    }

    if (dashPressed && this.canDash) {
      this.canDash = false;
      this.player.setVelocityX(this.player.flipX ? -520 : 520);
      this.cameras.main.shake(90, 0.002);
      this.time.delayedCall(620, () => {
        this.canDash = true;
        this.touch.dash = false;
      });
    }

    if (!touchingGround) {
      this.player.play("jump", true);
    } else if (Math.abs(this.player.body.velocity.x) > 42) {
      this.player.play("run", true);
    } else {
      this.player.play("idle", true);
    }

    this.shardGroup.children.iterate((shard) => {
      shard.y = shard.getData("baseY") + Math.sin(time / 360 + shard.getData("phase")) * 7;
    });

    this.hazardGroup.children.iterate((hazard) => {
      const left = hazard.getData("left");
      const right = hazard.getData("right");
      if (hazard.x <= left) {
        hazard.setVelocityX(84);
      } else if (hazard.x >= right) {
        hazard.setVelocityX(-84);
      }
    });

    if (Phaser.Input.Keyboard.JustDown(this.keys.restart)) {
      this.scene.restart();
    }
  }

  collectShard(player, shard) {
    shard.disableBody(true, true);
    this.shards += 1;
    this.updateHud();
    this.setMessage(this.shards >= REQUIRED_SHARDS ? "月晶集齊了，前往星花神龕！" : "月晶共鳴中，繼續向右前進。");
    this.tweens.add({
      targets: player,
      scaleX: 2.16,
      scaleY: 2.16,
      duration: 90,
      yoyo: true,
    });
  }

  takeDamage() {
    if (this.player.getData("invulnerable")) {
      return;
    }
    this.vitality -= 1;
    this.updateHud();
    this.player.setData("invulnerable", true);
    this.player.setVelocity(-260, -300);
    this.cameras.main.shake(180, 0.006);
    this.setMessage(this.vitality > 0 ? "影霧碰到了你，短暫無敵中。" : "星花之力散盡，按 R 重新挑戰。");
    this.tweens.add({
      targets: this.player,
      alpha: 0.35,
      duration: 90,
      repeat: 7,
      yoyo: true,
      onComplete: () => {
        this.player.setAlpha(1);
        this.player.setData("invulnerable", false);
      },
    });

    if (this.vitality <= 0) {
      this.player.setTint(0x6f65d6);
      this.player.body.enable = false;
    }
  }

  tryFinish() {
    if (this.shards < REQUIRED_SHARDS) {
      this.setMessage(`還需要 ${REQUIRED_SHARDS - this.shards} 枚月晶才能啟動神龕。`);
      return;
    }
    this.isComplete = true;
    this.player.setVelocity(0, 0);
    this.player.play("idle", true);
    this.cameras.main.flash(600, 158, 232, 255);
    this.setMessage("通關！白羽星花使抵達月影神龕。按 R 可重新遊玩。");
    this.input.keyboard.once("keydown-R", () => this.scene.restart());
  }

  updateHud() {
    if (!this.hud) {
      return;
    }
    this.hud.innerHTML = `
      <span>月晶 ${this.shards}/${REQUIRED_SHARDS}</span>
      <span>生命 ${"◆".repeat(Math.max(this.vitality, 0))}${"◇".repeat(Math.max(3 - this.vitality, 0))}</span>
      <span>移動 A/D 或 ←/→</span>
      <span>跳躍 W/Space</span>
      <span>衝刺 Shift</span>
    `;
  }

  setMessage(text) {
    if (this.message) {
      this.message.textContent = text;
    }
  }
}
