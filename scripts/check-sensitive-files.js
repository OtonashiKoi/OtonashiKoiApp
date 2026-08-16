const { execFileSync } = require("node:child_process");
const path = require("node:path");

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const sensitiveSubject = /(member|support|binding|player|progress|wallet|transaction|checkin|invite)/i;
const dumpMarker = /(backup|dump|snapshot|export)/i;
const dataExtension = /\.(bson|json|csv|tsv|xlsx)$/i;

const violations = tracked.filter((file) => {
  const normalized = file.replaceAll("\\", "/");
  const base = path.posix.basename(normalized);
  return normalized.startsWith("exports/")
    || normalized.startsWith("backups/")
    || normalized.startsWith("~/")
    || normalized.endsWith(".bson")
    || normalized.endsWith(".metadata.json")
    || normalized.includes("/__pycache__/")
    || normalized.endsWith(".pyc")
    || base === ".DS_Store"
    || /deleted_backup/i.test(base)
    || (dataExtension.test(base) && sensitiveSubject.test(normalized) && dumpMarker.test(normalized));
});

if (violations.length) {
  console.error("Sensitive or generated files are tracked by Git:");
  for (const file of violations) console.error(`- ${file}`);
  console.error("Move these files to a private backup directory before committing.");
  process.exit(1);
}

console.log(`sensitive-file guard: ${tracked.length} tracked paths checked`);
