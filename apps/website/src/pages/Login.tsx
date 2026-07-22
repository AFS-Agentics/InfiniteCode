/**
 * Public website login — tryinfinitecode.vercel.app
 *
 * Also handles the device-pairing flow: when the user lands here with
 * a `?code=ABCD-EFGH` query param (added by the desktop/CLI after
 * opening the system browser), we update the matching
 * `public.device_pairing` row with the user's freshly-minted
 * Supabase tokens and mark it `authorized` so the desktop can pick
 * them up within seconds.
 */
import * as React from "react";
import { getSupabase } from "../lib/supabase";

const DEVICE_CODE_PARAM = "code";

export default function Login() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const sb = getSupabase();

  const deviceCode = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    const u = new URL(window.location.href);
    return u.searchParams.get(DEVICE_CODE_PARAM);
  }, []);

  async function pairDeviceWithSession() {
    // If `?code=` is present, copy the just-signed-in user's tokens
    // into the `device_pairing` row so the desktop polls them.
    if (!deviceCode || !sb) return;
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) return;
    // Same endpoint the desktop hits for the pre-insert. The server
    // discriminates by body shape: just `user_code` → pending row;
    // `user_code + access_token + refresh_token` → authorized.
    const url = `/api/connect`;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_code: deviceCode,
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }),
      });
      setPaired(true);
      setInfo(
        "✓ Signed back into your desktop — you can close this window.",
      );
    } catch {
      // best-effort; the desktop will time out and the operator can retry
    }
  }

  async function signInWithGoogle() {
    if (!sb) return;
    setBusy(true);
    setError(null);
    try {
      const redirectTo = new URL("/login", window.location.origin);
      if (deviceCode) redirectTo.searchParams.set(DEVICE_CODE_PARAM, deviceCode);
      await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo.toString() },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!sb || !email) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const redirectTo = new URL("/login", window.location.origin);
      if (deviceCode) redirectTo.searchParams.set(DEVICE_CODE_PARAM, deviceCode);
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo.toString() },
      });
      if (error) throw error;
      setInfo(
        "Check your inbox — we sent a one-time sign-in link.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // When a user lands here after a successful redirect from Supabase,
  // make sure their device-pairing row is updated before they reload.
  React.useEffect(() => {
    void pairDeviceWithSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [paired, setPaired] = React.useState(false);

  // Session-aware guard: if a returning user lands on /login with an
  // active Supabase session AND a `?code=...` is present, auto-pair
  // and render the success card instead of the form so they don't
  // accidentally re-trigger Google OAuth by clicking the button.
  React.useEffect(() => {
    if (!deviceCode || !sb || paired) return;
    sb.auth.getSession().then(({ data }) => {
      if (data.session && deviceCode) {
        void pairDeviceWithSession();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceCode, paired, sb]);

  if (!sb) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <section className="max-w-md rounded-lg border border-amber-500/40 bg-amber-500/10 p-6 text-sm">
          <h1 className="mb-2 text-base font-semibold text-amber-200">
            Supabase not configured
          </h1>
          <p className="text-amber-100/80">
            Set <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code>, then
            rebuild the website.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      {paired ? (
        <div data-testid="paired-card" className="w-full max-w-md rounded-xl border border-emerald-500/40 bg-card/60 p-8 shadow-xl">
          <header className="mb-6 space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              <span className="mr-2">✓</span>Signed in
            </h1>
            <p className="text-sm text-muted-foreground">
              Your desktop is now connected. You can close this tab.
            </p>
          </header>
          <a
            href="/dashboard"
            className="block w-full rounded-md border border-border/60 bg-background px-4 py-2.5 text-center text-sm font-medium hover:bg-accent/40"
          >
            Go to dashboard
          </a>
        </div>
      ) : null}
      <div className={`w-full max-w-md rounded-xl border border-border/60 bg-card/60 p-8 shadow-xl ${paired ? "hidden" : ""}`}>
        <header className="mb-6 space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in to InfiniteCode
          </h1>
          <p className="text-sm text-muted-foreground">
            {deviceCode
              ? "Your desktop is waiting — one sign-in and you're back."
              : "Use the same account across web, desktop, and CLI."}
          </p>
        </header>

        {error && (
          <p className="mb-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}
        {info && (
          <p className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {info}
          </p>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={signInWithGoogle}
          className="mb-4 w-full rounded-md border border-border/60 bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent/40 disabled:opacity-50"
        >
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border/60" />
          <span>or</span>
          <span className="h-px flex-1 bg-border/60" />
        </div>

        <form onSubmit={sendMagicLink} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="[email protected]"
            required
            className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={busy || !email}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Send sign-in link
          </button>
        </form>
      </div>
    </main>
  );
}
