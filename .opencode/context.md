# Project Context

## Status (Jul 22 2026)

### ✅ Fixed (uncommitted)
1. Response ads: removed `adsEnabled` flag, `isAdsDisabled()` only checks `historyTurnIds`
2. `suggest_followups` tool card: added SparklesIcon + "Suggesting" in `getToolInfo`, added label display in `getToolSubtitle`
3. Formatting cleanup in chat-turn.tsx ad blocks

### ⏭️ Next
- Git commit these ad fixes
- Push to origin/main

### Files changed (uncommitted)
- `apps/desktop/src/renderer/components/chat/chat-turn.tsx`
- `apps/desktop/src/renderer/components/chat/chat-tool-call.tsx`

### Other uncommitted changes (not ours)
- freebuff.rs → coordination.rs renames in crates/protocol, crates/server
