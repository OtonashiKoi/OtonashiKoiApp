const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const baselinePath = path.resolve(__dirname, "line-limit-baseline.json");
const baseline = require(baselinePath);
const projectRoot = path.resolve(__dirname, "..");
const updateBaseline = process.argv.includes("--update-baseline");

const legacyGrowthAllowance = Math.max(
  0,
  Number(config.engineering.legacyLineGrowthAllowance) || 0,
);
const legacyGrowthPercent = Math.max(
  0,
  Number(config.engineering.legacyLineGrowthPercent) || 0,
);

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      results.push(fullPath);
    }
  }

  return results;
}

const files = walk(path.resolve(__dirname, "..", "src"));
const rows = files.map((file) => ({
  file,
  lines: fs.readFileSync(file, "utf8").split(/\r?\n/).length,
  relative: path.relative(projectRoot, file).split(path.sep).join("/"),
}));

if (updateBaseline) {
  const nextBaseline = {};
  for (const row of rows.sort((a, b) => a.relative.localeCompare(b.relative))) {
    if (row.lines > config.engineering.lineHardLimit) {
      nextBaseline[row.relative] = row.lines;
    }
  }
  fs.writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  console.log(`[LineLimit] baseline updated: ${Object.keys(nextBaseline).length} legacy oversized file(s).`);
  process.exit(0);
}

const oversized = [];
const warningFiles = [];
const lowerBaselineCandidates = [];

for (const row of rows) {
  const { file, lines, relative } = row;
  const legacyBaseline = Number(baseline[relative]) || 0;
  if (legacyBaseline > 0 && lines < legacyBaseline) {
    lowerBaselineCandidates.push({ file, lines, legacyBaseline });
  }

  if (lines > config.engineering.lineHardLimit) {
    if (legacyBaseline > 0) {
      const allowedGrowth = Math.max(
        legacyGrowthAllowance,
        Math.ceil(legacyBaseline * legacyGrowthPercent / 100),
      );
      const legacyCeiling = legacyBaseline + allowedGrowth;
      if (lines <= legacyCeiling) {
        warningFiles.push({ file, lines, legacyBaseline, legacyCeiling });
      } else {
        oversized.push({ file, lines, legacyBaseline, legacyCeiling });
      }
    } else {
      oversized.push({ file, lines, legacyBaseline: 0, legacyCeiling: config.engineering.lineHardLimit });
    }
  } else if (lines > config.engineering.lineWarning) {
    warningFiles.push({ file, lines });
  }
}

for (const row of warningFiles) {
  const threshold = row.legacyBaseline
    ? `legacy baseline ${row.legacyBaseline}; temporary ceiling ${row.legacyCeiling}`
    : `warning ${config.engineering.lineWarning}`;
  console.warn(`[LineLimit] warning: ${row.file} has ${row.lines} lines (${threshold})`);
}

if (lowerBaselineCandidates.length > 0) {
  const saved = lowerBaselineCandidates.reduce((sum, row) => sum + row.legacyBaseline - row.lines, 0);
  console.warn(
    `[LineLimit] ratchet available: ${lowerBaselineCandidates.length} file(s) shrank by ${saved} line(s); `
    + "run npm run check:lines:update after accepting the change.",
  );
}

if (oversized.length > 0) {
  for (const row of oversized) {
    const kind = row.legacyBaseline
      ? `legacy baseline ${row.legacyBaseline} + allowance = ${row.legacyCeiling}`
      : `new-file limit ${config.engineering.lineHardLimit}`;
    console.error(`[LineLimit] ${row.file} has ${row.lines} lines (${kind})`);
  }
  process.exit(1);
}

console.log(
  `[LineLimit] pass: new files <= ${config.engineering.lineHardLimit}; `
  + `legacy files stayed within ${legacyGrowthAllowance} lines or ${legacyGrowthPercent}% growth.`,
);
