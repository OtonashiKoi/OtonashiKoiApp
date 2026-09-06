"use strict";

/**
 * 關鍵品質閘門的一鍵編排器。
 *
 * 這裡刻意列出正式認可的核心檢查，不掃描所有 scripts/test-*.js；
 * 許多舊腳本是資料診斷、人工維運或需要特定測試帳號，不能混進穩定基線。
 */
const { spawnSync } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const suites = [
  { script: "check", label: "語法、行數、文件" },
  { script: "check:sim", label: "職業模擬覆蓋" },
  { script: "test:job-contribution", label: "全職業貢獻覆蓋" },
  { script: "test:features", label: "核心資料與功能" },
  { script: "test:systems", label: "主要系統整合" },
  { script: "test:golden", label: "固定戰鬥快照" },
  { script: "test:combat-regressions", label: "戰鬥邏輯回歸" },
  { script: "test:shadow", label: "影舞者氣條" },
  { script: "test:solo-boss-account-limit", label: "單人王帳號限制" },
  { script: "test:stream-notifications", label: "直播通知" },
  { script: "test:ecpay-checkmac", label: "綠界雙版驗簽" },
];

const results = [];

for (const suite of suites) {
  const startedAt = Date.now();
  console.log(`\n═══ ${suite.label}｜npm run ${suite.script} ═══`);
  const result = spawnSync(npmCommand, ["run", suite.script], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 100) / 10;
  const ok = result.status === 0 && !result.error;
  results.push({ ...suite, ok, elapsedSeconds, status: result.status, error: result.error });
  console.log(`${ok ? "✅" : "❌"} ${suite.label}：${elapsedSeconds}s`);
}

console.log("\n═══ test:all summary ═══");
for (const row of results) {
  const detail = row.error ? ` (${row.error.message})` : row.status == null ? " (no exit status)" : "";
  console.log(`${row.ok ? "✅" : "❌"} ${row.script.padEnd(30)} ${row.elapsedSeconds}s${detail}`);
}

const failures = results.filter((row) => !row.ok);
if (failures.length > 0) {
  console.error(`\n❌ test:all：${failures.length}/${results.length} 組失敗`);
  process.exitCode = 1;
} else {
  console.log(`\n✅ test:all：${results.length}/${results.length} 組全部通過`);
}
