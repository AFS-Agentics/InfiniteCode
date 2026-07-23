/**
 * Device-pairing endpoint for the InfiniteCode website (tryinfinitecode.vercel.app).
 *
 * Hosts the public `/api/connect` endpoint that powers the desktop app's
 * "Sign in via website" device-pairing flow. Lives here — on the
 * *website* — rather than the InfiniteCodeBackend (admin) project:
 * the desktop ↔ website pairing is a purely client-side experience,
 * and the admin backend isn't involved. The website's `vercel.json`
 * used to rewrite `/api/connect` to `infinitecode-admin.vercel.app`,
 * but that routed every client sign-in through the admin deployment
 * which is wrong; we now serve this route on the website itself via
 * Vercel's serverless function convention (`/api/*.ts` at the project
 * root → auto-deployed as a function).
 *
 * Required environment variables (set in the Vercel project dashboard):
 *   - `SUPABASE_URL`               — same value the BFF uses
 *   - `SUPABASE_SERVICE_ROLE_KEY`  — same value the BFF uses
 *
 * Methods:
 *
 *   POST   /api/connect          body { user_code, access_token?, refresh_token?, user_id? }
 *     - If tokens are present → upsert the row to `status='authorized'`
 *       with `user_id` populated so the desktop's later GET can return a
 *       real id and the renderer-side `readPublicSession` doesn't filter
 *       the row out as `user: null`.
 *     - If only `user_code` is present → upsert with `ignoreDuplicates`
 *       so a repeat pre-insert is a no-op rather than overwriting an
 *       already-authorized row.
 *
 *   GET    /api/connect?user_code=… — atomic "claim-and-return": runs
 *     UPDATE … WHERE status='authorized' RETURNING so the tokens can
 *     only be handed out once even under concurrent polling. Selects
 *     `access_token, refresh_token, expires_at, user_id`.
 *
 *   DELETE /api/connect?user_code=… — best-effort cleanup if the
 *     desktop decided not to claim the row.
 *
 * Failure surface mirrors the BFF's original route: `{ stage, error, ... }`
 * with conditional `cause` (network TypeError) and `supabase` (PostgrestError)
 * fields so the desktop main-process can log meaningful triage data.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Pin Node 20 so the global Web Fetch types (Request/Response) are
// available natively — that's what lets us use the named exports
// GET/POST/DELETE with `Response` returns instead of the older
// VercelRequest/VercelResponse Express-style shape. Default Vercel
// Node 18 also accepts this, but Node 20 is the documented sweet spot.
export const runtime = "nodejs20.x";

// Server-side env only — never read VITE_* prefixed vars here. Those
// are convention for "expose to client bundle" and have no business
// anywhere near a service-role check.
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

let _admin: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function describeSupabaseError(err: { code?: string; message?: string; details?: string; hint?: string } | null) {
  if (!err) return {};
  const o: Record<string, unknown> = {};
  if (err.code) o.code = err.code;
  if (err.message) o.message = err.message;
  if (err.details) o.details = err.details;
  if (err.hint) o.hint = err.hint;
  return o;
}

function describeFailure(err: unknown): Record<string, unknown> {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code?: unknown; message?: string; details?: string; hint?: string };
    if (
      typeof e.code === "string" &&
      e.code.length >= 3 &&
      /[A-Z]/.test(e.code) &&
      (e.message || e.details || e.hint)
    ) {
      return { supabase: describeSupabaseError(e as { code?: string; message?: string; details?: string; hint?: string }) };
    }
  }
  if (err && typeof err === "object" && "cause" in (err as object)) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    if (cause) {
      return {
        cause: {
          code: cause.code,
          message: cause.message,
        },
      };
    }
  }
  if (err instanceof Error) {
    return { message: err.message };
  }
  return {};
}

type PostBody = {
  user_code?: string;
  access_token?: string;
  refresh_token?: string;
  user_id?: string;
};

export async function GET(req: Request): Promise<Response> {
  const sb = supabaseAdmin();
  if (!sb) return json(503, { error: "supabase_admin_unconfigured" });

  const url = new URL(req.url);
  const code = url.searchParams.get("user_code") ?? "";
  if (!code) return json(400, { error: "user_code_required" });

  try {
    // Atomic claim-and-return: a single UPDATE … RETURNING. Two
    // concurrent polls collide at the row level and only one observes
    // its own successful update.
    const result = await sb
      .from("device_pairing")
      .update({
        status: "consumed",
        consumed_at: new Date().toISOString(),
      })
      .eq("user_code", code)
      .eq("status", "authorized")
      .select("access_token,refresh_token,expires_at,user_id")
      .maybeSingle();

    if (result.error) {
      return json(500, {
        stage: "supabase-from-update-claim",
        ...describeFailure(result.error),
      });
    }
    if (!result.data) return json(200, { ok: true, status: "pending" });
    return json(200, {
      ok: true,
      status: "authorized",
      access_token: result.data.access_token,
      refresh_token: result.data.refresh_token,
      expires_at: result.data.expires_at,
      user_id: result.data.user_id,
    });
  } catch (err) {
    return json(500, {
      stage: "supabase-from-update-claim",
      ...describeFailure(err),
    });
  }
}

export async function POST(req: Request): Promise<Response> {
  const sb = supabaseAdmin();
  if (!sb) return json(503, { error: "supabase_admin_unconfigured" });

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return json(400, { error: "invalid_json_body" });
  }

  const code = body.user_code;
  if (!code) return json(400, { error: "missing_user_code" });

  try {
    // Authorize path (post sign-in). The pre-insert branch below mirrors
    // why `user_id` is now included — without it, the desktop's GET
    // would return NULL on this column and the renderer's
    // `readPublicSession` filtered out the saved session as
    // `user: null`, leaving the user stuck on the "Sign in" button.
    if (body.access_token && body.refresh_token) {
      const { error } = await sb.from("device_pairing").upsert(
        {
          user_code: code,
          access_token: body.access_token,
          refresh_token: body.refresh_token,
          user_id: body.user_id ?? null,
          status: "authorized",
        },
        { onConflict: "user_code" },
      );
      if (error) {
        return json(500, {
          stage: "supabase-from-upsert-authorized",
          ...describeFailure(error),
        });
      }
      return json(200, { ok: true });
    }

    // Pending path (desktop pre-insert): upsert with `ignoreDuplicates`
    // so it's a no-op if a same-code row already exists.
    const { error } = await sb.from("device_pairing").upsert(
      { user_code: code, status: "pending" },
      { onConflict: "user_code", ignoreDuplicates: true },
    );
    if (error) {
      return json(500, {
        stage: "supabase-from-upsert-pending",
        ...describeFailure(error),
      });
    }
    return json(200, { ok: true });
  } catch (err) {
    return json(500, {
      stage: "supabase-from-upsert",
      ...describeFailure(err),
    });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const sb = supabaseAdmin();
  if (!sb) return json(503, { error: "supabase_admin_unconfigured" });

  const url = new URL(req.url);
  const code = url.searchParams.get("user_code") ?? "";
  if (!code) return json(400, { error: "user_code_required" });
  try {
    const { error } = await sb
      .from("device_pairing")
      .delete()
      .eq("user_code", code);
    if (error) {
      return json(500, {
        stage: "supabase-from-delete",
        ...describeFailure(error),
      });
    }
    return json(200, { ok: true });
  } catch (err) {
    return json(500, {
      stage: "supabase-from-delete",
      ...describeFailure(err),
    });
  }
}
