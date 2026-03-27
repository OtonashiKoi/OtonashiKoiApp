const fs = require("fs");
const path = require("path");

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

for (const file of walk(path.resolve(__dirname, "..", "src"))) {
  require("child_process").execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}