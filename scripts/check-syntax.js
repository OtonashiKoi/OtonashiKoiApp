const fs = require("fs");
const path = require("path");

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
      continue;
    }

    if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

const root = path.resolve(__dirname, "..");
const groups = [
  { dir: path.join(root, "src"), module: false },
  { dir: path.join(root, "scripts"), module: false },
  { dir: path.join(root, "workers"), module: true },
];

for (const group of groups) {
  if (!fs.existsSync(group.dir)) continue;
  for (const file of walk(group.dir)) {
    if (group.module && file.endsWith(".js")) {
      require("child_process").execFileSync(
        process.execPath,
        ["--input-type=module", "--check"],
        { input: fs.readFileSync(file), stdio: ["pipe", "inherit", "inherit"] },
      );
    } else {
      require("child_process").execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
    }
  }
}
