import Phaser from "phaser";
import "./style.css";
import { CloneBattleScene } from "./scenes/CloneBattleScene";

const config = {
  type: Phaser.AUTO,
  parent: "game-root",
  width: 1365,
  height: 768,
  backgroundColor: "#0a1c1e",
  scene: [CloneBattleScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);

