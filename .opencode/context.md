# Project Context

## Current Mission
Integrate Gravity Ads into InfiniteCode Desktop (Electron) — replacing Adsterra.

## Environment
- Project: InfiniteCode (monorepo, Rust core + Electron desktop + Next.js website)
- Desktop: `apps/desktop/` — Electron app (React 19, TypeScript)
- Build: `bun run dev` (Vite dev server on `localhost:1420`)
- PM: `bun`
- Agent instructions: `AGENTS.md` at root

## Completed Work
### ✅ Ad provider switch
- Replaced Adsterra with Gravity Ads (`trygravity.ai`) — committed to `main`
- Adsterra `<NativeAd />` usages removed from `chat-view.tsx` (imports removed, component stubs remain)

### ✅ Gravity pixel installed
- `gr-pix.js` pixel script injected in `apps/desktop/src/renderer/index.html` `<head>`
- Account: `47f43d70-7338-44da-b13c-74165ad4b1fb`

### ✅ Packages installed
- `@gravity-ai/api@1.1.8` — main process (ad fetching)
- `@gravity-ai/react@1.1.8` — renderer (ad display)

### ✅ IPC bridge wired
- `src/preload/index.ts`: `gravity.getAds(messages) → ipcRenderer.invoke("gravity:get-ads")`
- `src/preload/api.d.ts`: Gravity bridge type `gravity.getAds() → Promise<Record<string, unknown>[]>`
- `src/main/ipc-handlers.ts`: Imports `gravityAds` from `@gravity-ai/api`, registers `ipcMain.handle("gravity:get-ads")` — calls Gravity API with mock req + messages + placements

### ✅ GravityAd component created
- `src/renderer/components/chat/gravity-ad.tsx` — fetches ad via IPC, renders with `<GravityAd>` from SDK

### ✅ GravityAd imported in chat-view.tsx
- Import added to `chat-view.tsx`

## Pending Work
- [ ] **Replace NativeAd usages** — `<NativeAd />` is still referenced at lines 1081/1090 of chat-view.tsx. Replace both with `<GravityAd messages={...} />`
- [ ] **Create adMessages helper** — compute `{ role, content }[]` from `turns` for Gravity contextual matching
- [ ] **Stale files** — delete `native-ad.tsx` and `banner-ad.tsx`
- [ ] **Verify** — kill + restart Electron dev server, confirm no build errors and banner renders

## Key Files
| File | Status |
|------|--------|
| `src/preload/index.ts` | ✅ bridge added |
| `src/preload/api.d.ts` | ✅ types added |
| `src/main/ipc-handlers.ts` | ✅ handler added |
| `src/renderer/components/chat/gravity-ad.tsx` | ✅ component created |
| `src/renderer/components/chat/chat-view.tsx` | 🟡 import added, NativeAd references remain |
| `src/renderer/components/chat/native-ad.tsx` | ❌ to delete |
| `src/renderer/components/chat/banner-ad.tsx` | ❌ to delete |
| `src/renderer/index.html` | ✅ pixel added |

## Notes
- Gravity API key is read from `process.env.GRAVITY_API_KEY` (not set yet — test ads work w/o key)
- Test ads: `production: false` in dev (`!app.isPackaged`), `production: true` in prod
- `gravityAds()` never throws — always resolves with `{ ads, status, elapsed, requestBody, error? }`
- `@gravity-ai/react` `<GravityAd>` accepts `AdResponse | null` and renders card/inline/banner/etc variants
