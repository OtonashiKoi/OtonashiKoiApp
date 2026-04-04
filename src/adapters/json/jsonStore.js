const fs = require("fs/promises");
const path = require("path");
const config = require("../../config");

const INITIAL_DATA = {
  schemaVersion: 1,
  accessControl: {
    discord: {
      adminRoleIds: [],
      adminUserIds: [],
      playerRoleIds: [],
      playerUserIds: []
    }
  },
  channelLayout: {
    discord: {
      bindings: []
    }
  },
  players: {},
  wallets: {},
  progress: {},
  transactions: [],
  adminActionLogs: [],
  checkins: []
};

function normalizeStore(data) {
  const next = data && typeof data === "object" ? data : {};
  if (typeof next.schemaVersion !== "number") next.schemaVersion = INITIAL_DATA.schemaVersion;
  if (!next.accessControl || typeof next.accessControl !== "object") next.accessControl = {};
  if (!next.accessControl.discord || typeof next.accessControl.discord !== "object") {
    next.accessControl.discord = { adminRoleIds: [], adminUserIds: [], playerRoleIds: [], playerUserIds: [] };
  }
  if (!Array.isArray(next.accessControl.discord.adminRoleIds)) next.accessControl.discord.adminRoleIds = [];
  if (!Array.isArray(next.accessControl.discord.adminUserIds)) next.accessControl.discord.adminUserIds = [];
  if (!Array.isArray(next.accessControl.discord.playerRoleIds)) next.accessControl.discord.playerRoleIds = [];
  if (!Array.isArray(next.accessControl.discord.playerUserIds)) next.accessControl.discord.playerUserIds = [];
  if (!next.channelLayout || typeof next.channelLayout !== "object") next.channelLayout = {};
  if (!next.channelLayout.discord || typeof next.channelLayout.discord !== "object") {
    next.channelLayout.discord = { bindings: [] };
  }
  if (!Array.isArray(next.channelLayout.discord.bindings)) next.channelLayout.discord.bindings = [];
  if (!next.players || typeof next.players !== "object") next.players = {};
  if (!next.wallets || typeof next.wallets !== "object") next.wallets = {};
  if (!next.progress || typeof next.progress !== "object") next.progress = {};
  if (!Array.isArray(next.transactions)) next.transactions = [];
  if (!Array.isArray(next.adminActionLogs)) next.adminActionLogs = [];
  if (!Array.isArray(next.checkins)) next.checkins = [];
  return next;
}

async function ensureStoreFile() {
  await fs.mkdir(path.dirname(config.storage.jsonDataPath), { recursive: true });

  try {
    await fs.access(config.storage.jsonDataPath);
  } catch {
    await fs.writeFile(config.storage.jsonDataPath, JSON.stringify(INITIAL_DATA, null, 2), "utf8");
  }
}

async function readStore() {
  await ensureStoreFile();
  const raw = await fs.readFile(config.storage.jsonDataPath, "utf8");
  if (!raw.trim()) {
    await writeStore(INITIAL_DATA);
    return normalizeStore({ ...INITIAL_DATA });
  }

  return normalizeStore(JSON.parse(raw));
}

async function writeStore(data) {
  const normalized = normalizeStore(data);
  await fs.writeFile(config.storage.jsonDataPath, JSON.stringify(normalized, null, 2), "utf8");
}

module.exports = {
  INITIAL_DATA,
  normalizeStore,
  readStore,
  writeStore
};