# Equipment Game

A starter implementation for a chest-opening RPG equipment game with Discord bot commands and web API.

## Quick Start

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies: `npm install`
3. Start app: `npm run dev`

## Discord Direct Test

1. Create a Discord application and bot in Discord Developer Portal.
2. Enable `applications.commands` scope for your bot invite.
3. Fill `.env` values:
  - `DISCORD_TOKEN`
  - `DISCORD_CLIENT_ID`
  - `DISCORD_GUILD_ID` (your test server id)
4. Register slash commands to your test guild:
  - `npm run discord:register`
5. Start bot + API:
  - `npm run discord:test`
6. In your Discord test server, run:
  - `/open-chest`
  - `/inventory`
  - `/profile`
  - `/fight-monster`

## Current Features

- Discord slash commands:
  - `/open-chest`
  - `/inventory`
  - `/profile`
  - `/share-loadout` (interactive panel with Discord buttons)
  - `/fight-monster`
- Local JSON persistence
- No backpack storage: chest rewards auto-equip only when stronger
- Basic web API for profile and leaderboard

## Next

- YouTube live event integration
- Discord OAuth + account linking
- Image generation for equipment sharing
