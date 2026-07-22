/**
 * Desktop main-process: opens the system browser to the website's
 * login page, polls the public API endpoint for the freshly authorized
 * device-pairing row, and writes the resulting Supabase tokens into
 * the OS keychain.
 *
 * Wired up from the renderer's "Sign in" CTA via IPC. The renderer
 * calls `auth.startConnect()` (already plumbed in the renderer store);
 * this module does the heavy lifting.
 *
 * Run flow:
 *   1. Generate a 8-char base32 user_code.
 *   2. Insert a `device_pairing` row in pending state via the
 *      public /api/connect endpoint (a thin wrapper on the
 *      `device_pairing` table — see apps/website/src/pages/api/connect).
 *      NOTE: the server discriminates by body shape, so the desktop
 *      POSTs only `{ user_code }` (creates pending) and the website
 *      Login.tsx POSTs `{ user_code, access_token, refresh_token }`
 *      (creates authorization) — both target the same URL.
 *   3. shell.openExternal the website's Login page with the code
 *      carried as ?code=ABCD-EFGH.
 *   4. Poll /api/connect?user_code=... every 2s (max 5 min).
 *   5. On `authorized`, save the session via saveSession(), close
 *      the browser, and notify the renderer.
 */
import { shell, ipcMain, BrowserWindow } from "electron";
import { saveSession, clearSession } from "../shared/supabase";

const POLL_MS = 2_000;
const POLL_MAX_MS = 5 * 60_000;
const WEBSITE_BASE = process.env.INFINITECODE_WEBSITE_URL ?? "https://tryinfinitecode.vercel.app";
const CONNECT_BASE = process.env.INFINITECODE_CONNECT_API_URL ?? WEBSITE_BASE;
// Unambiguous base32 — drops I/L/O/0/1 so users can't confuse codes.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateUserCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += USER_CODE_ALPHABET[Math.floor(Math.random() * USER_CODE_ALPHABET.length)];
  }
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

async function requestPairingRow(userCode: string): Promise<boolean> {
  try {
    const res = await fetch(`${CONNECT_BASE}/api/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: userCode }),
    });
    return res.ok;
  } catch {
    // best-effort — the website authorize path will still create
    // the row via the in-page Login.tsx handler even if the
    // pre-insert failed.
    return false;
  }
}

async function pollUntilAuthorized(userCode: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at?: string;
  user_id?: string;
} | null> {
  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const res = await fetch(`${CONNECT_BASE}/api/connect?user_code=${encodeURIComponent(userCode)}`);
      if (!res.ok) continue;
      const body = (await res.json()) as {
        status?: string;
        access_token?: string;
        refresh_token?: string;
        expires_at?: string;
        user_id?: string;
      };
      if (body.status === "authorized" && body.access_token && body.refresh_token) {
        return {
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          expires_at: body.expires_at,
          user_id: body.user_id,
        };
      }
      if (body.status === "expired" || body.status === "consumed") return null;
    } catch {
      /* keep polling */
    }
  }
  return null;
}

let activeWindow: BrowserWindow | null = null;

export async function startConnect(): Promise<{ user_code: string }> {
  const userCode = generateUserCode();
  // Insert the pending row server-side (best-effort).
  await requestPairingRow(userCode);

  // Build the website URL.
  const url = new URL("/login", WEBSITE_BASE);
  url.searchParams.set("code", userCode);

  // Open the system browser (Electron pops a new BrowserWindow only
  // if the operator doesn't already trust the protocol).
  await shell.openExternal(url.toString());

  // Poll server-side; update renderer via IPC events.
  const tokens = await pollUntilAuthorized(userCode);
  if (!tokens) {
    ipcMain.emit("connect:failed", { user_code: userCode });
    return { user_code: userCode };
  }

  // Map the website-format tokens to a Session the renderer can read.
  try {
    await saveSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_at
        ? Math.max(0, Math.floor((Date.parse(tokens.expires_at) - Date.now()) / 1000))
        : 3600,
      expires_at: tokens.expires_at ? Date.parse(tokens.expires_at) : Date.now() + 3600_000,
      token_type: "bearer",
      user: { id: tokens.user_id ?? "" } as any,
    } as any);
  } catch (err) {
    // Surface the persistence failure to the renderer so the user
    // can retry instead of seeing an indefinite "still waiting" UX.
    ipcMain.emit("connect:failed", {
      user_code: userCode,
      reason: err instanceof Error ? err.message : String(err),
    });
    return { user_code: userCode };
  }

  ipcMain.emit("connect:success", { user_code: userCode });
  return { user_code: userCode };
}

export async function signOutDesktop(): Promise<void> {
  await clearSession();
  ipcMain.emit("connect:signed_out", {});
}

// Register the IPC handlers once at app boot.
export function registerConnectIPC() {
  ipcMain.handle("auth:startConnect", async () => startConnect());
  ipcMain.handle("auth:signOut", async () => signOutDesktop());
  activeWindow?.webContents.send("auth:ready", {});
}
