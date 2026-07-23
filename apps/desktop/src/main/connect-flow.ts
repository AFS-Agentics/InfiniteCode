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
 *      Login.tsx POSTs `{ user_code, access_token, refresh_token, user_id }`
 *      (creates authorization) — both target the same URL.
 *   3. shell.openExternal the website's Login page with the code
 *      carried as ?code=ABCD-EFGH.
 *   4. Poll /api/connect?user_code=... every 2s (max 5 min).
 *   5. On `authorized`, save the session via saveSession(), close
 *      the browser, and notify the renderer.
 *
 * Event delivery
 * --------------
 * `connect:success` / `connect:failed` / `connect:signed_out` MUST be
 * broadcast via `webContents.send` so the renderer's `ipcRenderer.on`
 * listeners in `preload/index.ts` actually fire. Using `ipcMain.emit`
 * here only fires main-process listeners (there are none) and silently
 * drops the events on the floor — leaving the sidebar stuck on
 * "Opening browser…" even after the row was claimed successfully.
 * Renderer-side `loadAuthFromMain` still runs as a fallback after
 * `startConnect()` resolves, but the explicit broadcast path is the
 * one the renderer subscribes to and the one that should work.
 */
import { shell, ipcMain, BrowserWindow } from "electron";
import { loadSession, saveSession, clearSession } from "../shared/supabase";

const POLL_MS = 2_000;
const POLL_MAX_MS = 5 * 60_000;
/** Hard ceiling on every individual fetch — much shorter than the poll
 *  loop deadline so a wedged Vercel rewrite / DNS / TLS session can't
 *  park the `while (Date.now() < deadline)` check on a stalled `await
 *  fetch(...)` (the deadline check only re-evaluates once the awaiting
 *  fetch resolves). 10 s is generous for a same-region Vercel hop. */
const POLL_FETCH_TIMEOUT_MS = 10_000;
/** Vercel cold-starts for the rewrite hop occasionally push the initial
 *  POST past 10 s, so we give the pre-insert a wider timeout. The args
 *  are still a hard cap (AbortController) regardless. */
const INITIAL_FETCH_TIMEOUT_MS = 15_000;
const WEBSITE_BASE = process.env.INFINITECODE_WEBSITE_URL ?? "https://tryinfinitecode.vercel.app";
const CONNECT_BASE = process.env.INFINITECODE_CONNECT_API_URL ?? WEBSITE_BASE;
// Unambiguous base32 — drops I/L/O/0/1 so users can't confuse codes.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Broadcast an event to every renderer window. Module-level
 * `activeWindow` was previously declared but never assigned, so the
 * old `activeWindow?.webContents.send("auth:ready", …)` line was dead
 * and the explicit event broadcasts never reached the renderer.
 *
 * Non-auth windows (settings, dialogs, modal sheets) also receive the
 * event but no-op on it — they only subscribe to channels via the
 * preload's `window.infinitecode.auth.*` namespace, which they don't
 * expose. So a blanket broadcast is intentional and harmless.
 */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

/**
 * Diagnostic tracing for the device-pairing flow. Each line is both
 * `console.log`'d (visible in the dev terminal where `bun run dev` was
 * started) AND forwarded to the renderer via `broadcast("connect-flow:log", line)`
 * so it also appears in `⌘⌥I` DevTools. The user can paste a single
 * transcript and we'll see exactly which step is the hang.
 *
 * Do not subscribe to `connect-flow:log` from anywhere that calls back
 * into the main process — console.log fanout only; no re-entry guard
 * exists in the broadcast helper today.
 */
function trace(step: string, fields: Record<string, unknown> = {}): void {
  const line = `[connect-flow] step=${step} ${Object.entries(fields)
    .map(([k, v]) => `${k}=${formatField(v)}`)
    .join(" ")}`;
  console.log(line);
  broadcast("connect-flow:log", line);
}

