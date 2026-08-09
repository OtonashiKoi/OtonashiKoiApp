# Monster Lineup v1 Design Spec

Updated: 2026-04-19

This spec locks the current 10-monster lineup (the selected concept board version, with top-left changed to slime), and provides a production-ready baseline for art + integration.

## 1) DB Mapping (Core 10)

> ⛔ **本表已作廢（2026-08-07 對照 DB 實查）**：十隻怪的 zone／等級／入場費／EXP／金幣皆與現況不符
>（例：小史(小) 現為 beginner Lv1／EXP 100／金 14；甲蟹 現為 mid Lv14／EXP 2800／金 166；入場費現一律 0）。
> 現況一律以 `docs/CURRENT_GAME_STATUS.md`（`npm run status:update` 產生）為準。以下僅存檔。
> §2 之後的美術/動畫/命名規範不涉數值，仍可參考。

| Slot | Monster Name | Monster ID | Zone | Level | Entry Fee | EXP | Gold |
|---|---|---|---|---:|---:|---:|---:|
| 01 | 小史(小) | `c39bdddd-a33d-4e34-8019-d17020a8083b` | normal | 3 | 5 | 200 | 800 |
| 02 | 哥布 | `f00fd7b1-9f57-4532-9901-f4d4d74f132d` | normal | 3 | 5 | 320 | 1000 |
| 03 | 小狼 | `a8ef443e-3a0d-4ccb-9290-d6394edaa59f` | normal | 6 | 5 | 270 | 900 |
| 04 | 石頭 | `2d226eea-934a-4787-8ff7-9f19d12ac590` | normal | 4 | 5 | 450 | 1200 |
| 05 | 大史(B) | `321a08e9-8fed-4a80-9526-b1f977fd9103` | normal | 7 | 10 | 800 | 3000 |
| 06 | 甲蟹 | `657afc88-c6db-4851-8c4c-50f225b18624` | mid | 12 | 45 | 1400 | 1968 |
| 07 | 牙牙狼 | `13f56b92-709e-42ff-87d2-e8f129ed9207` | mid | 12 | 43 | 1200 | 1722 |
| 08 | 巨巨 | `b9c226a8-ea33-41de-9c9b-be24824a9fb1` | mid | 14 | 70 | 2000 | 2952 |
| 09 | 黑暗弓手 | `f4bed595-74f8-493b-8551-9158f4b5381d` | mid | 14 | 50 | 1500 | 2064 |
| 10 | 米拉桑(B) | `517f9a27-f6f7-4251-8cf8-2140f02222c0` | mid | 15 | 150 | 3500 | 5904 |

## 2) Visual Identity Rules

- Overall style: detailed JRPG pixel-art (style C), soft painterly shading, strong silhouette readability.
- Top-left (`小史(小)`) is a small non-humanoid slime.
- `大史(B)` is the same slime family, larger body, crown element, elite presence.
- Keep species relationship clear:
- `小史(小)` and `大史(B)` share visual DNA (gel body shape, face language, highlight style).
- `小狼` and `牙牙狼` share wolf family design cues.
- Zone readability:
- `normal` monsters use brighter, cleaner local contrast.
- `mid` monsters use heavier shadow + deeper saturation.

## 3) Canvas / Scale Guide

- Target render box per monster: `256x256` (source art), then scale down in-game as needed.
- Relative size ranking (small -> large):
- `小史(小)` < `哥布` ~ `小狼` < `石頭` < `甲蟹` ~ `牙牙狼` < `黑暗弓手` < `巨巨` < `米拉桑(B)` ~= `大史(B)`
- Keep feet/base line aligned for lineup consistency.

## 4) Animation Spec (v1 Baseline)

Recommended action set:

| Action | Frames | FPS | Loop | Notes |
|---|---:|---:|---|---|
| idle | 6 | 8 | yes | breathing / body sway |
| attack | 8 | 10 | no | fast wind-up + impact |
| hit | 4 | 12 | no | short recoil |
| death | 10 | 8 | no | clear finish state |
| skill | 10 | 10 | no | strongest silhouette moment |

Species timing adjustments:

- Slime family (`小史(小)`, `大史(B)`): softer squash-stretch; +1 idle frame allowed.
- Wolf family (`小狼`, `牙牙狼`): higher anticipation in attack (first 2 frames emphasize crouch).
- Heavy units (`石頭`, `巨巨`): slower anticipation, stronger hit-stop feel.

## 5) Naming Convention

Use monster ID to avoid rename breakage:

- `assets/monster/generated/<monster_id>/idle/<monster_id>_idle_01.png`
- `assets/monster/generated/<monster_id>/attack/<monster_id>_attack_01.png`
- same for `hit/death/skill`

## 6) Integration Notes

- Keep DB `name` as display text; use `monster_id` as asset binding key.
- Do not bind by localized name only.
- New variants can be added as additive fields, e.g.:
- `artStyleVersion: "lineup_v1"`
- `assetSet: "generated_v1"`

