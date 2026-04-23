import Phaser from "phaser";
import "./style.css";
import { PlatformerScene } from "./scenes/PlatformerScene";

const config = {
  type: Phaser.CANVAS,
  parent: "game-root",
  width: 960,
  height: 540,
  backgroundColor: "#0b1025",
  pixelArt: true,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 980 },
      debug: false,
    },
  },
  scene: [PlatformerScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);

window.__equipmentPlatformerGame = game;
