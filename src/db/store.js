const fs = require("fs/promises");
const path = require("path");
const config = require("../config");

const defaultData = {
  users: {},
  youtubeLinks: {},
  meta: { updatedAt: new Date().toISOString() }
};

async function ensureFile() {
  const filePath = config.dataPath;
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2), "utf-8");
  }
}

async function readData() {
  await ensureFile();
  const raw = await fs.readFile(config.dataPath, "utf-8");
  return JSON.parse(raw);
}

async function writeData(data) {
  data.meta.updatedAt = new Date().toISOString();
  await fs.writeFile(config.dataPath, JSON.stringify(data, null, 2), "utf-8");
}

module.exports = {
  readData,
  writeData
};
