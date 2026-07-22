/**
 * Desktop IPC bridge — wraps the existing preload-exposed bridge to
 * the Rust keychain plugin + Electron shell APIs. The renderer talks
 * only through this module so the rest of the renderer code stays
 * platform-agnostic.
 *
 * Wiring convention for the preload script (`apps/desktop/src/preload/`):
 *   - Expose `window.electronAPI` with methods `keychain.read|write|delete`
 *     bridging to the `keyring-store` crate's Tauri/Rust commands.
 *   - Expose `window.electronAPI.openExternal(url)` for `shell.openExternal`.
 *
 * If the preload isn't yet wired, the runtime falls back to a
 * localStorage-only store so the file can be imported during local
 * rendering of the desktop SSR shell. Real persistence requires the
 * preload + Rust bridge.
 */

export interface IpcBridge {
  keychainRead(key: string): Promise<string | null>;
  keychainWrite(key: string, value: string): Promise<void>;
  keychainDelete(key: string): Promise<void>;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: {
      keychain?: {
        read?: (key: string) => Promise<string | null>;
        write?: (key: string, value: string) => Promise<void>;
        delete?: (key: string) => Promise<void>;
      };
      openExternal?: (url: string) => Promise<void>;
    };
  }
}

const LS_PREFIX = "infinitecode.lsk.";

export const ipcBridge: IpcBridge = {
  async keychainRead(key) {
    if (typeof window !== "undefined" && window.electronAPI?.keychain?.read) {
      try {
        return await window.electronAPI.keychain.read(key);
      } catch {
        /* fall through */
      }
    }
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(LS_PREFIX + key);
  },
  async keychainWrite(key, value) {
    if (typeof window !== "undefined" && window.electronAPI?.keychain?.write) {
      try {
        await window.electronAPI.keychain.write(key, value);
        return;
      } catch {
        /* fall through */
      }
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_PREFIX + key, value);
    }
  },
  async keychainDelete(key) {
    if (typeof window !== "undefined" && window.electronAPI?.keychain?.delete) {
      try {
        await window.electronAPI.keychain.delete(key);
        return;
      } catch {
        /* fall through */
      }
    }
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(LS_PREFIX + key);
    }
  },
  async openExternal(url) {
    if (typeof window !== "undefined" && window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(url);
    } else if (typeof window !== "undefined") {
      // Local-dev fallback so dev-mode rendering still opens the URL
      // in a new tab (Bun/Electron bridge not loaded yet).
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
};
