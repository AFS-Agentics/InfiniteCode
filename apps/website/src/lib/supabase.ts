/**
 * Shared Supabase client for the public website
 * (https://tryinfinitecode.vercel.app/).
 *
 * Same project as the InfiniteCodeBackend admin panel so a single
 * auth identity works across the website, the desktop app, the CLI, and
 * the BFF admin UI.
 *
 * Reads the same `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * (Vite-prefixed for the website) env vars the BFF does — never hard-code them.
 */
import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabase() {
  if (_client) return _client;
  const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) return null;
  _client = createBrowserClient(url, anon);
  return _client;
}

let _admin: ReturnType<typeof createClient> | null = null;

/**
 * Server-side Supabase client. Server-only; uses the service-role key
 * so it bypasses RLS. Used inside `/api/connect/*` endpoints (which
 * the desktop polls and the CLI hits).
 */
export function getSupabaseAdmin() {
  if (_admin) return _admin;
  const url =
    (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
    (import.meta.env?.VITE_SUPABASE_URL as string | undefined);
  const key =
    (typeof process !== "undefined" && process.env?.SUPABASE_SERVICE_ROLE_KEY) ||
    undefined;
  if (!url || !key) return null;
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
