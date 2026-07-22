/**
 * Desktop-side Supabase session store.
 *
 * Holds the access + refresh tokens in the OS keychain (via the
 * `keyring-store` crate, surfaced through Tauri's plugin layer) so
 * the Electron renderer can read them via IPC without ever putting
 * them in plain text on disk.
 *
 * The companion `apps/desktop/src/main/connect-flow.ts` opens the
 * system browser to https://tryinfinitecode.vercel.app/login?code=...
 * and reads the Supabase tokens back from /api/connect once the user
 * completes sign-in.
 */
import { createClient, type Session } from "@supabase/supabase-js";
import { ipcBridge } from "./ipc-bridge";

const KEYCHAIN_KEY = "infinitecode.supabase.session.v1";

let _cached: Session | null = null;

/** Read the persisted session from the OS keychain (via Rust IPC). */
export async function loadSession(): Promise<Session | null> {
  if (_cached) return _cached;
  const raw = await ipcBridge.keychainRead(KEYCHAIN_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    _cached = session;
    return session;
  } catch {
    return null;
  }
}

/** Persist a fresh session to the OS keychain. */
export async function saveSession(session: Session): Promise<void> {
  _cached = session;
  await ipcBridge.keychainWrite(KEYCHAIN_KEY, JSON.stringify(session));
}

/** Clear the cached + persisted session (logout). */
export async function clearSession(): Promise<void> {
  _cached = null;
  await ipcBridge.keychainDelete(KEYCHAIN_KEY);
}

/** Browser client bound to the persisted session, for live Supabase
 *  calls from the Electron renderer (profile reads, etc.). */
export async function getDesktopSupabase() {
  const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) return null;
  const session = await loadSession();
  const sb = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
    },
    ...(session
      ? {
          global: {
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
        }
      : {}),
  });
  return sb;
}