function formatField(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Error objects have non-enumerable props so JSON.stringify returns "{}".
  // Show the message when it's actually an Error.
  if (v instanceof Error) return v.message || String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Decode the `sub` claim from a Supabase access token's JWT.
 *
 * Supabase auth issues standard JWTs whose payload is base64url-encoded
 * JSON and always carries a `sub` claim equal to the auth.users UUID.
 * We extract it locally so we can populate `session.user.id` on the
 * desktop WITHOUT requiring the backend's `/api/connect` POST handler
 * to know about `user_id` at all (the BFF does that as well, but it
 * needs a redeploy — this works the moment the desktop binary is
 * rebuilt and ignores any backend staleness).
 *
 * Returns `undefined` on any decode / parse failure rather than
 * throwing — a malformed token shouldn't crash the sign-in flow,
 * it just falls through to the empty-id branch.
 */
function parseJwtSub(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    // Buffer tolerates both padded and unpadded base64 because we
    // explicitly add padding below for the odd-length-corner case.
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as {
      sub?: unknown;
    };
    return typeof json.sub === "string" && json.sub.length > 0
      ? json.sub
      : undefined;
  } catch {
    return undefined;
  }
}

function generateUserCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += USER_CODE_ALPHABET[Math.floor(Math.random() * USER_CODE_ALPHABET.length)];
  }
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Fetch with a hard abort timeout so a stuck connection never blocks
 *  `startConnect()` past its deadline. */
async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = POLL_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort pending-row pre-insert. Runs **fire-and-forget** so a
 * slow Vercel rewrite or DNS hiccup on the very first request can never
 * park `startConnect()` — that gate is exactly where the user-facing
 * "Opening browser…" hang originates. The website's pairDeviceWithSession
 * POST re-creates the row authoritatively when the user signs in, so a
 * failure here is recoverable; we just log it for triage.
 */
