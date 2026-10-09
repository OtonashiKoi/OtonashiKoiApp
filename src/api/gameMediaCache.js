"use strict";

const MEDIA_FILE = /\.(?:png|jpe?g|webp|gif|avif|svg|ico|mp3|m4a|wav|ogg|aac)$/i;

/** Only public static media may enter the shared CDN cache. */
function setGameMediaCacheHeaders(res, filePath) {
  if (!MEDIA_FILE.test(filePath)) return false;
  const url = new URL(res.req?.originalUrl || "/", "http://localhost");
  const revision = url.searchParams.get("gameMediaRevision") || url.searchParams.get("gameImageRevision");
  const versioned = /^[a-f0-9]{64}$/.test(revision || "");
  res.setHeader("Cache-Control", versioned
    ? "public, max-age=31536000, s-maxage=31536000, immutable"
    : "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400");
  return true;
}

module.exports = { setGameMediaCacheHeaders };
