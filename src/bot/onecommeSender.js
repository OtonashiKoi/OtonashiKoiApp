const ONECOMME_API = "http://127.0.0.1:11180/api/comments";

function makeId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

async function sendComment({ service = "postman", displayName = "系統", comment = "" } = {}) {
  // resolve service to an existing OneComme service id when possible
  let serviceId = String(service);
  let serviceName = String(service);
  try {
    const svcRes = await fetch("http://127.0.0.1:11180/api/services");
    if (svcRes.ok) {
      const services = await svcRes.json();
      const found = services.find((s) => {
        if (!s) return false;
        const n = String(s.name || "").toLowerCase();
        const url = String(s.url || "").toLowerCase();
        const q = String(service).toLowerCase();
        return n.includes(q) || url.includes(q) || (s.id === service);
      });
      if (found) {
        serviceId = found.id;
        serviceName = found.name || serviceName;
      }
    }
  } catch (_) {}

  const payload = {
    service: {
      id: serviceId,
      name: serviceName,
      write: false,
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
