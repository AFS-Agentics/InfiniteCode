# Mission Context

## Current Status
Cloned https://github.com/7df-lab/devo.git and building/running the desktop app on macOS.
User wants to:
1. Run the Mac desktop app ✅ (launches, but had timeout issue)
2. Fix "Bundled Devo runtime not found" onboarding bug ✅ (increased execAsync timeout 5s→30s)
3. Rename "Devo" → "InfiniteCode" throughout the app 🔄 (in progress)

## Files Modified (Rename Devo→InfiniteCode)
- `apps/desktop/package.json` - productName
- `apps/desktop/electron-builder.yml` - productName, copyright, Linux desktop entry
- `apps/desktop/scripts/brand-electron-dev.mjs` - appName, bundleIdentifier
- `apps/desktop/src/main/index.ts` - appName, userData path
- `apps/desktop/src/main/tray.ts` - tooltip text
- `apps/desktop/src/main/quit-guard.ts` - dialog strings
- `apps/desktop/src/main/quit-guard.test.ts` - test strings
- `apps/desktop/src/main/devo-manager.ts` - client info title
- `apps/desktop/src/main/onboarding.ts` - provider label
- `apps/desktop/src/main/compatibility.ts` - user-facing message strings
- `apps/desktop/src/main/tray-menu.ts` - label strings
- `apps/desktop/src/main/tray-menu.test.ts` - test strings
- `apps/desktop/src/renderer/components/devo-wordmark.tsx` - aria-label, SVG text
- `apps/desktop/src/renderer/components/devo-splash-brand.tsx` - aria-label, brand text
- `apps/desktop/src/renderer/index.html` - title, splash screen text
- `apps/desktop/src/renderer/hooks/use-waiting-indicator.ts` - document title
- `apps/desktop/src/renderer/components/onboarding/steps/welcome-step.tsx` - heading, description
- `apps/desktop/src/renderer/components/onboarding/steps/environment-check-step.tsx` - check labels/messages
- `apps/desktop/src/renderer/components/onboarding/steps/provider-setup-step.tsx` - status messages
- `apps/desktop/src/renderer/components/onboarding/steps/complete-step.tsx` - completion message
- `apps/desktop/src/renderer/components/onboarding/steps/migration-preview-step.tsx` - provider label
- `apps/desktop/src/renderer/components/onboarding/steps/migration-offer-step.tsx` - provider label
- `apps/desktop/src/renderer/components/settings/setup-settings.tsx` - provider label
- `apps/desktop/src/renderer/components/settings/setup-settings.tsx` - provider label

## Bug Fix Applied
`apps/desktop/src/main/compatibility.ts:execAsync()`: timeout 5000→30000ms

## Pending Tasks
- More "Devo" string renames in renderer (server-settings.tsx, server-indicator.tsx, sidebar-folder-dialogs.tsx, themes.ts, connect-provider-dialog.tsx, notification-settings.tsx, migration-offer-step.tsx, etc.)
- Restart and verify the app shows "InfiniteCode" everywhere
- Install.sh script and Rust binary still named "devo" (binary name not changed)

## Key Technical Details
- Desktop app: Electron + Vite + React + TypeScript
- CLI backend: Rust binary (`devo-cli`) at `target/debug/devo`
- ACP protocol over stdio connects Electron frontend to Rust backend
- Onboarding uses `checkDesktopRuntime()` → `resolveDevoProgram()` → `checkDevoProgram()` → `execAsync("devo --version")`
- Binary path (dev mode): `checkoutRoot/../../target/debug/devo`
- Binary path (packaged): `resources/runtime/bin/devo`
