CREATE TABLE IF NOT EXISTS stream_account_bindings (
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL,
  player_tier_at_link TEXT,
  member_role_ids_at_link TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (platform, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_stream_account_bindings_discord_id
  ON stream_account_bindings(discord_id);

CREATE INDEX IF NOT EXISTS idx_stream_account_bindings_discord_platform
  ON stream_account_bindings(discord_id, platform);
