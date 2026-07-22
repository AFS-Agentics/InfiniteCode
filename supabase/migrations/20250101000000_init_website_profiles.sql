-- ============================================================================
-- InfiniteCode website — Supabase schema bootstrap
--
-- Run this once in the Supabase project's SQL editor (or via the Supabase
-- CLI: `supabase db push`) to set up the shared identity tables the
-- website reads/writes against.
--
-- This migration is idempotent (`CREATE … IF NOT EXISTS`) so it's safe
-- to re-run after the InfiniteCodeBackend admin panel already created
-- the same `profiles` table.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- public.profiles — one row per Supabase auth user
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
    id              uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email           text,
    display_name    text,
    avatar_url      text,
    plan            text NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'pro', 'enterprise')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    last_active_at  timestamptz,
    -- Optional: expose a stripe customer id when billing lands; UI doesn't
    -- surface this yet but the column keeps the schema future-proof.
    stripe_customer_id text
);

CREATE INDEX IF NOT EXISTS profiles_plan_idx ON public.profiles (plan);
CREATE INDEX IF NOT EXISTS profiles_updated_at_idx ON public.profiles (updated_at DESC);

-- Row Level Security — users can read/update only their own row. The
-- InfiniteCodeBackend admin endpoints bypass RLS via SUPABASE_SERVICE_ROLE_KEY.
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
-- Auto-create a profile row whenever a new auth.users row is inserted so
-- the website can read from public.profiles immediately after signup.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, avatar_url, last_active_at)
    VALUES (
        new.id,
        new.email,
        COALESCE(
            new.raw_user_meta_data ->> 'full_name',
            new.raw_user_meta_data ->> 'name',
            split_part(COALESCE(new.email, ''), '@', 1)
        ),
        COALESCE(
            new.raw_user_meta_data ->> 'avatar_url',
            new.raw_user_meta_data ->> 'picture'
        ),
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        display_name = COALESCE(EXCLUDED.display_name, public.profiles.display_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
        updated_at = now();
    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────────
-- public.device_pairing — RLS so a user can only see rows linked to their
-- own user_id. The InfiniteCodeBackend's /api/connect endpoint writes into
-- this table using the service-role key, which bypasses RLS.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF to_regclass('public.device_pairing') IS NOT NULL THEN
        ALTER TABLE public.device_pairing ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "device_pairing_select_own" ON public.device_pairing;
        CREATE POLICY "device_pairing_select_own"
        ON public.device_pairing
        FOR SELECT
        USING (auth.uid() = user_id);
    END IF;
END $$;
