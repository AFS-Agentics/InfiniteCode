# Project Context

## Stack
- Monorepo: apps/ (desktop, docs, website), crates/ (Rust agent backend)
- Website: apps/website — Vite+React19+Tailwindv4+ShadCN, deployed to Vercel
- Agent backend: Rust binary (infinitecode CLI) — native, cannot run in WebContainer

## New Mission: Actual InfiniteCode Web version
- Build apps/web: real web client (chat + terminal + file tree)
- Backend: Node WebSocket server that spawns the infinitecode CLI in a sandbox and streams I/O
- Wire "Try on Web" button -> deployed web app URL
- Deploy frontend to Vercel; backend needs a host with the CLI installed

## Notes
- WebContainer approach REJECTED: CLI is native Rust, won't run in-browser
- Use backend WS server + web UI instead
