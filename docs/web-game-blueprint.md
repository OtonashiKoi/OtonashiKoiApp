# Web Game Blueprint

> ⛔ **歷史文件（2026-08-07 審計標記）**：本文批評的「tabbed utility shell」前端已被
> React 深色奇幻改版取代（repo `~/Documents/equipmentGAME-app`），文中多數問題已解決。僅存檔備查。

## Goal

Turn the current `player-web` app from a feature-complete companion UI into a game-like front end that gives players a strong first-minute fantasy, a clear next action, and visible progression.

## Current State

The project already has real game systems:

- Discord login and player identity
- Profile, attributes, and equipment
- Inventory, enhancement, and shop loops
- Combat zones, monster HP, rewards, and drops
- Chat and weekly quests

What feels weak today is not the system depth. It is the player-facing framing.

## Core Problem

The current front end behaves like a tabbed utility shell:

- The player sees features before they feel a role
- The homepage reads as a themed dashboard, not an adventure entry point
- Combat is functional, but the emotional lead-in is weak
- Progress exists, but the next objective is not staged dramatically enough

## Target Experience

When a player opens the app, the first 60 seconds should answer four questions immediately:

1. Who am I?
2. Where am I going next?
3. What is the threat right now?
4. What do I gain if I act now?

## Product Pillars

### 1. A strong first screen

The home screen should act like a game hub, not a menu.

It should show:

- the player's current identity and rank
- a recommended hunt or destination
- the active monster or current field pressure
- one dominant call to action

### 2. One visible progression chain

The player should always see a compact progression ladder:

- current level
- next level threshold
- active quest progress
- next unlock or stronger zone

### 3. Action before management

Management screens like inventory, profile, and shop are still important, but they should be downstream from action, not the emotional center of the app.

### 4. Short-session satisfaction

Each visit should make at least one of these outcomes obvious:

- finish one battle
- claim one reward
- equip one stronger item
- move one quest closer to completion
