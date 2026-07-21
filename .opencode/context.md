# Project Context

## Environment
- Rust 1.88 + Bun 1.3.10 + Electron 40.2.1

## Status (Jul 22 2026)

### ✅ Committed (origin/main)
1. `f723949` — SDK exports, Electron binary, ad CSS fixes
2. `13b56be` — A-Ads fallback: `a-ads-pill.tsx`, `adsterra-ad.tsx` (35s nofill→A-Ads)
3. `d0bee9c` — Startup 2×2 ad grid: `startup-ad-grid.tsx`, +4 grid placements, `startup-overlay.tsx`
4. `1e62f86` — Compact grid: remove gap, reduce px/mb
5. `ed0b7c7` — Remove `pb-3` spacing above `bottom_page` ad in chat-view

### 🔄 Uncommitted (latest edits)
- `adsterra-ad.tsx` — Added `overflow:hidden` wrapper div around iframe; srcdoc body `height:0; min-height:0`; ad pill `padding:4px 8px; gap:8px; min-height:40px`; image `28px`; font `11px`; border-radius `4px`
- `startup-overlay.tsx` — `mb-1 px-1` on grid wrapper

### 🟢 Running
- `bun run dev` (job_53ad898c) — HMR active, app live at localhost:1420

### Key Architecture
- Each ad = iframe with srcdoc (Adsterra invoke.js in isolated page)
- Fallback: 35s nofill → A-Ads direct iframe (`a-ads-pill.tsx`)
- Grid: 4 cells (`startup_grid_0..3`), each independent Adsterra→A-Ads fallback

### Pending
- Chrome UA spoofing in `src/main/index.ts` (uncommitted)
- Freebuff-style inline ads in chat responses (discussed, not prioritized)

[COMPACTION_COMPLETE]
