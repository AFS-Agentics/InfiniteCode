# Project Context

## Mission
Integrate Gravity Ads into InfiniteCode Desktop (Electron) — replacing Adsterra. **COMPLETE.**

## Completed
- Gravity pixel (`gr-pix.js`) in `index.html` with account `47f43d70-7338-44da-b13c-74165ad4b1fb`
- `@gravity-ai/api@1.1.8` + `@gravity-ai/react@1.1.8` installed
- IPC bridge: `preload/index.ts` → `gravity.getAds(messages)`
- Types: `api.d.ts` → `gravity.getAds() → Promise<Record<string, unknown>[]>`
- Handler: `ipc-handlers.ts` → `gravity:get-ads` uses `gravityAds()` with mock req
- Component: `gravity-ad.tsx` → fetches ad via IPC, renders `<GravityAd>` from SDK
- `chat-view.tsx` → import GravityAd, replace NativeAd (2 spots), `useMemo` extracts last 4 messages
- Stale files deleted: `native-ad.tsx`, `banner-ad.tsx`
- `dotenv` installed, `import "dotenv/config"` in `main/index.ts` loads `.env`
- `apps/desktop/.env` with API key `AgZpo3FWHQALSbuKioVDkLpWXqUJBnD81goUnhS2ujo`
- `.gitignore` updated with `.env`
- Build verified: `tsc --noEmit` zero errors
- **Committed** to `main` as `67f436e` (13 files, +219/-564)
- `bun run dev` built and launched successfully (SIGTERM from timeout, not a crash)

## Key Files
| File | Status |
|------|--------|
| `src/main/index.ts` | ✅ dotenv import added |
| `src/main/ipc-handlers.ts` | ✅ gravity:get-ads handler |
| `src/preload/index.ts` | ✅ bridge wired |
| `src/preload/api.d.ts` | ✅ types added |
| `src/renderer/components/chat/gravity-ad.tsx` | ✅ new component |
| `src/renderer/components/chat/chat-view.tsx` | ✅ GravityAd wired |
| `apps/desktop/.env` | ✅ API key set |
| `.gitignore` | ✅ .env added |

## To Run
```bash
cd apps/desktop && bun run dev
```
Test ads appear below last chat response. Real ads need `app.isPackaged === true`.
