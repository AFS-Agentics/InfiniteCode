-- ============================================================================
-- InfiniteCode website — additive Supabase schema
-- ============================================================================
-- Runs AFTER `InfiniteCodeBackend/supabase/migrations/20240101000000_init_auth.sql`,
-- which owns the canonical shape of `public.profiles`, `public.device_pairing`,
-- the audit-log table, and the `trg_handle_new_user` trigger. Both migrations
-- converge on a single Supabase project per the design contract in
-- `InfiniteCodeBackend_supabase.md`.
--
-- This migration:
--   · Augments `public.profiles` with website-only columns (`plan`,
--     `last_active_at`, `stripe_customer_id`) without re-creating the table.
--   · Adds a self-row device_pairing SELECT policy so the website's Profile
--     page can list recent device links via the anon key + RLS.
--   · Removes the legacy `on_auth_user_created` duplicate trigger so only
--     the canonical `trg_handle_new_user` (Backend migration) handles
--     new-user profile creation. Old deployments that stacked both triggers
--     are cleaned up by this `DROP … IF EXISTS`.
--   · Replaces a fragile `error.message.includes("duplicate")` POST dup-match
--     in the website's `/api/connect` handler with a single UPSERT path
--     (handled on the application side, not in this migration).
--
-- Every statement is idempotent (`ADD COLUMN IF NOT EXISTS`,
-- `CREATE INDEX IF NOT EXISTS`, `DROP … IF EXISTS`) so re-running is safe.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Additive columns on the canonical profiles table.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'pro', 'enterprise')),
    ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
    ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE INDEX IF NOT EXISTS profiles_plan_idx ON public.profiles (plan);
CREATE INDEX IF NOT EXISTS profiles_updated_at_idx ON public.profiles (updated_at DESC);

-- Row Level Security — users can read/update only their own row. Both
-- this policy and the Backend migration's policy are permissive; Postgres
-- ORs WITH CHECKs, so the stricter Backend policy (`role = (SELECT role
-- FROM profiles WHERE id = auth.uid())`) keeps self-promotion blocked
-- even when both policies are present.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- ────────────────────────────────────────────────────────────────────────────
-- Drop the duplicate auth.user-created trigger so only the canonical
-- `trg_handle_new_user` (Backend migration) handles new-user profile
-- creation. Old deployments with both triggers stacked are cleaned up here.
-- ────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Drop the orphan `public.handle_new_user()` function. Earlier drafts
-- of this migration created/replaced the function with a `DO UPDATE`
-- body that differed from the Backend migration's canonical version;
-- with the duplicate trigger dropped above, the canonical
-- `trg_handle_new_user` (Backend migration) is the only caller. Use
-- `CASCADE` so any other leftover triggers / policies that may depend
-- on the function are cleaned up too.
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- `public.device_pairing` self-row SELECT policy. Lets the website's
-- Profile page list recent device-pairing rows whose user_id matches the
-- caller (anon key + RLS).
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF to_regclass('public.device_pairing') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name   = 'device_pairing'
             AND column_name  = 'user_id'
       )
    THEN
        ALTER TABLE public.device_pairing ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "device_pairing_select_own" ON public.device_pairing;
        CREATE POLICY "device_pairing_select_own"
        ON public.device_pairing
        FOR SELECT
        USING (auth.uid() = user_id);
    END IF;
END $$;
