# Project Context

## Ad Moderation Pipeline (DONE)
- `moderation.ts` — regex + zero-shot ML (DeBERTa, 25% threshold)
- Retry mechanism in `index.html` (hide → 45s → reload, max 3)
- All verified: 7 flagged, 8 pass, 0 FP

## Current Task: Multi-Adsterra Placements

### Goal
Wire 9 Adsterra placements → 9 Gravity slots so every slot has a native banner fallback.

### Placements (user created 8 new, now 9 total)
| # | Gravity Slot | Adsterra ID | Container ID |
|---|-------------|-------------|--------------|
| 1 | `above_response` | `pl30440053` | `dbffd4bb6aab1ead6bb05117a7263848` |
| 2 | `below_response` | `pl30440081` | `cca3b61cc8aaf5f2a02e0023bc5e7592` |
| 3 | `inline_response` | `pl30440084` | `bebbea40bd5b18c3eba3c47039f730cd` |
| 4 | `search_result` | `pl30440089` | `8f42a126aafc27189f56130789147df4` |
| 5 | `bottom_page` | `pl30440097` | `2094b8945c4daf9561b4e7286ec34a3d` |
| 6 | `sidebar` | `pl30440099` | `08de200ac6dd6880f5ec296310440f44` |
| 7 | `mid_response` | `pl30440151` | `af6c03f7f08ea5d178bcbc658eb02b06` |
| 8 | `mid_timeline` | `pl30440154` | `705d823e476483950dc21fafa431abf3` |
| 9 | `startup_overlay` | `pl30395772` (old) | `ba7ceb35501edf7bae9f9a9e268cb6ca` |

### TODO
1. Rewrite `AdsterraFallbackAd` — accept `placement` prop, load correct script + container
2. Remove old single invoke.js from `index.html`
3. Add `fallback` prop to Gravity components missing it
4. Wire `<AdsterraFallbackAd placement="..." />` to each slot

### Files to modify
- `src/renderer/components/chat/adsterra-fallback.tsx` — placement config + dynamic loading
- `src/renderer/index.html` — remove old invoke.js, update container ID in retry/moderation script
- `src/renderer/components/chat/gravity-ad.tsx` — add fallback to other components
- `src/renderer/components/chat/chat-view.tsx` — wire bottom_page fallback
- `src/renderer/components/chat/chat-turn.tsx` — wire mid_response, mid_timeline, inline
- `src/renderer/components/sidebar/app-sidebar-content.tsx` — wire sidebar
- `src/renderer/components/settings/settings-page.tsx` — wire sidebar + bottom_page
- `src/renderer/components/chat/mention-popover.tsx` — wire search_result
- `src/renderer/components/startup-overlay.tsx` — wire startup_overlay
