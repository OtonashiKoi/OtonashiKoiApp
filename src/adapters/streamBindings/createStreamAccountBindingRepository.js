const DEFAULT_REMOTE_TIMEOUT_MS = 10_000;

function normalizeBinding(binding) {
  if (!binding) return null;
  const memberRoleIdsAtLink = Array.isArray(binding.memberRoleIdsAtLink)
    ? binding.memberRoleIdsAtLink.map((id) => String(id).trim()).filter(Boolean)
    : typeof binding.memberRoleIdsAtLink === "string" && binding.memberRoleIdsAtLink.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(binding.memberRoleIdsAtLink);
            return Array.isArray(parsed) ? parsed.map((id) => String(id).trim()).filter(Boolean) : [];
          } catch (_) {
            return [];
          }
      })()
      : [];
  const linkedSupportBadgeLabelsAtLink = Array.isArray(binding.linkedSupportBadgeLabelsAtLink)
    ? binding.linkedSupportBadgeLabelsAtLink.map((label) => String(label).trim()).filter(Boolean)
    : typeof binding.linkedSupportBadgeLabelsAtLink === "string" && binding.linkedSupportBadgeLabelsAtLink.trim()
      ? binding.linkedSupportBadgeLabelsAtLink.split("|").map((label) => String(label).trim()).filter(Boolean)
      : [];

  return {
    platform: String(binding.platform || "").trim().toLowerCase(),
    platformUserId: String(binding.platformUserId || binding.platform_user_id || "").trim(),
    discordId: String(binding.discordId || binding.discord_id || "").trim(),
    displayName: String(binding.displayName || binding.display_name || "").trim(),
    linkedAt: binding.linkedAt || binding.linked_at || new Date().toISOString(),
    playerTierAtLink: binding.playerTierAtLink || binding.player_tier_at_link || null,
    memberRoleIdsAtLink,
    linkedSupportAtLink: typeof binding.linkedSupportAtLink === "boolean" ? binding.linkedSupportAtLink : null,
    linkedSupportKindAtLink: String(binding.linkedSupportKindAtLink || binding.linked_support_kind_at_link || "").trim() || null,
    linkedSupportBadgeLabelsAtLink,
    updatedAt: binding.updatedAt || binding.updated_at || null
  };
}

function createLocalStreamAccountBindingRepository({ collection }) {
  return {
    async findByPlatformAndUserId(platform, platformUserId) {
      if (!platform || !platformUserId) return null;
      return (await collection("streamAccountBindings")).findOne({ platform, platformUserId });
    },
    async findByDiscordAndPlatform(discordId, platform) {
      if (!discordId || !platform) return null;
      return (await collection("streamAccountBindings")).findOne({ discordId, platform });
    },
    async listByDiscordId(discordId) {
      if (!discordId) return [];
      return (await collection("streamAccountBindings"))
        .find({ discordId })
        .sort({ linkedAt: 1, updatedAt: 1 })
        .toArray();
    },
    async listAll() {
      return (await collection("streamAccountBindings"))
        .find({})
        .sort({ platform: 1, linkedAt: 1 })
        .toArray();
    },
    async save(binding) {
      const doc = normalizeBinding(binding);
      if (!doc.platform || !doc.platformUserId || !doc.discordId) {
        throw new Error("Invalid stream binding payload");
      }

      await (await collection("streamAccountBindings")).updateOne(
        { platform: doc.platform, platformUserId: doc.platformUserId, discordId: doc.discordId },
        { $set: doc },
        { upsert: true }
      );
      return doc;
    },
    async deleteByDiscordId(discordId) {
      if (!discordId) return { deletedCount: 0 };
      return await (await collection("streamAccountBindings")).deleteMany({ discordId });
    }
  };
}

function createRemoteStreamAccountBindingRepository() {
  const baseUrl = String(process.env.STREAM_BINDING_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const token = String(process.env.STREAM_BINDING_API_TOKEN || "").trim();

  if (!baseUrl) return null;

  async function requestJson(path, { method = "GET", body = null } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DEFAULT_REMOTE_TIMEOUT_MS)
    });

    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
    if (!res.ok) {
      const message = typeof data === "object" && data
        ? data.message || data.error || data.detail
        : String(data || `${res.status} ${res.statusText}`);
      throw new Error(message || `${res.status} ${res.statusText}`);
    }
    return data;
  }

  return {
    async findByPlatformAndUserId(platform, platformUserId) {
      if (!platform || !platformUserId) return null;
      const data = await requestJson(`/api/bindings/by-platform/${encodeURIComponent(platform)}/${encodeURIComponent(platformUserId)}`);
      return normalizeBinding(data?.binding || data);
    },
    async findByDiscordAndPlatform(discordId, platform) {
      if (!discordId || !platform) return null;
      const data = await requestJson(`/api/bindings/by-discord/${encodeURIComponent(discordId)}?platform=${encodeURIComponent(platform)}`);
      return normalizeBinding(data?.binding || data);
    },
    async listByDiscordId(discordId) {
      if (!discordId) return [];
      const data = await requestJson(`/api/bindings/by-discord/${encodeURIComponent(discordId)}`);
      const rows = Array.isArray(data?.bindings) ? data.bindings : Array.isArray(data) ? data : [];
      return rows.map(normalizeBinding).filter(Boolean);
    },
    async listAll() {
      const data = await requestJson(`/api/bindings`);
      const rows = Array.isArray(data?.bindings) ? data.bindings : Array.isArray(data) ? data : [];
      return rows.map(normalizeBinding).filter(Boolean);
    },
    async save(binding) {
      const doc = normalizeBinding(binding);
      if (!doc.platform || !doc.platformUserId || !doc.discordId) {
        throw new Error("Invalid stream binding payload");
      }
      const data = await requestJson(`/api/bindings/upsert`, {
        method: "POST",
        body: doc
      });
      return normalizeBinding(data?.binding || doc);
    },
    async deleteByDiscordId(discordId) {
      if (!discordId) return { deletedCount: 0 };
      const data = await requestJson(`/api/bindings/by-discord/${encodeURIComponent(discordId)}`, {
        method: "DELETE"
      });
      return { deletedCount: Number(data?.deletedCount || 0) };
    }
  };
}

function createStreamAccountBindingRepository({ collection }) {
  return createRemoteStreamAccountBindingRepository() || createLocalStreamAccountBindingRepository({ collection });
}

module.exports = {
  createStreamAccountBindingRepository,
  normalizeBinding
};
