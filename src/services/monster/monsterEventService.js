const { AppError, ERROR_CODES } = require("../../shared/errors");
const { normalizeZone } = require("../../shared/zones");

function normalizePriority(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function normalizeDurationSec(value, fallback = 12) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(600, Math.max(1, Math.floor(n)));
}

function normalizeTriggerMonsterSeq(value) {
  if (value === null || value === undefined || value === "" || value === "any") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function normalizeEffect(raw = {}) {
  const type = String(raw.type || "none").trim() || "none";
  const payload = raw.payload && typeof raw.payload === "object" ? raw.payload : {};
  return { type, payload };
}

function normalizeOption(raw = {}, idx = 0) {
  const id = String(raw.id || `opt_${idx + 1}`).trim() || `opt_${idx + 1}`;
  const fallbackLabel = `\u9078\u9805 ${idx + 1}`;
  const label = String(raw.label || raw.text || fallbackLabel).trim() || fallbackLabel;
  const npcReply = String(raw.npcReply || "").trim();
  const nextNodeId = raw.nextNodeId == null || raw.nextNodeId === "" ? null : String(raw.nextNodeId);
  const effects = Array.isArray(raw.effects) ? raw.effects.map(normalizeEffect) : [];
  const condition = raw.condition && typeof raw.condition === 'object' ? raw.condition : undefined;
  return { id, label, npcReply, nextNodeId, effects, condition };
}

function normalizeNode(raw = {}, idx = 0) {
  const id = String(raw.id || (idx === 0 ? "start" : `node_${idx + 1}`)).trim() || (idx === 0 ? "start" : `node_${idx + 1}`);
  const text = String(raw.text || "").trim();
  const options = Array.isArray(raw.options) ? raw.options.map((opt, i) => normalizeOption(opt, i)) : [];
  return { id, text, options };
}

function normalizeNpc(raw = {}) {
  return {
    name: String(raw.name || "\u795e\u79d8 NPC").trim() || "\u795e\u79d8 NPC",
    imageUrl: raw.imageUrl || null,
    imageThumbnailUrl: raw.imageThumbnailUrl || null
  };
}

class MonsterEventService {
  constructor(monsterEventRepository) {
    this.repo = monsterEventRepository;
  }

  async listEvents({ zone = null, includeDisabled = true } = {}) {
    const rows = await this.repo.findAll();
    let list = rows.map((row) => this._normalizeStoredEvent(row));
    if (zone) {
      const zoneKey = normalizeZone(zone);
      list = list.filter((event) => event.zone === zoneKey);
    }
    if (!includeDisabled) {
      list = list.filter((event) => event.enabled);
    }
    return list.sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
  }

  async getEventById(id) {
    const row = await this.repo.findById(id);
    if (!row) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `monster event not found: ${id}`, 404);
    }
    return this._normalizeStoredEvent(row);
  }

  async createEvent(fields = {}) {
    const now = new Date().toISOString();
    const event = this._normalizeStoredEvent({
      id: crypto.randomUUID(),
      zone: fields.zone,
      name: fields.name,
      message: fields.message,
      triggerMonsterSeq: fields.triggerMonsterSeq,
      durationSec: fields.durationSec,
      priority: fields.priority,
      enabled: fields.enabled,
      npc: fields.npc,
      nodes: fields.nodes,
      createdAt: now,
      updatedAt: now
    });
    return this.repo.save(event);
  }

  async updateEvent(id, fields = {}) {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `monster event not found: ${id}`, 404);
    }
    const prev = this._normalizeStoredEvent(current);
    const next = this._normalizeStoredEvent({
      ...prev,
      ...fields,
      npc: fields.npc !== undefined ? fields.npc : prev.npc,
      nodes: fields.nodes !== undefined ? fields.nodes : prev.nodes,
      updatedAt: new Date().toISOString()
    });
    return this.repo.save(next);
  }

  async updateEventNpcImage(id, { imageUrl = null, imageThumbnailUrl = null } = {}) {
    const current = await this.getEventById(id);
    const next = {
      ...current,
      npc: {
        ...current.npc,
        imageUrl,
        imageThumbnailUrl
      },
      updatedAt: new Date().toISOString()
    };
    return this.repo.save(next);
  }

  async deleteEvent(id) {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `monster event not found: ${id}`, 404);
    }
    await this.repo.delete(id);
  }

  async pickEventForTransition({ zone, defeatedMonsterSeq }) {
    const candidates = await this.listEvents({ zone, includeDisabled: false });
    const pool = (candidates || []).filter((event) => event.triggerMonsterSeq == null || event.triggerMonsterSeq === Number(defeatedMonsterSeq));
    if (!pool.length) return null;
    // Use `chance` as a weight similar to monsters' `spawnRate`.
    const total = pool.reduce((s, e) => s + (Number(e.chance) || 0), 0);
    if (total <= 0) {
      // fallback: return first match
      return pool[0] || null;
    }
    let r = Math.random() * total;
    for (const e of pool) {
      r -= (Number(e.chance) || 0);
      if (r <= 0) return e;
    }
    return pool[pool.length - 1] || null;
  }

  _normalizeStoredEvent(row = {}) {
    const nodesRaw = Array.isArray(row.nodes) ? row.nodes : null;
    const legacyMessage = String(row.message || "").trim();
    const defaultMessage = "\u4e8b\u4ef6\u9032\u884c\u4e2d\uff0c\u8acb\u9078\u64c7\u3002";
    const nodes = nodesRaw && nodesRaw.length
      ? nodesRaw.map((node, idx) => normalizeNode(node, idx))
      : [normalizeNode({ id: "start", text: legacyMessage || defaultMessage, options: [] }, 0)];

    return {
      id: row.id,
      zone: normalizeZone(row.zone),
      name: String(row.name || "NPC \u4e8b\u4ef6\u6a21\u677f").trim() || "NPC \u4e8b\u4ef6\u6a21\u677f",
      message: legacyMessage || nodes[0]?.text || defaultMessage,
      triggerMonsterSeq: normalizeTriggerMonsterSeq(row.triggerMonsterSeq),
      durationSec: normalizeDurationSec(row.durationSec),
      priority: normalizePriority(row.priority),
      enabled: row.enabled !== false,
      npc: normalizeNpc(row.npc || {}),
      nodes,
      createdAt: row.createdAt || new Date().toISOString(),
      updatedAt: row.updatedAt || row.createdAt || new Date().toISOString()
    };
  }
}

module.exports = { MonsterEventService };
