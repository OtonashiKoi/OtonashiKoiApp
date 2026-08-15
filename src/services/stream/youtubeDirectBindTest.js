const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

function isYoutubeDirectBindTester(discordId, allowedDiscordIds = []) {
  const target = String(discordId || "").trim();
  if (!target) return false;
  return allowedDiscordIds.some((id) => String(id || "").trim() === target);
}

function buildYoutubeDirectBindAuthorizeUrl({ clientId, redirectUri, state }) {
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.search = new URLSearchParams({
    client_id: String(clientId || "").trim(),
    redirect_uri: String(redirectUri || "").trim(),
    response_type: "code",
    scope: YOUTUBE_READONLY_SCOPE,
    access_type: "online",
    prompt: "consent select_account",
    state: String(state || "").trim()
  }).toString();
  return authorizeUrl;
}

module.exports = {
  YOUTUBE_READONLY_SCOPE,
  isYoutubeDirectBindTester,
  buildYoutubeDirectBindAuthorizeUrl
};
