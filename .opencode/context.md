# Project Context

## Stack
- Desktop: apps/desktop — Electron + Vite + React19, bun
- Website: apps/website — Vite+React19, deployed to Vercel (tryinfinitecode.vercel.app)
- Agent backend: Rust crates/, compiled as infinitecode CLI

## What was done this session

### README cleanup
- Removed screenshots section + TOC link from README.md
- Fixed star-history link 7df-lab → AFS-Agentics in all 5 READMEs (en, zh-Hans, zh-Hant, ja, ru)
- Pushed as e2811cd

### Org rename 7df-lab → AFS-Agentics
- apps/desktop/src/main/compatibility.ts (install URL)
- apps/desktop/electron-builder.yml (publish owner)
- apps/desktop/scripts/desktop-package-config.test.ts (test assertion)
- Pushed as f09d9f7

### Adsterra Native Ads (current)
- apps/desktop/src/renderer/index.html — added Adsterra invoke.js script in <head>
- apps/desktop/src/renderer/components/chat/native-ad.tsx — new NativeAd component
- apps/desktop/src/renderer/components/chat/chat-view.tsx — NativeAd rendered after each chat turn in scroll feed
- Permanent in scroll feed, not conditional on AI working
- Pushed as f880aeb, 75a7b4d

### Monetag (added then removed)
- sw.js + ad tag added to website + desktop, then removed
- Reverted in ca78948

### Vercel deployments
- Website deployed multiple times

### Electron app
- Ran `bun run dev` successfully multiple times
- Background task running

## Pending
- Commit latest NativeAd interleaved change (after each turn)
- User wants ads after every new message
