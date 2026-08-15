"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const routeSource = fs.readFileSync(path.join(__dirname, "../src/api/routes/playerAppRoutes.js"), "utf8");

assert.match(routeSource, /activeTransition\?\.kind === "monster_switch"/, "Web 戰鬥回應沒有辨識換怪轉場");
assert.match(routeSource, /activeTransition\.nextMonsterSeq/, "Web 戰鬥回應仍只能讀到剛死亡的怪物序號");
assert.match(routeSource, /currentHp: Number\.isFinite\(transitionNextSeq\)[\s\S]*?transitionHp/, "轉場中的下一隻怪沒有立即回傳滿血狀態");
assert.match(routeSource, /activeMonsterSeq: visibleMonsterSeq/, "回傳的怪物序號沒有切到下一隻");

console.log("✅ Web 擊殺回應會立即帶回轉場已選定的下一隻怪");
