const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const baseline = require("./line-limit-baseline.json");
const projectRoot = path.resolve(__dirname, "..");

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
const oversized = [];
const warningFiles = [];

for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  const relative = path.relative(projectRoot, file).split(path.sep).join("/");
  if (lines > config.engineering.lineHardLimit) {
    const legacyBudget = Number(baseline[relative]) || 0;
    if (legacyBudget > 0 && lines <= legacyBudget) {
      warningFiles.push({ file, lines, legacyBudget });
    } else {
      oversized.push({ file, lines, legacyBudget });
    }
  } else if (lines > config.engineering.lineWarning) {
    warningFiles.push({ file, lines });
  }
}

for (const row of warningFiles) {
  const threshold = row.legacyBudget
    ? `legacy budget ${row.legacyBudget}; may not grow`
    : `warning ${config.engineering.lineWarning}`;
  console.warn(`[LineLimit] warning: ${row.file} has ${row.lines} lines (${threshold})`);
}

if (oversized.length > 0) {
  for (const row of oversized) {
    const limit = row.legacyBudget || config.engineering.lineHardLimit;
    console.error(`[LineLimit] ${row.file} has ${row.lines} lines (limit ${limit})`);
  }
  process.exit(1);
}

console.log(`[LineLimit] pass: new files <= ${config.engineering.lineHardLimit}; legacy oversized files did not grow.`);