function requestPairingRowAsync(userCode: string): void {
  trace("pre-insert:start", { user_code: userCode });
  fetchWithTimeout(
    `${CONNECT_BASE}/api/connect`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: userCode }),
    },
    INITIAL_FETCH_TIMEOUT_MS,
  )
    .then((res) => {
      trace("pre-insert:done", {
        user_code: userCode,
        status: res.status,
        ok: res.ok,
      });
    })
    .catch((err) => {
      trace("pre-insert:error", {
        user_code: userCode,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}

async function pollUntilAuthorized(userCode: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at?: string;
  user_id?: string;
} | null> {
  const deadline = Date.now() + POLL_MAX_MS;
  let attempt = 0;
  trace("poll:start", { user_code: userCode, deadline_ms: POLL_MAX_MS });
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    attempt += 1;
    try {
      const res = await fetchWithTimeout(
        `${CONNECT_BASE}/api/connect?user_code=${encodeURIComponent(userCode)}`,
      );
      if (!res.ok) {
        if (attempt === 1 || attempt % 10 === 0) {
          trace("poll:tick", {
            user_code: userCode,
            attempt,
            status: res.status,
            note: "non-2xx, keep polling",
          });
        }
        continue;
      }
      const body = (await res.json()) as {
        status?: string;
        access_token?: string;
        refresh_token?: string;
        expires_at?: string;
        user_id?: string;
      };
      if (body.status === "authorized" && body.access_token && body.refresh_token) {
        trace("poll:authorized", {
          user_code: userCode,
          attempt,
          user_id_present: body.user_id != null,
          expires_at_present: body.expires_at != null,
        });
        return {
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          expires_at: body.expires_at,
          user_id: body.user_id,
        };
      }
      if (body.status === "expired" || body.status === "consumed") {
        trace("poll:terminated", {
          user_code: userCode,
          attempt,
          status: body.status,
        });
        return null;
      }
      if (attempt === 1 || attempt % 10 === 0) {
        trace("poll:tick", {
          user_code: userCode,
          attempt,
          status: body.status ?? "(missing)",
        });
      }
    } catch (err) {
      if (attempt === 1 || attempt % 10 === 0) {
        trace("poll:error", {
          user_code: userCode,
          attempt,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  trace("poll:timeout", { user_code: userCode, attempt });
  return null;
}

export async function startConnect(): Promise<{ user_code: string }> {
  const userCode = generateUserCode();
  trace("start", { user_code: userCode });
  // Insert the pending row server-side, fire-and-forget. See
  // requestPairingRowAsync — this used to be awaited and was the
  // primary cause of the "Opening browser…" hang on slow Vercel
  // edge cold-starts (the `await fetch` blocked `startConnect()` past
  // its poll deadline).
  requestPairingRowAsync(userCode);

  // Build the website URL.
  const url = new URL("/login", WEBSITE_BASE);
  url.searchParams.set("code", userCode);
  trace("open-browser:start", { url: url.toString() });

  // Open the system browser (Electron pops a new BrowserWindow only
  // if the operator doesn't already trust the protocol).
  await shell.openExternal(url.toString());
  trace("open-browser:done", { user_code: userCode });

  // Poll server-side; update renderer via IPC events.
  const tokens = await pollUntilAuthorized(userCode);
  if (!tokens) {
    trace("outcome:failed", { user_code: userCode });
    broadcast("connect:failed", { user_code: userCode });
    return { user_code: userCode };
  }

  // Map the website-format tokens to a Session the renderer can read.
  // We hand-build a Session-shaped payload because the route handler's
  // tokens don't carry email / provider / etc. — only the Supabase
  // browser client has those, and this main-process side has no live
  // auth context to ask. `as unknown as Session` keeps the typed
  // surface honest; reading session.user.email is guaranteed to be null.
  try {
    // userId priority:
    //   1. tokens.user_id (BFF's `route.ts` populates it when the
    //      /api/connect POST upsert writes user_id alongside the
    //      tokens — requires the BFF to be deployed with that fix.
    //   2. JWT `sub` claim on the access token (always present on
    //      Supabase-issued JWTs; gives the auth.users UUID without
    //      needing the backend to know about user_id at all).
    //   3. empty string fallback (renderer-side readPublicSession
    //      filters empty ids to `user: null` correctly, so a stale
    //      state still surfaces as "Sign in" instead of crashing).
    let userId = tokens.user_id ?? "";
    let userIdSource: "row" | "jwt-sub" | "fallback" = tokens.user_id
      ? "row"
      : "fallback";
    if (!userId) {
      const sub = parseJwtSub(tokens.access_token);
      if (sub) {
        userId = sub;
        userIdSource = "jwt-sub";
      }
    }
    const session = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_at
        ? Math.max(0, Math.floor((Date.parse(tokens.expires_at) - Date.now()) / 1000))
        : 3600,
      expires_at: tokens.expires_at ? Date.parse(tokens.expires_at) : Date.now() + 3600_000,
      token_type: "bearer" as const,
      user: {
        id: userId,
        email: null as string | null,
      },
    } as unknown as Parameters<typeof saveSession>[0];
    trace("save-session:start", {
      user_code: userCode,
      user_id_source: userIdSource,
      has_user_id: userId !== "",
    });
    await saveSession(session);
    trace("save-session:done", { user_code: userCode });
  } catch (err) {
    // Surface the persistence failure to the renderer so the user
    // can retry instead of seeing an indefinite "still waiting" UX.
    trace("save-session:error", {
      user_code: userCode,
      err: err instanceof Error ? err.message : String(err),
    });
    broadcast("connect:failed", {
      user_code: userCode,
      reason: err instanceof Error ? err.message : String(err),
    });
    return { user_code: userCode };
  }

  trace("outcome:success", { user_code: userCode });
  broadcast("connect:success", { user_code: userCode });
  return { user_code: userCode };
}

export async function signOutDesktop(): Promise<void> {
  await clearSession();
  broadcast("connect:signed_out", {});
}

// Register the IPC handlers once at app boot.
export function registerConnectIPC() {
  ipcMain.handle("auth:startConnect", async () => startConnect());
  ipcMain.handle("auth:signOut", async () => signOutDesktop());
  ipcMain.handle("auth:getSession", async () => readPublicSession());
  broadcast("auth:ready", {});
}

/**
 * Read the persisted session from the desktop keychain and return ONLY
 * the safe fields (user id + email) — never the access_token. This keeps
 * the renderer process free of token authority.
 */
async function readPublicSession(): Promise<{
  user: { id: string; email: string | null } | null;
  configured: boolean;
}> {
  // Token may be stale in localStorage; treat presence as "configured"
  // and let the renderer subscribe to onSignedOut for live updates.
  const configured = true;
  try {
    const session = await loadSession().catch(() => null);
    if (!session) return { user: null, configured };
    // Defensive: a session with no user identity (or an empty user id)
    // should NOT be surfaced as a real user row — normalize to null so
    // the IPC contract matches the renderer's expectations and any
    // direct caller of getSession() sees the same shape.
    const id = session.user?.id;
    if (!id) return { user: null, configured };
    return {
      user: {
        id,
        email: session.user?.email ?? null,
      },
      configured,
    };
  } catch {
    return { user: null, configured: false };
  }
}
