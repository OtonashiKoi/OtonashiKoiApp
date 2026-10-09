"use strict";

/** Redirect public HTTP page loads before CORS checks their module/CSS requests. */
function createCanonicalOriginRedirect(publicBaseUrl) {
  let canonical = null;
  try {
    const url = new URL(publicBaseUrl);
    if (url.protocol === "https:") canonical = url;
  } catch { /* An unset public URL must not change local development requests. */ }

  return (req, res, next) => {
    if (!canonical || !["GET", "HEAD"].includes(req.method)) return next();
    const host = String(req.headers.host || "").toLowerCase();
    if (host !== canonical.host) return next();
    // cloudflared reaches Express over HTTP even for secure public requests.
    const forwarded = String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0].trim().toLowerCase();
    const protocol = forwarded || req.protocol;
    if (protocol !== "http") return next();
    return res.redirect(308, `${canonical.origin}${req.originalUrl}`);
  };
}

module.exports = { createCanonicalOriginRedirect };
