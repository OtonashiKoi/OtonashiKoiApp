const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MonsterService } = require("../src/services/monster/monsterService");
const { runClaimAuthorityChecks } = require("./test-monster-kill-claim-authority");

async function main() {
  let liveState = {
    activeMonsterSeq: 1,
    currentHp: 7335,
    activeTransition: null,
    activeEvent: null
  };
  const repository = {
    async saveStateIfActiveMonster(next, _zone, expectedSeq, expectedHp) {
      if (
        Number(liveState.activeMonsterSeq) !== Number(expectedSeq) ||
        Number(liveState.currentHp) !== Number(expectedHp) ||
        liveState.activeTransition ||
        liveState.activeEvent ||
        Number(liveState.currentHp) <= 0
      ) return false;
      liveState = next;
      return true;
    }
  };
  const service = new MonsterService(repository, null);

  // 舊怪戰鬥尚未結束時，另一位玩家已換出 35 HP 中金。
  liveState = { activeMonsterSeq: 500, currentHp: 35, activeTransition: null, activeEvent: null };
  const staleSaved = await service.saveStateIfActiveMonster(
    { activeMonsterSeq: 1, currentHp: 7335 },
    "mid",
    1,
    7335
  );
  assert.equal(staleSaved, false, "換怪後的舊戰鬥結果必須拒絕");
  assert.deepEqual(liveState, { activeMonsterSeq: 500, currentHp: 35, activeTransition: null, activeEvent: null });

  // 同一隻怪、同一版血量才允許寫入；同怪並發扣血造成版本變動也必須重讀重試。
  const currentSaved = await service.saveStateIfActiveMonster(
    { ...liveState, currentHp: 20 },
    "mid",
    500,
    35
  );
  assert.equal(currentSaved, true, "目前怪物的相符版本應可寫入");
  assert.equal(liveState.currentHp, 20);
  const outdatedHpSaved = await service.saveStateIfActiveMonster(
    { ...liveState, currentHp: 30 },
    "mid",
    500,
    35
  );
  assert.equal(outdatedHpSaved, false, "同怪的過期血量版本也不得覆蓋新結果");
  assert.equal(liveState.currentHp, 20);

  const routeSource = fs.readFileSync(
    path.join(__dirname, "../src/api/routes/playerAppRoutes.js"),
    "utf8"
  );
  const guardSource = fs.readFileSync(
    path.join(__dirname, "../src/services/monster/monsterStateRaceGuard.js"),
    "utf8"
  );
  assert.match(routeSource, /boundedMonsterCurrentHp\(state, activeMonster\)/, "區域快照必須限制顯示血量上限");
  assert.match(guardSource, /saveStateIfActiveMonster\([\s\S]*?freshState\.currentHp/, "網頁戰鬥結算必須使用血量版本 CAS");

  await runClaimAuthorityChecks();
  console.log("monster state race guard: 7 checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
