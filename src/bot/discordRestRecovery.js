"use strict";

const { Agent } = require("undici");

const REST_AGENT_RESET_COOLDOWN_MS = 2000;
const DEFAULT_PROTECTION_MS = 5 * 60 * 1000;
const MAX_PROTECTION_MS = 24 * 60 * 60 * 1000;

let lastRestAgentResetAt = 0;
let discordRestProtectionUntil = 0;
let lastProtectionReason = "";

function isTransientDiscordNetworkError(error) {
  if (!error) return false;
  if (error?.code === 10062) return true;
  if (error instanceof AggregateError) return true;
  const code = error?.code || "";
  if (code === "UND_ERR_SOCKET" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return true;
  const status = Number(error?.status || error?.statusCode || 0);
  if (status >= 500 && status < 600) return true;
  return /GOAWAY|ConnectTimeout|getaddrinfo|Service Unavailable|Bad Gateway|Gateway Timeout/i.test(error?.message || "");
}

function resetDiscordRestAgent(client, reason = "network error") {
  const rest = client?.rest;
  if (!rest || typeof rest.setAgent !== "function") return false;

  const now = Date.now();
  if (now - lastRestAgentResetAt < REST_AGENT_RESET_COOLDOWN_MS) return false;
  lastRestAgentResetAt = now;

  const previousAgent = rest.agent;
  const nextAgent = new Agent({
    keepAliveTimeout: 10_000,
    keepAliveMaxTimeout: 30_000
  });

  rest.setAgent(nextAgent);
  if (previousAgent && previousAgent !== nextAgent && typeof previousAgent.close === "function") {
    previousAgent.close().catch((error) => {
      console.warn("[DiscordREST] previous agent close failed:", error?.message || error);
    });
  }

  console.warn(`[DiscordREST] reset REST agent after ${reason}`);
  return true;
}

function getRetryAfterMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1000 ? Math.round(n) : Math.round(n * 1000);
}

function enterDiscordRestProtection(reason = "rate limited", retryAfterMs = DEFAULT_PROTECTION_MS) {
  const duration = Math.min(
    MAX_PROTECTION_MS,
    Math.max(DEFAULT_PROTECTION_MS, getRetryAfterMs(retryAfterMs))
  );
  const until = Date.now() + duration;
  if (until <= discordRestProtectionUntil) return false;

  discordRestProtectionUntil = until;
  lastProtectionReason = reason;
  console.warn(
    `[DiscordREST] protection mode enabled for ${Math.ceil(duration / 1000)}s: ${reason}`
  );
  return true;
}

function markDiscordRestRateLimited(rateLimitData = {}) {
  const retryAfterMs = getRetryAfterMs(rateLimitData.retryAfter || rateLimitData.timeToReset);
  const scope = rateLimitData.scope || (rateLimitData.global ? "global" : "route");
  const route = rateLimitData.route || rateLimitData.url || "?";
  const reason = `rate limit scope=${scope} route=${route}`;

  if (rateLimitData.global || scope === "global" || retryAfterMs >= 60_000) {
    enterDiscordRestProtection(reason, retryAfterMs || DEFAULT_PROTECTION_MS);
  }
}

function markDiscordRestError(error, context = "discord request") {
  const retryAfterMs = getRetryAfterMs(error?.retry_after || error?.retryAfter);
  const status = error?.status || error?.statusCode || error?.code;
  const message = error?.message || "";
  if (status === 429 || /rate limit|too many requests|HTTP\/2 429/i.test(message)) {
    enterDiscordRestProtection(`${context}: ${message || status}`, retryAfterMs || DEFAULT_PROTECTION_MS);
  }
}

function isDiscordRestProtected() {
  return discordRestProtectionUntil > Date.now();
}

function getDiscordRestProtectionState() {
  const remainingMs = Math.max(0, discordRestProtectionUntil - Date.now());
  if (remainingMs <= 0) {
    return { active: false, remainingMs: 0, reason: "" };
  }
  return {
    active: true,
    remainingMs,
    reason: lastProtectionReason
  };
}

function shouldSkipOptionalDiscordSend(label = "optional send") {
  const state = getDiscordRestProtectionState();
  if (!state.active) return false;
  console.warn(
    `[DiscordREST] skip ${label}; protection remaining ${Math.ceil(state.remainingMs / 1000)}s (${state.reason})`
  );
  return true;
}

module.exports = {
  enterDiscordRestProtection,
  getDiscordRestProtectionState,
  isTransientDiscordNetworkError,
  isDiscordRestProtected,
  markDiscordRestError,
  markDiscordRestRateLimited,
  shouldSkipOptionalDiscordSend,
  resetDiscordRestAgent
};
