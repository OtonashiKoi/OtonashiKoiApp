const STREAM_LIVE_TTL_MS = 3 * 60 * 1000;
const ACTOR_TTL_MS = 5 * 60 * 1000;

const state = {
  lastCommentAt: 0,
  actors: new Map(),
};

function buildActorKey(comment) {
  const service = String(comment?.service || "stream").toLowerCase();
  const userId = String(comment?.userId || "").trim();
  const fallbackName = String(comment?.name || "viewer").trim().toLowerCase();
  return `${service}:${userId || fallbackName}`;
}

function prune(now = Date.now()) {
  for (const [key, actor] of state.actors.entries()) {
    if ((now - actor.lastSeenAt) > ACTOR_TTL_MS) {
      state.actors.delete(key);
    }
  }
}

function recordComment(comment) {
  const now = Date.now();
  const key = buildActorKey(comment);
  const current = state.actors.get(key);

  state.lastCommentAt = now;
  state.actors.set(key, {
    id: key,
    name: comment?.name || current?.name || "Viewer",
    service: comment?.service || current?.service || "stream",
    userId: comment?.userId || current?.userId || "",
    joinedAt: current?.joinedAt || now,
    lastSeenAt: now,
    messageCount: (current?.messageCount || 0) + 1,
    lastMessage: comment?.text || current?.lastMessage || "",
  });

  prune(now);
  return getSnapshot(now);
}

function getSnapshot(now = Date.now()) {
  prune(now);

  const actors = [...state.actors.values()]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((actor) => ({
      ...actor,
      joinedAt: new Date(actor.joinedAt).toISOString(),
      lastSeenAt: new Date(actor.lastSeenAt).toISOString(),
    }));

  return {
    isLive: (now - state.lastCommentAt) <= STREAM_LIVE_TTL_MS,
    lastCommentAt: state.lastCommentAt ? new Date(state.lastCommentAt).toISOString() : null,
    viewerCount: actors.length,
    actors,
  };
}

module.exports = {
  recordComment,
  getSnapshot,
};
