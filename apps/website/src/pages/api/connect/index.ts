/**
 * Server-side endpoint for the device-pairing flow.
 *
 * POST   /api/connect          body { user_code }       — create the
 *        pending row (the desktop calls this once before opening
 *        the system browser).
 *
 * POST   /api/connect/authorize body { user_code, access_token, refresh_token }
 *        — write the freshly-minted tokens into the pending row, set
 *        status='authorized' so the desktop polls them.
 *
 * GET    /api/connect?user_code=… — atomic "claim-and-return":
 *        runs UPDATE … WHERE status='authorized' RETURNING so the
 *        tokens can only be handed out once even under concurrent
 *        polling from two devices.
 *
 * DELETE /api/connect?user_code=… — best-effort cleanup if the
 *        desktop decided not to claim the row.
 *
 * All server-side mutations go through @/lib/supabase `'service-role'`
 * so RLS doesn't gate either the anon POST or the admin claim.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseAdmin } from "../../lib/supabase";

type Data =
  | { ok: true; status?: string; [key: string]: unknown }
  | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>,
) {
  const sb = getSupabaseAdmin();
  if (!sb) {
    res.status(503).json({ error: "supabase_admin_unconfigured" });
    return;
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as {
      user_code?: string;
      access_token?: string;
      refresh_token?: string;
    };
    const code = body.user_code;
    if (!code) {
      res.status(400).json({ error: "missing_user_code" });
      return;
    }
    if (!body.access_token || !body.refresh_token) {
      // Bare "create pending row" path — the desktop calls this once
      // before opening the browser. Insert if absent; ignore on conflict
      // so a re-click from the same desktop is a no-op.
      const { error } = await sb.from("device_pairing").insert({
        user_code: code,
        status: "pending",
      });
      if (error && !error.message.includes("duplicate")) {
        res.status(500).json({ error: error.message });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }
    // Authorize path -- UPSERT so a missing pre-insert row from
    // the desktop (network blip, 503, user opened browser first)
    // does not silently 0-row UPDATE us into a 5-min timeout.
    const { error } = await sb.from("device_pairing").upsert(
      {
        user_code: code,
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        status: "authorized",
      },
      { onConflict: "user_code" },
    );
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === "GET") {
    const code = String(req.query?.user_code ?? "");
    if (!code) {
      res.status(400).json({ error: "user_code_required" });
      return;
    }
    // ATOMIC claim-and-return: a single UPDATE ... RETURNING. Both
    // branches below do the same trick — there's no read-then-update,
    // so two concurrent polls collide at the row level and only one
    // observes its own successful update.
    const { data, error } = await sb
      .from("device_pairing")
      .update({
        status: "consumed",
        consumed_at: new Date().toISOString(),
      })
      .eq("user_code", code)
      .eq("status", "authorized")
      .select("access_token,refresh_token,expires_at,user_id")
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data) {
      // Either expired, still pending, or already consumed — let the
      // caller poll again unless they were looking for `consumed`
      // status.
      res.status(200).json({ ok: true, status: "pending" });
      return;
    }
    res.status(200).json({
      ok: true,
      status: "authorized",
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user_id: data.user_id,
    });
    return;
  }

  if (req.method === "DELETE") {
    const code = String(req.query?.user_code ?? "");
    if (!code) {
      res.status(400).json({ error: "user_code_required" });
      return;
    }
    await sb.from("device_pairing").delete().eq("user_code", code);
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  res.status(405).json({ error: "method_not_allowed" });
}
