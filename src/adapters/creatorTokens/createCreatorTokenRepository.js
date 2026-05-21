function normalizeCreatorToken(doc) {
  if (!doc) return null;
  return {
    provider: String(doc.provider || "").trim().toLowerCase(),
    accessToken: String(doc.accessToken || "").trim(),
    refreshToken: String(doc.refreshToken || "").trim(),
    scope: Array.isArray(doc.scope) ? doc.scope.map((s) => String(s).trim()).filter(Boolean) : [],
    tokenType: String(doc.tokenType || "Bearer").trim(),
    expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
    broadcasterUserId: String(doc.broadcasterUserId || "").trim() || null,
    broadcasterDisplayName: String(doc.broadcasterDisplayName || "").trim() || null,
    status: String(doc.status || "active").trim(),
    notes: String(doc.notes || "").trim() || null,
    lastRefreshedAt: doc.lastRefreshedAt ? new Date(doc.lastRefreshedAt).toISOString() : null,
    lastVerifiedAt: doc.lastVerifiedAt ? new Date(doc.lastVerifiedAt).toISOString() : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null
  };
}

function createCreatorTokenRepository({ collection }) {
  return {
    async get(provider) {
      const key = String(provider || "").trim().toLowerCase();
      if (!key) return null;
      const doc = await (await collection("creatorTokens")).findOne({ provider: key });
      return normalizeCreatorToken(doc);
    },

    async list() {
      const docs = await (await collection("creatorTokens"))
        .find({})
        .sort({ provider: 1 })
        .toArray();
      return docs.map(normalizeCreatorToken).filter(Boolean);
    },

    async save(token) {
      const doc = normalizeCreatorToken(token);
      if (!doc.provider) {
        throw new Error("creatorToken.provider is required");
      }
      const now = new Date().toISOString();
      // 把 createdAt 從 $set 拿掉，避免跟 $setOnInsert 衝突
      const { createdAt: _ignored, ...rest } = doc;
      const setDoc = { ...rest, updatedAt: now };
      await (await collection("creatorTokens")).updateOne(
        { provider: doc.provider },
        {
          $set: setDoc,
          $setOnInsert: { createdAt: now }
        },
        { upsert: true }
      );
      return { ...setDoc, createdAt: doc.createdAt || now };
    },

    async updateStatus(provider, patch) {
      const key = String(provider || "").trim().toLowerCase();
      if (!key) return null;
      const now = new Date().toISOString();
      const allowed = ["accessToken", "refreshToken", "expiresAt", "lastRefreshedAt", "lastVerifiedAt", "status", "notes", "scope"];
      const $set = { updatedAt: now };
      for (const k of allowed) {
        if (k in (patch || {})) $set[k] = patch[k];
      }
      await (await collection("creatorTokens")).updateOne(
        { provider: key },
        { $set }
      );
      return this.get(key);
    },

    async delete(provider) {
      const key = String(provider || "").trim().toLowerCase();
      if (!key) return { deletedCount: 0 };
      const res = await (await collection("creatorTokens")).deleteOne({ provider: key });
      return { deletedCount: res.deletedCount || 0 };
    }
  };
}

module.exports = {
  createCreatorTokenRepository,
  normalizeCreatorToken
};
