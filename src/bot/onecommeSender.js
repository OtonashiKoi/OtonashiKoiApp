const ONECOMME_API_URL = process.env.ONECOMME_API_URL || "http://127.0.0.1:11180";
const ONECOMME_API = `${ONECOMME_API_URL}/api/comments`;

function makeId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

async function sendComment({ service = "postman", displayName = "系統", comment = "" } = {}) {
  // resolve service to an existing OneComme service id when possible
  let serviceId = String(service);
  let serviceName = String(service);
  let serviceWrite = false;
  try {
    const svcRes = await fetch(`${ONECOMME_API_URL}/api/services`);
    if (svcRes.ok) {
      const json = await svcRes.json();
      const services = Array.isArray(json)
        ? json
        : Array.isArray(json?.services)
          ? json.services
          : Array.isArray(json?.data)
            ? json.data
            : [];
      const found = services.find((s) => {
        if (!s) return false;
        const n = String(s.name || "").toLowerCase();
        const url = String(s.url || "").toLowerCase();
        const q = String(service).toLowerCase();
        if (s.id === service) return true;
        if (n.includes(q) || url.includes(q)) return true;
        if ((q === "yt" || q === "youtube") && url.includes("youtube")) return true;
        if ((q === "tw" || q === "twitch") && url.includes("twitch")) return true;
        return false;
      });
      if (found) {
        serviceId = found.id;
        serviceName = found.name || serviceName;
        serviceWrite = Boolean(found.write);
      }
    }
  } catch (_) {}

  const payload = {
    service: {
      id: serviceId,
      name: serviceName,
      write: serviceWrite,
      speech: false,
      persist: false
    },
    comment: {
      id: makeId("comment"),
      userId: makeId("user"),
      name: String(displayName),
      badges: [],
      profileImage: "",
      comment: String(comment),
      hasGift: false,
      isOwner: false,
      timestamp: Date.now()
    }
  };

  try {
    const res = await fetch(ONECOMME_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `OneComme API returned ${res.status}: ${text}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { sendComment };
