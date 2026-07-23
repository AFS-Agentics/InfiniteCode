/**
 * Desktop IPC bridge — gives the renderer session-safe access to:
 *   - OS-keychain-backed secret storage via `keychain*` (routes through
 *     `window.infinitecode.credential.{get,store,delete}` — typed in
 *     `apps/desktop/src/preload/api.d.ts` and implemented by
 *     `apps/desktop/src/main/credential-store.ts` using Electron's
 *     `safeStorage`).
 *   - System browser opening via `openExternal` (uses
 *     `window.electronAPI.openExternal` if the preload exposes it,
 *     plus a `window.open` fallback for the browser-only dev/SSR
 *     render path).
 *
 * Renderer code calls only this module so it stays platform-agnostic.
 * The `window.infinitecode` type itself lives in
 * `apps/desktop/src/preload/api.d.ts` and is intentionally NOT
 * redeclared here — extending it (e.g. with a new keychain method)
 * should happen in `api.d.ts` so all consumers stay in sync.
 *
 * In the browser-only dev/SSR render path (no Electron preload wired),
 * the keychain calls fall back to namespaced `localStorage` entries;
 * that fallback is intentionally non-durable and should never run in
 * production.
 */

export interface IpcBridge {
  keychainRead(key: string): Promise<string | null>;
  keychainWrite(key: string, value: string): Promise<void>;
  keychainDelete(key: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    /**
     * Optional/legacy `electronAPI` window property — only present
     * when an older preload exposes it. `window.infinitecode`
     * (the canonical bridge) is declared in
     * `apps/desktop/src/preload/api.d.ts` and NOT redeclared here.
     */
    electronAPI?: {
      openExternal?: (url: string) => Promise<void>;
    };
  }
}

const LS_PREFIX = "infinitecode.lsk.";

function ls(): Storage | null {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

export const ipcBridge: IpcBridge = {
  async keychainRead(key) {
    // Production: Electron preload -> main process credential-store
    // (safeStorage encryption; macOS Keychain / Windows DPAPI / Linux libsecret).
    if (typeof window !== "undefined") {
      try {
        const v = await window.infinitecode?.credential?.get(key);
        return v ?? null;
      } catch {
        /* fall through to dev fallback */
      }
    }
    const storage = ls();
    if (!storage) return null;
    return storage.getItem(LS_PREFIX + key);
  },

  async keychainWrite(key, value) {
    if (typeof window !== "undefined") {
      try {
        await window.infinitecode?.credential?.store(key, value);
        return;
      } catch {
        /* fall through */
      }
    }
    const storage = ls();
    if (storage) storage.setItem(LS_PREFIX + key, value);
  },

  async keychainDelete(key) {
    if (typeof window !== "undefined") {
      try {
        await window.infinitecode?.credential?.delete(key);
        return;
      } catch {
        /* fall through */
      }
    }
    const storage = ls();
    if (storage) storage.removeItem(LS_PREFIX + key);
  },

  async openExternal(url) {
    if (typeof window !== "undefined" && window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(url);
      return;
    }
    // Dev-mode fallback (Bun/Electron bridge not loaded yet).
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
};
