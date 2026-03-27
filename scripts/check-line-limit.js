const fs = require("fs");
const path = require("path");
const config = require("../src/config");

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
  if (lines > config.engineering.lineHardLimit) {
    oversized.push({ file, lines });
  } else if (lines > config.engineering.lineWarning) {
    warningFiles.push({ file, lines });
  }
}

for (const row of warningFiles) {
  console.warn(`[LineLimit] warning: ${row.file} has ${row.lines} lines (warning ${config.engineering.lineWarning})`);
}

if (oversized.length > 0) {
  for (const row of oversized) {
    console.error(`[LineLimit] ${row.file} has ${row.lines} lines (limit ${config.engineering.lineHardLimit})`);
  }
  process.exit(1);
}

console.log(`[LineLimit] all files are within ${config.engineering.lineHardLimit} lines.`);