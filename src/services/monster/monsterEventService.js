const { AppError, ERROR_CODES } = require("../../shared/errors");

function normalizeZone(zone) {
  return zone === "mid" ? "mid" : "normal";
}

function normalizePriority(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function normalizeDurationSec(value, fallback = 12) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(300, Math.max(3, Math.floor(n)));
}

function normalizeTriggerMonsterSeq(value) {
  if (value === null || value === undefined || value === "" || value === "any") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
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

  async createEvent(fields = {}) {
    const now = new Date().toISOString();
    const event = {
      id: crypto.randomUUID(),
      zone: normalizeZone(fields.zone),
      name: String(fields.name || "").trim() || "怪物過場事件",
      message: String(fields.message || "").trim() || "事件進行中，請稍候…",
      triggerMonsterSeq: normalizeTriggerMonsterSeq(fields.triggerMonsterSeq),
      durationSec: normalizeDurationSec(fields.durationSec),
      priority: normalizePriority(fields.priority),
      enabled: fields.enabled !== false,
      createdAt: now,
      updatedAt: now
    };
    return this.repo.save(event);
  }

  async updateEvent(id, fields = {}) {
    const current = await this.repo.findById(id);
    if (!current) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `monster event not found: ${id}`, 404);
    }
    const next = {
      ...this._normalizeStoredEvent(current),
      updatedAt: new Date().toISOString()
    };
    if (fields.zone !== undefined) next.zone = normalizeZone(fields.zone);
    if (fields.name !== undefined) next.name = String(fields.name || "").trim() || next.name;
    if (fields.message !== undefined) next.message = String(fields.message || "").trim() || next.message;
    if (fields.triggerMonsterSeq !== undefined) next.triggerMonsterSeq = normalizeTriggerMonsterSeq(fields.triggerMonsterSeq);
    if (fields.durationSec !== undefined) next.durationSec = normalizeDurationSec(fields.durationSec, next.durationSec);
    if (fields.priority !== undefined) next.priority = normalizePriority(fields.priority, next.priority);
    if (fields.enabled !== undefined) next.enabled = Boolean(fields.enabled);
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
    return candidates.find((event) => event.triggerMonsterSeq == null || event.triggerMonsterSeq === Number(defeatedMonsterSeq)) || null;
  }

  _normalizeStoredEvent(row = {}) {
    return {
      id: row.id,
      zone: normalizeZone(row.zone),
      name: String(row.name || "").trim() || "怪物過場事件",
      message: String(row.message || "").trim() || "事件進行中，請稍候…",
      triggerMonsterSeq: normalizeTriggerMonsterSeq(row.triggerMonsterSeq),
      durationSec: normalizeDurationSec(row.durationSec),
      priority: normalizePriority(row.priority),
      enabled: row.enabled !== false,
      createdAt: row.createdAt || new Date().toISOString(),
      updatedAt: row.updatedAt || row.createdAt || new Date().toISOString()
    };
  }
}

module.exports = { MonsterEventService };
