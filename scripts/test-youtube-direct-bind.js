const assert = require("node:assert/strict");
const {
  YOUTUBE_READONLY_SCOPE,
  isYoutubeDirectBindTester,
  buildYoutubeDirectBindAuthorizeUrl
} = require("../src/services/stream/youtubeDirectBindTest");

assert.equal(isYoutubeDirectBindTester("865264891991425055", ["865264891991425055"]), true);
assert.equal(isYoutubeDirectBindTester("other", ["865264891991425055"]), false);
assert.equal(isYoutubeDirectBindTester("", ["865264891991425055"]), false);

const url = buildYoutubeDirectBindAuthorizeUrl({
  clientId: "client.apps.googleusercontent.com",
  redirectUri: "https://otonashikoi.org/api/stream-auth/callback/youtube",
  state: "signed-state"
});

assert.equal(url.origin, "https://accounts.google.com");
assert.equal(url.pathname, "/o/oauth2/v2/auth");
assert.equal(url.searchParams.get("client_id"), "client.apps.googleusercontent.com");
assert.equal(url.searchParams.get("redirect_uri"), "https://otonashikoi.org/api/stream-auth/callback/youtube");
assert.equal(url.searchParams.get("response_type"), "code");
assert.equal(url.searchParams.get("scope"), YOUTUBE_READONLY_SCOPE);
assert.equal(url.searchParams.get("access_type"), "online");
assert.equal(url.searchParams.get("prompt"), "consent select_account");
assert.equal(url.searchParams.get("state"), "signed-state");

console.log("YouTube direct-bind test passed");
