import { type JSX, useEffect, useMemo, useRef, useState } from "react";

interface GravityAdData {
	adText: string;
	title?: string;
	cta?: string;
	brandName?: string;
	url?: string;
	favicon?: string;
	impUrl?: string;
	clickUrl?: string;
	[key: string]: unknown;
}

/**
 * Dev-only escape hatch for the absent-placement invariant. In production
 * (`import.meta.env.DEV === false` in the bundled build) this collapses to
 * `return null` — Vite replaces `import.meta.env.DEV` with the literal
 * boolean at build time, so the placeholder branch tree-shakes away. In
 * dev mode the call renders a faint dashed-border placeholder so each
 * placement's surface stays visible during UI iteration even without a real
 * GRAVITY_API_KEY. Kept as a tiny inline-only helper to avoid prop drilling.
 */
function renderEmptyOrNull(placement: string): JSX.Element | null {
	return import.meta.env.DEV ? (
		<ThemedGravityEmptySlot placement={placement} />
	) : null;
}

/**
 * Hardcoded demo Gravity ad used for the dev-mode placeholder. Mirrors the
 * shape of a real Gravity response so the placement surfaces render with
 * realistic visual chrome (brand + description + Ad label, full opacity,
 * solid border) even when no real GRAVITY_API_KEY is configured. Tree-shaken
 * in production builds via `import.meta.env.DEV` (see `renderEmptyOrNull`).
 */
const GRAVITY_DEMO_AD: GravityAdData = {
	adText: "Production-grade object storage with edge caching and zero-egress egress pricing.",
	brandName: "Cortex Cloud",
	cta: "Start free trial",
	url: "https://example.com/cortex",
	clickUrl: "https://example.com/cortex?utm_source=infinitecode&utm_medium=desktop",
	// No impUrl — demo placeholder does not fire impression pixels.
};

/**
 * Dev-only placeholder rendered when the Gravity auction returns no fill.
 * Renders the existing themed pill variants with `GRAVITY_DEMO_AD` so the
 * placement surfaces look identical to a real ad fill — same chrome, same
 * height, same Inter Observer wiring (firedRef is short-circuited because
 * `impUrl` is undefined). `import.meta.env.DEV` is Vite-baked to `false`
 * in production, so this branch tree-shakes away entirely.
 */
function ThemedGravityEmptySlot({
	placement,
}: {
	placement: string;
}): JSX.Element | null {
	if (!import.meta.env.DEV) return null;
	switch (placement) {
		case "above_response":
		case "below_response":
			return <ThemedGravityCard ad={GRAVITY_DEMO_AD} placement={placement} />;
		case "inline_response":
			return <ThemedGravityInlineFootnote ad={GRAVITY_DEMO_AD} />;
		case "search_result":
			return <ThemedGravitySearchResultRow ad={GRAVITY_DEMO_AD} />;
		case "bottom_page":
			return <ThemedGravityBottomPagePill ad={GRAVITY_DEMO_AD} />;
		case "sidebar":
			return (
				<ThemedGravityCornerPill
					ad={GRAVITY_DEMO_AD}
					placement={placement}
				/>
			);
		case "mid_response":
			return (
				<ThemedGravityCornerPill
					ad={GRAVITY_DEMO_AD}
					placement={placement}
				/>
			);
		case "mid_timeline":
			return <ThemedGravityMidTimelineCard ad={GRAVITY_DEMO_AD} />;
		case "startup_overlay":
			return <ThemedGravityOverlayCard ad={GRAVITY_DEMO_AD} />;
		default:
			return null;
	}
}

/**
 * Fetches a contextual ad from Gravity via IPC and renders it inline with the
 * InfiniteCode theme tokens.
 *
 * Stability: the fetch key is derived from the message CONTENT (not array
 * reference), so streaming deltas that don't change the captured turns won't
 * trigger a refetch. A monotonic counter also ensures only the latest in-flight
 * fetch's response is committed — earlier fetches are dropped silently instead
 * of cancelling the HTTP request.
 *
 * Rendering note: we render the ad ourselves rather than via
 * `@gravity-ai/react`'s `<GravityAd>` because the SDK's default light-theme
 * card clashes with InfiniteCode's dark surface. We still honour impression
 * tracking via IntersectionObserver and route clicks through `clickUrl` so
 * attribution is identical to the SDK path.
 */
export function GravityAd({
	messages,
	placement = "below_response",
}: {
	/** Last 2–4 conversation turns for contextual ad matching. */
	messages: { role: string; content: string }[];
	/**
	 * Which Gravity placement slot to bid into. Each slot is a separate auction
	 * and earns its own impressions. Pass `above_response` to render the pill
	 * above an AI response, `below_response` for below.
	 */
	placement?: "above_response" | "below_response";
}): JSX.Element | null {
	const [ad, setAd] = useState<GravityAdData | null>(null);
	const [state, setState] = useState<"loading" | "empty" | "error" | "ready">(
		"loading",
	);
	const latestKeyRef = useRef(0);

	// Stable key derived from the message CONTENT. JSON.stringify avoids the
	// array-reference churn caused by upstream turns atoms re-emitting on every
	// streamed token. Same content → same key → no refetch.
	const contextKey = useMemo(() => {
		try {
			return JSON.stringify(messages);
		} catch {
			return "";
		}
	}, [messages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: contextKey is the stable, content-derived key. Adding `messages` would re-fire on every upstream reference churn during streaming and reintroduce the original thrash. `placement` is stable per GravityAd instance — changes only happen at mount, never during streaming.
	useEffect(() => {
		if (!window.infinitecode?.gravity?.getAds) {
			setState("error");
			return;
		}
		const myKey = ++latestKeyRef.current;
		setState((prev) => (prev === "ready" ? prev : "loading"));

		async function load() {
			try {
				const ads = await window.infinitecode.gravity.getAds(
					messages,
					placement,
				);
				if (myKey !== latestKeyRef.current) return;
				if (Array.isArray(ads) && ads.length > 0) {
					setAd(ads[0] as GravityAdData);
					setState("ready");
				} else {
					setState("empty");
				}
			} catch (err) {
				console.error("[gravity] renderer fetch failed", err);
				if (myKey === latestKeyRef.current) {
					setState("error");
				}
			}
		}

		void load();
	}, [contextKey, placement]);

	// When the auction returns no fill (or an error or we're still loading),
	// render nothing in production. In dev mode, render a faint dashed-border
	// placeholder so the placement surface is visible to the developer even
	// without a real GRAVITY_API_KEY. `import.meta.env.DEV` is Vite-baked to
	// `false` in production builds, so this branch tree-shakes away.
	if (state !== "ready" || !ad) {
		return renderEmptyOrNull(placement);
	}
	return <ThemedGravityCard ad={ad} placement={placement} />;
}

/**
 * Renders a Gravity ad as a compact single-row pill using the InfiniteCode
 * theme tokens. Fires the impression pixel on first 50% visibility and routes
 * clicks through `clickUrl` (falling back to `url` if absent) — matching the
 * SDK's attribution semantics.
 *
 * Layout: [favicon] brand · truncated description (title || adText) · "Ad"
 * label. The whole pill is the link — no separate CTA button — so height
 * stays around 56–64px regardless of ad body length.
 */
function ThemedGravityCard({
	ad,
	placement,
}: {
	ad: GravityAdData;
	placement: "above_response" | "below_response";
}): JSX.Element {
	const containerRef = useRef<HTMLAnchorElement>(null);
	const firedRef = useRef(false);
	const href =
		(ad.clickUrl as string | undefined) ||
		(ad.url as string | undefined) ||
		"#";

	useEffect(() => {
		// Reset per-ad: each new ad (different impUrl) gets its own impression.
		firedRef.current = false;
		const node = containerRef.current;
		const impUrl = ad.impUrl as string | undefined;
		if (!node || !impUrl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && !firedRef.current) {
						firedRef.current = true;
						// Fire-and-forget pixel — must not throw.
						new Image().src = impUrl;
						observer.disconnect();
					}
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ad.impUrl]);

	const description =
		(ad.adText as string | undefined) || (ad.title as string | undefined) || "";

	return (
		<a
			ref={containerRef}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`Sponsored: ${(ad.brandName as string | undefined) ?? "ad"}`}
			// Inline style for theme colors. The host app defines these as CSS
			// variables on :root, but they are not registered in Tailwind's
			// `@theme` block, so utility classes like `bg-card` / `text-foreground`
			// don't generate. Inline style bypasses that and applies directly.
			style={{
				backgroundColor: "var(--card)",
				borderColor: "var(--border)",
			}}
			className="group mt-3 flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
			data-gravity-ad-slot={placement}
			data-gravity-ad-brand={(ad.brandName as string | undefined) ?? ""}
		>
			{ad.favicon ? (
				<img
					src={ad.favicon as string}
					alt=""
					className="size-5 shrink-0 rounded-sm"
				/>
			) : null}
			<span
				className="shrink-0 text-sm font-semibold leading-none"
				style={{ color: "var(--foreground)" }}
			>
				{(ad.brandName as string | undefined) ?? ""}
			</span>
			{description ? (
				<>
					<span
						className="shrink-0 leading-none opacity-50"
						style={{ color: "var(--muted-foreground)" }}
						aria-hidden="true"
					>
						·
					</span>
					<span
						className="min-w-0 flex-1 truncate text-sm leading-none"
						style={{ color: "var(--muted-foreground)" }}
					>
						{description}
					</span>
				</>
			) : null}				<span
					className="shrink-0 text-[10px] font-medium uppercase leading-none tracking-wider opacity-70"
					style={{ color: "var(--muted-foreground)" }}
				>
					Ad
				</span>
			</a>
		);
	}

/**
 * Inline Response ad — woven into the assistant's response bubble itself.
 * Renders as a subtle sponsor footnote at the bottom of the AI text, directly
 * attached to the MessageContent (highest-engagement slot per the Gravity docs
 * we sent to support). Visual treatment is intentionally restrained so it
 * reads as a sponsored disclosure, not a card.
 *
 * Caller responsibilities:
 *   - Gate on `!working && finalResponsePart && responseText`: the component
 *     must NOT mount mid-stream. Mounting early would let the
 *     IntersectionObserver fire a partial-stream impression and corrupt
 *     Gravity's per-ad count.
 *   - Derive `messages` per-turn (this turn's user prompt + assistant content),
 *     not from the last 4 turns, so the contextual match aligns with the
 *     response it sits inside.
 *
 * Attribution: same rules as the below_response pill — `impUrl` fired once
 * at 50% IO visibility, clickUrl routing, firedRef resets per new `impUrl`.
 * Visual spec / DOM does not influence impressions or billing.
 */
export function GravityInlineAd({
	messages,
}: {
	/** Capture of THIS turn's user prompt + assistant response. */
	messages: { role: string; content: string }[];
}): JSX.Element | null {
	const [ad, setAd] = useState<GravityAdData | null>(null);
	const [state, setState] = useState<"loading" | "empty" | "error" | "ready">(
		"loading",
	);
	const latestKeyRef = useRef(0);

	// Stable key derived from the message CONTENT so streaming deltas that
	// don't change captured text don't retrigger.
	const contextKey = useMemo(() => {
		try {
			return JSON.stringify(messages);
		} catch {
			return "";
		}
	}, [messages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: contextKey is the stable, content-derived key. Adding `messages` would re-fire on every upstream reference churn during streaming.
	useEffect(() => {
		if (!window.infinitecode?.gravity?.getAds) {
			setState("error");
			return;
		}
		const myKey = ++latestKeyRef.current;
		setState("loading");

		async function load() {
			try {
				const ads = await window.infinitecode.gravity.getAds(
					messages,
					"inline_response",
				);
				if (myKey !== latestKeyRef.current) return;
				if (Array.isArray(ads) && ads.length > 0) {
					setAd(ads[0] as GravityAdData);
					setState("ready");
				} else {
					setState("empty");
				}
			} catch (err) {
				console.error("[gravity] inline fetch failed", err);
				if (myKey === latestKeyRef.current) {
					setState("error");
				}
			}
		}

		void load();
	}, [contextKey]);

	if (state === "ready" && ad) {
		return <ThemedGravityInlineFootnote ad={ad} slot="inline_response" />;
	}

	// Empty/loading/error in production collapses to null (absent-placement
	// invariant). In dev mode, the woven-in slot gets a faint dashed-placeholder
	// so the location is visible to the developer without a live API key.
	return renderEmptyOrNull("inline_response");
}

/**
 * Renders the inline ad as a single-line sponsor footnote directly attached
 * to the response bubble. The whole line is one `<a>` for max click target,
 * with "Sponsored" prefix italicized as a disclosure. Uses inline styles on
 * the muted/foreground tokens (CSS variables defined in `index.css` / `index.html`,
 * referenced as full colors).
 */
function ThemedGravityInlineFootnote({
	ad,
	slot = "inline_response",
}: {
	ad: GravityAdData;
	/**
	 * Which Gravity placement slot this footnote represents. Drives the
	 * `data-gravity-ad-slot` DOM hook for analytics. Defaults to
	 * `"inline_response"` so ad-hoc callers (e.g. the dev placeholder in
	 * `ThemedGravityEmptySlot`) don't need to pass it. `GravityMidResponseAd`
	 * passes `"mid_response"` so mid_response impressions don't accidentally
	 * report as inline_response in the dashboard.
	 */
	slot?: "inline_response" | "mid_response";
}): JSX.Element {
	const containerRef = useRef<HTMLAnchorElement>(null);
	const firedRef = useRef(false);
	const href =
		(ad.clickUrl as string | undefined) ||
		(ad.url as string | undefined) ||
		"#";
	const description =
		(ad.adText as string | undefined) || (ad.title as string | undefined) || "";

	useEffect(() => {
		firedRef.current = false;
		const node = containerRef.current;
		const impUrl = ad.impUrl as string | undefined;
		if (!node || !impUrl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && !firedRef.current) {
						firedRef.current = true;
						new Image().src = impUrl;
						observer.disconnect();
					}
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ad.impUrl]);

	return (
		<a
			ref={containerRef}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`Sponsored: ${(ad.brandName as string | undefined) ?? "ad"}`}
			style={{
				backgroundColor: "var(--card)",
				borderColor: "var(--border)",
				color: "var(--muted-foreground)",
			}}
			className="my-2 mx-2 flex w-fit max-w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-xs leading-snug transition-colors hover:bg-accent/40"
			data-gravity-ad-slot={slot}
			data-gravity-ad-brand={(ad.brandName as string | undefined) ?? ""}
		>
			<span className="shrink-0 italic opacity-60">Sponsored</span>		{ad.favicon ? (
			<img
				src={ad.favicon as string}
				alt=""
				className="size-3.5 shrink-0 rounded-sm"
			/>
		) : null}
		<span
			className="shrink-0 font-medium"
			style={{ color: "var(--foreground)" }}
		>
			{(ad.brandName as string | undefined) ?? ""}
		</span>
		{description ? (
			<>
				<span className="shrink-0 opacity-40" aria-hidden="true">
					·
				</span>
				<span className="min-w-0 flex-1 truncate">{description}</span>
			</>
		) : null}
	</a>
	);
}

/**
 * Search Result ad — appears inline among `@`-reference search results in the
 * MentionPopover, styled as a result entry that matches the surrounding
 * MentionItem row layout. Provides Gravity's third contextual placement shape
 * (after inline_response/below_response) and earns an impression on first 50%
 * scroll-in.
 *
 * Caller responsibilities:
 *   - Mount only when the popover is open AND there are real search results
 *     to display (so the ad sits as a result entry rather than as the only
 *     thing in the list, which would feel misleading).
 *   - Derive `messages` from the current `@query` string so the contextual
 *     match aligns with what the user is searching for. The query naturally
 *     de-stabilizes on each keystroke so an `inline_response`-style settle
 *     gate isn't needed — each new query is a fresh auction fit.
 *
 * Visual: row layout `flex w-full items-center gap-2 px-3 py-1.5 text-left
 * text-sm transition-colors` mirrors MentionItem exactly so the ad reads as a
 * natural result without bespoke chrome.
 *
 * Attribution: same rules as the inline/below pills — `impUrl` fired once
 * at 50% IO visibility, clickUrl routing, firedRef resets per new `impUrl`.
 * Visual spec / DOM does not influence impressions or billing.
 */
export function GravitySearchResultAd({
	messages,
}: {
	/** Search query context — typically `[{role:"user", content:"@"+query}]`. */
	messages: { role: string; content: string }[];
}): JSX.Element | null {
	const [ad, setAd] = useState<GravityAdData | null>(null);
	const [state, setState] = useState<"loading" | "empty" | "error" | "ready">(
		"loading",
	);
	const latestKeyRef = useRef(0);

	// Stable key derived from the message CONTENT so the same search query
	// resolves to the same ad without re-firing per keystroke noise. JSON
	// stringify is sufficient — search queries are short and bounded.
	const contextKey = useMemo(() => {
		try {
			return JSON.stringify(messages);
		} catch {
			return "";
		}
	}, [messages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: contextKey is the stable, content-derived key. `messages` would re-fire on every upstream reference churn during typing.
	useEffect(() => {
		if (!window.infinitecode?.gravity?.getAds) {
			setState("error");
			return;
		}
		const myKey = ++latestKeyRef.current;
		setState("loading");

		async function load() {
			try {
				const ads = await window.infinitecode.gravity.getAds(
					messages,
					"search_result",
				);
				if (myKey !== latestKeyRef.current) return;
				if (Array.isArray(ads) && ads.length > 0) {
					setAd(ads[0] as GravityAdData);
					setState("ready");
				} else {
					setState("empty");
				}
			} catch (err) {
				console.error("[gravity] search-result fetch failed", err);
				if (myKey === latestKeyRef.current) {
					setState("error");
				}
			}
		}

		void load();
	}, [contextKey]);

	// Same as GravityAd — absent placement = absent render in prod; in dev
	// render a faint dashed placeholder so the slot is visible to the
	// developer without a live API key.
	if (state !== "ready" || !ad) {
		return renderEmptyOrNull("search_result");
	}
	return <ThemedGravitySearchResultRow ad={ad} />;
}

/**
 * Renders the ad as a single row styled to read like a native MentionItem
 * result entry. Uses an `<a>` for the link target so the whole row clicks,
 * but skips the data-active arrow-key navigation (the ad is not selectable
 * like a real reference result).
 */
function ThemedGravitySearchResultRow({
	ad,
}: {
	ad: GravityAdData;
}): JSX.Element {
	const containerRef = useRef<HTMLAnchorElement>(null);
	const firedRef = useRef(false);
	const href =
		(ad.clickUrl as string | undefined) ||
		(ad.url as string | undefined) ||
		"#";
	const description =
		(ad.adText as string | undefined) ||
		(ad.title as string | undefined) ||
		"";

	useEffect(() => {
		firedRef.current = false;
		const node = containerRef.current;
		const impUrl = ad.impUrl as string | undefined;
		if (!node || !impUrl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && !firedRef.current) {
						firedRef.current = true;
						new Image().src = impUrl;
						observer.disconnect();
					}
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ad.impUrl]);

	return (
		<a
			ref={containerRef}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`Sponsored: ${(ad.brandName as string | undefined) ?? "ad"}`}
			// Mirrors MentionItem row layout verbatim (flex / items-center /
			// px-3 / py-1.5 / text-sm / transition-colors). The "Sponsored"
			// prefix label replaces the role-icon slot from MentionItem so the
			// row reads as a sponsored entry rather than a true @-reference.
			className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
			data-gravity-ad-slot="search_result"
			data-gravity-ad-brand={(ad.brandName as string | undefined) ?? ""}
		>
			<span
				className="shrink-0 font-medium uppercase tracking-wider opacity-60"
				style={{ color: "var(--muted-foreground)" }}
			>
				Sponsored
			</span>
			{ad.favicon ? (
				<img
					src={ad.favicon as string}
					alt=""
					className="size-3.5 shrink-0 rounded-sm"
				/>
			) : null}
			<span
				className="shrink-0 font-medium"
				style={{ color: "var(--foreground)" }}
			>
				{(ad.brandName as string | undefined) ?? ""}
			</span>
			{description ? (
				<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
					{description}
				</span>
			) : null}
			<span
				className="shrink-0 text-[10px] font-medium uppercase tracking-wider opacity-50"
				style={{ color: "var(--muted-foreground)" }}
			>
				Ad
			</span>
		</a>
	);
}

/**
 * Bottom Page ad — sticky pill rendered immediately above the message input
 * field in ChatView. Always visible due to the compositor's `bottom-0`
 * anchoring (the pill carries a fixed height offset so chat content above it
 * still gets full focus area). Auto-rotates on a `refreshIntervalMs` timer:
 * each tick increments a rotation counter → contextKey cycles → a new fetch
 * resolves → new `impUrl` → firedRef resets → IO observer fires a fresh
 * impression (the pill is already at 50%+ viewport, so a regular observer
 * registers and fires immediately on the next micro-intersection).
 *
 * Caller responsibilities:
 *   - Mount once per chat session (not per turn) — the bottom slot is
 *     always-on, not per-response.
 *   - Pass `messages` derived from the most recent user prompt (plus
 *     optionally a small ambient context like the project name) so each
 *     session has stable contextual matching but the rotation counter drives
 *     fresh auctions on the timer.
 *
 * Attribution: same rules as the other pills — `impUrl` fired once at 50%
 * IO visibility via the `firedRef` reset on new `impUrl`, clickUrl routing.
 * The timer effectively makes each rotation a fresh "scroll-in" event
 * because the IO observer is re-registered with `firedRef=false`.
 */
export function GravityBottomPageAd({
	messages,
	refreshIntervalMs = 60 * 1000,
}: {
	/** Ambient context for the auction — typically the most recent user prompt. */
	messages: { role: string; content: string }[];
	/** How often to re-fetch and rotate. Defaults to 60 seconds — matches
	 *  the freebuff always-on banner cadence so ad rotations feel uniform
	 *  across InfiniteCode Desktop and Freebuff CLI. */
	refreshIntervalMs?: number;
}): JSX.Element | null {
	const [ad, setAd] = useState<GravityAdData | null>(null);
	const [state, setState] = useState<"loading" | "empty" | "error" | "ready">(
		"loading",
	);
	const [rotation, setRotation] = useState(0);
	const latestKeyRef = useRef(0);

	// Auto-refresh: tick the rotation counter on a fixed interval. Each tick
	// cycles the synthesis key (and therefore the contextKey/messages ref),
	// which re-triggers the fetch effect downstream.
	useEffect(() => {
		const id = setInterval(() => {
			setRotation((r) => r + 1);
		}, refreshIntervalMs);
		return () => clearInterval(id);
	}, [refreshIntervalMs]);

	// Synthesis key includes the rotation counter so each tick is a fresh
	// graph node in Gravity's per-session sessionId derivation. The actual
	// ambient messages stay the same — only the rotation counter deepens.
	const contextMessages = useMemo<{ role: string; content: string }[]>(
		() => [
			...messages.map((m) => ({ role: m.role, content: m.content })),
			{ role: "system", content: `__rotation__:${rotation}` },
		],
		[messages, rotation],
	);

	const contextKey = useMemo(() => {
		try {
			return JSON.stringify(contextMessages);
		} catch {
			return "";
		}
	}, [contextMessages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: contextKey is the stable, rotation-derived key. Adding `contextMessages` would re-fire on every upstream reference churn during typing and reintroduce the original thrash.
	useEffect(() => {
		if (!window.infinitecode?.gravity?.getAds) {
			setState("error");
			return;
		}
		const myKey = ++latestKeyRef.current;
		setState("loading");

		async function load() {
			try {
				const ads = await window.infinitecode.gravity.getAds(
					contextMessages,
					"bottom_page",
				);
				if (myKey !== latestKeyRef.current) return;
				if (Array.isArray(ads) && ads.length > 0) {
					setAd(ads[0] as GravityAdData);
					setState("ready");
				} else {
					setState("empty");
				}
			} catch (err) {
				console.error("[gravity] bottom-page fetch failed", err);
				if (myKey === latestKeyRef.current) {
					setState("error");
				}
			}
		}

		void load();
	}, [contextKey]);

	// Same null-on-empty guarantee as the other pills in production. In dev
	// mode, render the faint dashed placeholder so the always-on bottom slot
	// is visible even without a live API key.
	if (state !== "ready" || !ad) {
		return renderEmptyOrNull("bottom_page");
	}
	return <ThemedGravityBottomPagePill ad={ad} />;
}

/**
 * Renders the bottom-page ad as a wide card matching the screenshot's
 * brand/description/CTA layout. The composer wrapper (in chat-view.tsx)
 * owns panel chrome — `bg-background/95`, `border-t`, inner `px-3.5
 * pt-3 pb-2`, the message-field-matching `max-w-3xl` width constraint —
 * while the pill itself carries a default `mb-2` for breathing room
 * between the pill and the next thing below it. This makes the spacing
 * work both in the chat composer (where the wrapper may also carry its
 * own margin — `mb-2`s collapse harmlessly) AND in the settings footer
 * mount (where there's no wrapper margin and the pill's `mb-2` is the
 * sole source). `pointer-events-auto` is kept defensively so clicks
 * never silently die if a future change ever re-adds `pointer-events-
 * none` to the wrapper or a sibling overlay (e.g. mention popover
 * blocker).
 */
function ThemedGravityBottomPagePill({
	ad,
}: {
	ad: GravityAdData;
}): JSX.Element {
	const containerRef = useRef<HTMLAnchorElement>(null);
	const firedRef = useRef(false);
	const href =
		(ad.clickUrl as string | undefined) ||
		(ad.url as string | undefined) ||
		"#";
	const description =
		(ad.adText as string | undefined) ||
		(ad.title as string | undefined) ||
		"";

	useEffect(() => {
		// Per-imp reset — each new ad (different impUrl) fires its own impression.
		// Combined with the auto-rotate timer in GravityBottomPageAd, this gives
		// one fresh impression per `refreshIntervalMs`.
		firedRef.current = false;
		const node = containerRef.current;
		const impUrl = ad.impUrl as string | undefined;
		if (!node || !impUrl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && !firedRef.current) {
						firedRef.current = true;
						new Image().src = impUrl;
						observer.disconnect();
					}
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ad.impUrl]);

	return (
		<a
			ref={containerRef}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`Sponsored: ${(ad.brandName as string | undefined) ?? "ad"}`}
			style={{
				backgroundColor: "var(--card)",
				borderColor: "var(--border)",
			}}
		className="group pointer-events-auto mb-2 flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
		data-gravity-ad-slot="bottom_page"
		data-gravity-ad-brand={(ad.brandName as string | undefined) ?? ""}
	>
			
			{ad.favicon ? (
				<img
					src={ad.favicon as string}
					alt=""
					className="size-5 shrink-0 rounded-sm"
				/>
			) : null}
			<span
				className="shrink-0 text-sm font-semibold leading-none"
				style={{ color: "var(--foreground)" }}
			>
				{(ad.brandName as string | undefined) ?? ""}
			</span>
			{description ? (
				<>
					<span
						className="shrink-0 leading-none opacity-50"
						style={{ color: "var(--muted-foreground)" }}
						aria-hidden="true"
					>
						·
					</span>
					<span
						className="min-w-0 flex-1 truncate text-xs leading-none"
						style={{ color: "var(--muted-foreground)" }}
					>
						{description}
					</span>
				</>
			) : null}				<span
					className="shrink-0 text-[10px] font-medium uppercase leading-none tracking-wider opacity-70"
					style={{ color: "var(--muted-foreground)" }}
				>
					Ad
				</span>
			</a>
		);
	}


// ============================================================
// Tier-1 placement: sidebar
// (left_response / right_response were explored and dropped — density back to
// freebuff's per-response pair: inline + below_response. See chat-turn.tsx.)
//
// These placements mirror the always-on rotation pattern from
// GravityBottomPageAd (60-second timer + rotating counter that re-auctions),
// but factor out the duplicated fetch + IntersectionObserver logic into a
// shared `useGravityAdRotating` hook. Each new component is a thin wrapper
// around the hook + a single `<ThemedGravityCornerPill>` rendering.
//
// Behavior parity with the existing placements:
//   - rotation counter drives fresh auctions every refreshIntervalMs (default 60 s)
//   - new impUrl → firedRef reset → IO observer fires a fresh impression at 50%
//     viewport intersection (matches existing pill semantics — Gravity's billing
//     depends on the threshold and we don't game it)
//   - clickUrl || url || "#" href fallback for routing attribution intact
//   - empty / error / loading renders `null` (slot collapses to zero height)
//
// Placement-id strings are owned by the main-process PLACEMENT_ID_BY_SLOT
// map in `ipc-handlers.ts` so the dashboard reports per-slot metrics. New
// ids use the same kebab-friendly naming pattern as the existing slots.
// ============================================================

/**
 * All Gravity placement strings supported by InfiniteCode Desktop.
 * Single source of truth — preload/index.ts, main/ipc-handlers.ts and
 * this file's union type must stay in sync.
 */
export type GravityPlacement =
	| "above_response"
	| "below_response"
	| "inline_response"
	| "search_result"
	| "bottom_page"
	| "sidebar"
	| "mid_response"
	| "mid_timeline"
	| "startup_overlay";

/**
 * Shared rotating-fetch + IntersectionObserver impression tracker for the
 * always-on ad slots. Mirrors the rotation pattern of GravityBottomPageAd:
 *   - setInterval(refreshIntervalMs) increments a rotation counter
 *   - each tick deepens a synthesis key → fresh auction inside the same
 *     session (rotation counter is folded into a synthetic system message
 *     so the host-side sessionId derivation sees each tick as a new node)
 *   - each new `impUrl` resets `firedRef` → IntersectionObserver fires a
 *     single impression pixel at 50% viewport intersection
 *
 * Returns the resolved ad or `null` when the auction hasn't filled. Empty,
 * error and loading stay at `null` per the absent-placement invariant that
 * all the existing pills already honor — a half-filled slot is worse UX
 * than an empty one because the user reads it as a mistake.
 */
function useGravityAdRotating({
	placement,
	messages,
	refreshIntervalMs = 60_000,
	paused = false,
}: {
	placement: GravityPlacement;
	messages: { role: string; content: string }[];
	refreshIntervalMs?: number;
	/**
	 * When true, suppresses the auto-rotate interval (no fresh auctions
	 * on the timer). Used by `mid_timeline` for non-active turns — frozen
	 * historical ads shouldn't keep hitting the auction endpoint once the
	 * user has scrolled past them. Defaults to false (always rotates).
	 *
	 * Note: the initial auction still fires on mount when `paused === true`.
	 * That's intentional — frozen turns still deserve one good creative per
	 * slide-in (a publisher-revenue trade-off: we'd rather show one ad than
	 * zero). Only the rotation interval is gated. If we ever want to gate
	 * the initial fetch too, callers will need to render the empty-
	 * placeholder variant explicitly via `renderEmptyOrNull`.
	 */
	paused?: boolean;
}): GravityAdData | null {
	const [ad, setAd] = useState<GravityAdData | null>(null);
	const [rotation, setRotation] = useState(0);
	const latestKeyRef = useRef(0);

	useEffect(() => {
		if (paused) return;
		const id = setInterval(() => {
			setRotation((r) => r + 1);
		}, refreshIntervalMs);
		return () => clearInterval(id);
	}, [refreshIntervalMs, paused]);

	// Derive a stable content key from messages so callers that pass a new
	// array reference every render (e.g. an inline `messages={[...]}`
	// literal) don't bust the memo on every render. JSON.stringify gives a
	// stable string when the array's contents are unchanged.
	const messagesKey = useMemo(() => {
		try {
			return JSON.stringify(messages);
		} catch {
			return "";
		}
	}, [messages]);

	// Cycle the rotation counter into a synthetic system message so each
	// tick is a fresh graph node on the publisher dashboard. The counter
	// alone is sufficient to give Gravity a fresh per-tick auction and to
	// rotate the host-side sessionId — `messagesKey` stays internal so we
	// don't ship duplicated bytes every refresh.
	const contextMessages = useMemo<{ role: string; content: string }[]>(
		() => [
			...messages.map((m) => ({ role: m.role, content: m.content })),
			{ role: "system", content: `__rotation__:${rotation}` },
		],
		[messagesKey, rotation],
	);

	const contextKey = useMemo(() => {
		try {
			return JSON.stringify(contextMessages);
		} catch {
			return "";
		}
	}, [contextMessages]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: contextKey is the stable, rotation-derived key. Adding `contextMessages` would re-fire on every upstream reference churn during typing. `placement` is stable per component instance.
	useEffect(() => {
		if (!window.infinitecode?.gravity?.getAds) return;
		const myKey = ++latestKeyRef.current;

		async function load() {
			try {
				const ads = await window.infinitecode.gravity.getAds(
					contextMessages,
					placement,
				);
				if (myKey !== latestKeyRef.current) return;
				if (Array.isArray(ads) && ads.length > 0) {
					setAd(ads[0] as GravityAdData);
				}
			} catch (err) {
				console.error(`[gravity] ${placement} fetch failed`, err);
			}
		}

		void load();
	}, [contextKey, placement]);

	// Hook returns the ad (or null on loading/empty/error). Wrappers gate on
	// `!ad` so each placement owns its empty-state UX (collapse to zero
	// height). Keeping the gate out of the hook lets callers that want to
	// distinguish empty-vs-error render their own chrome.
	return ad;
}

/**
 * Mid-response ad — rendered between the active process timeline and the
 * final response Message bubble. Caller responsibility: only mount once
 * per turn when timeline items exist (so a thought-only response still
 * gets the section divider) otherwise gate on `hasTools` for tool-rich sessions.
 *
 * Drives a fresh auction every `refreshIntervalMs` (default 60 s) via the
 * shared `useGravityAdRotating` hook; visual shape mirrors the inline
 * footnote (`Sponsored · brand · description`) so the user reads it as
 * a section-divider blend of the inline footnote and the below_response
 * pill. Earns an impression on first 50 % viewport intersection.
 */
export function GravityMidResponseAd({
	messages,
	refreshIntervalMs = 60 * 1000,
}: {
	messages: { role: string; content: string }[];
	refreshIntervalMs?: number;
}): JSX.Element | null {
	const ad = useGravityAdRotating({
		placement: "mid_response",
		messages,
		refreshIntervalMs,
	});
	if (!ad) return renderEmptyOrNull("mid_response");
	return <ThemedGravityInlineFootnote ad={ad} slot="mid_response" />;
}

/**
 * Top-of-Page banner — full-width sticky pill anchored above the chat
 * conversation area. Always-on with 60-s rotation; mirrors the freebuff
 * waiting-room placement shape.
 *
 * Mid-timeline ad — rendered between individual Timeline items (Thought /
 * Shell / Edit / Tool result / Tool group) inside `ProcessTimelineView`.
 * Distinct from `mid_response` which sits between the FULL timeline and the
 * final response bubble. `mid_timeline` serves as a deliberate visual rest
 * between dense tool blocks; cadence lives in chat-turn.tsx and caps at
 * MAX_MID_TIMELINE_ADS_PER_TURN ads per turn so a 20-tool turn doesn't flood.
 *
 * Background-fetch thrash guard: chat-turn pauses the rotation timer when
 * `!isActiveTurn` (sets `paused=true` on the shared rotation hook) so
 * off-screen turns don't burn API budget. The currently-active turn still
 * rotates every `refreshIntervalMs` so the user sees fresh fills.
 *
 * Earns an impression on first 50% viewport intersection; same IO + click
 * semantics as the other themed pills.
 */
export function GravityMidTimelineAd({
	messages,
	refreshIntervalMs = 60 * 1000,
	paused = false,
}: {
	/** Ambient context — typically this turn's captured prompt + assistant. */
	messages: { role: string; content: string }[];
	/** 60s default; matches the always-on Tier-1 rotation cadence. */
	refreshIntervalMs?: number;
	/** Suppresses the rotation interval when true (used for non-active turns). */
	paused?: boolean;
}): JSX.Element | null {
	const ad = useGravityAdRotating({
		placement: "mid_timeline",
		messages,
		refreshIntervalMs,
		paused,
	});
	if (!ad) return renderEmptyOrNull("mid_timeline");
	return <ThemedGravityMidTimelineCard ad={ad} />;
}

/**
 * Renders the mid-timeline ad as a wider, padded card with brand /
 * description / CTA / "Ad" badge. Reads as a section break between dense
 * tool blocks, not a footnote. Same IO/click semantics (`impUrl` fired
 * once at 50% IO visibility, clickUrl routing, firedRef resets per new
 * impUrl) as the other themed pills.
 */
function ThemedGravityMidTimelineCard({
	ad,
}: {
	ad: GravityAdData;
}): JSX.Element {
	const containerRef = useRef<HTMLAnchorElement>(null);
	const firedRef = useRef(false);
	const href =
		(ad.clickUrl as string | undefined) ||
		(ad.url as string | undefined) ||
		"#";
	const description =
		(ad.adText as string | undefined) || (ad.title as string | undefined) || "";

	useEffect(() => {
		firedRef.current = false;
		const node = containerRef.current;
		const impUrl = ad.impUrl as string | undefined;
		if (!node || !impUrl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && !firedRef.current) {
						firedRef.current = true;
						new Image().src = impUrl;
						observer.disconnect();
					}
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ad.impUrl]);

	return (
		<a
			ref={containerRef}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`Sponsored: ${(ad.brandName as string | undefined) ?? "ad"}`}
			style={{
				backgroundColor: "var(--card)",
				borderColor: "var(--border)",
			}}
			className="group my-2 flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
			data-gravity-ad-slot="mid_timeline"
			data-gravity-ad-brand={(ad.brandName as string | undefined) ?? ""}
		>
			{ad.favicon ? (
				<img
					src={ad.favicon as string}
					alt=""
					className="size-5 shrink-0 rounded-sm"
				/>
			) : null}
			<span
				className="shrink-0 text-[10px] font-medium uppercase tracking-wider opacity-70"
				style={{ color: "var(--muted-foreground)" }}
			>
				Sponsored
			</span>
			<span
				className="shrink-0 text-sm font-semibold leading-none"
				style={{ color: "var(--foreground)" }}
			>
				{(ad.brandName as string | undefined) ?? ""}
			</span>
			{description ? (
				<>
					<span
						className="shrink-0 leading-none opacity-50"
						style={{ color: "var(--muted-foreground)" }}
						aria-hidden="true"
					>
						·
					</span>
					<span
						className="min-w-0 flex-1 truncate text-xs leading-none"
						style={{ color: "var(--muted-foreground)" }}
					>
						{description}
					</span>
				</>
			) : null}
			{ad.cta ? (
				<span
					className="shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
					style={{
						color: "var(--foreground)",
						borderColor: "var(--border)",
					}}
				>
					{(ad.cta as string) ?? ""}
				</span>
			) : null}
			<span
				className="shrink-0 text-[10px] font-medium uppercase tracking-wider opacity-50"
				style={{ color: "var(--muted-foreground)" }}
			>
				Ad
			</span>
		</a>
	);
}

/**
 * Sidebar banner — narrow banner for the InfiniteCode session sidebar.
 * Sidebar banner — narrow banner for the InfiniteCode session sidebar.
 * Caller is responsible for the surrounding container (e.g. sidebar.tsx
 * next to the sessions list); this component just renders the pill content.
 *
 * Use sparingly: render once per session sidebar mount and let the 60-s
 * timer drive rotations. The sidebar is on every page, so this slot earns
 * many impressions per session — the highest-value Tier-1 placement.
 */
export function GravitySidebarBanner({
	messages,
	refreshIntervalMs = 60 * 1000,
}: {
	messages: { role: string; content: string }[];
	refreshIntervalMs?: number;
}): JSX.Element | null {
	const ad = useGravityAdRotating({
		placement: "sidebar",
		messages,
		refreshIntervalMs,
	});
	if (!ad) return renderEmptyOrNull("sidebar");
	return (
		<ThemedGravityCornerPill
			ad={ad}
			placement="sidebar"
		/>
	);
}

/**
 * Renders a Gravity ad as a corner pill variant for the rotating `sidebar`
 * placement. Visually parallel to `ThemedGravityBottomPagePill` minus the
 * bottom-specific margin offsets — the caller controls absolute positioning.
 *
 * IO + click semantics match the existing themed pills exactly:
 *   - `impUrl` fired once at 50% IO visibility via per-`impUrl` firedRef
 *   - clickUrl || url || "#" href routing for attribution
 *   - data-gravity-ad-slot + data-gravity-ad-brand hooks for analytics
 */
function ThemedGravityCornerPill({
	ad,
	placement,
	variant = "pill",
}: {
	ad: GravityAdData;
	placement: GravityPlacement;
	/**
	 * Visual layout:
	 *   - "pill"  (default) — compact horizontal row, used by sidebar +
	 *                          chat composer + settings footer. Canonical
	 *                          shape across all chat-context placements.
	 *   - "square"           — centered square card. Unused by current
	 *                          InfiniteCode placements; reserved as a
	 *                          documented option for hypothetical future
	 *                          placements that need a centered stack. Type
	 *                          retained to avoid a breaking API change if
	 *                          a new placement adopts it later.
	 *
	 * Both variants keep IO + click semantics identical. The pill variant
	 * matches the bottom_page / above_response / below_response / mid_
	 * timeline / inline_response / mid_response / startup_overlay cards so
	 * the user reads the same shape no matter which surface the ad appears
	 * on. Sidebar uses pill (compact) instead of the old square card so it
	 * takes vertically less space inside the narrow ~250 px sidebar gutter.
	 * The square variant is reserved for hypothetical future use.
	 */
	variant?: "pill" | "square";
}): JSX.Element {
	const containerRef = useRef<HTMLAnchorElement>(null);
	const firedRef = useRef(false);
	const href =
		(ad.clickUrl as string | undefined) ||
		(ad.url as string | undefined) ||
		"#";
	const description =
		(ad.adText as string | undefined) ||
		(ad.title as string | undefined) ||
		"";
	const cta =
		(ad.cta as string | undefined) ||
		"";

	useEffect(() => {
		firedRef.current = false;
		const node = containerRef.current;
		const impUrl = ad.impUrl as string | undefined;
		if (!node || !impUrl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && !firedRef.current) {
						firedRef.current = true;
						new Image().src = impUrl;
						observer.disconnect();
					}
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ad.impUrl]);

	if (variant === "square") {
		return (
			<a
				ref={containerRef}
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Sponsored: ${(ad.brandName as string | undefined) ?? "ad"}`}
				style={{
					backgroundColor: "var(--card)",
					borderColor: "var(--border)",
				}}
				className="group mx-auto flex aspect-square w-full max-w-[180px] flex-col items-center justify-between gap-1.5 overflow-hidden rounded-lg border px-4 py-4 text-center transition-colors"
				data-gravity-ad-slot={placement}
				data-gravity-ad-brand={(ad.brandName as string | undefined) ?? ""}
			>
				<div className="flex flex-col items-center gap-1.5">
					{ad.favicon ? (
						<img
							src={ad.favicon as string}
							alt=""
							className="size-7 shrink-0 rounded-md"
						/>
					) : null}
					<span
						className="line-clamp-1 text-[13px] font-semibold leading-tight"
						style={{ color: "var(--foreground)" }}
					>
						{(ad.brandName as string | undefined) ?? ""}
					</span>
					{description ? (
						<span
							className="line-clamp-3 text-[11px] leading-snug"
							style={{ color: "var(--muted-foreground)" }}
						>
							{description}
						</span>
					) : null}
				</div>
				<span
					className="mt-auto text-[10px] font-medium uppercase tracking-wider opacity-70"
					style={{ color: "var(--muted-foreground)" }}
				>
					{cta || "Ad"}
				</span>
			</a>
		);
	}

	return (
		<a
			ref={containerRef}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`Sponsored: ${(ad.brandName as string | undefined) ?? "ad"}`}
			style={{
				backgroundColor: "var(--card)",
				borderColor: "var(--border)",
			}}
			className="group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors"
			data-gravity-ad-slot={placement}
			data-gravity-ad-brand={(ad.brandName as string | undefined) ?? ""}
		>
			{ad.favicon ? (
				<img
					src={ad.favicon as string}
					alt=""
					className="size-5 shrink-0 rounded-sm"
				/>
			) : null}
			<span
				className="shrink-0 text-sm font-semibold leading-none"
				style={{ color: "var(--foreground)" }}
			>
				{(ad.brandName as string | undefined) ?? ""}
			</span>
			{description ? (
				<>
					<span
						className="shrink-0 leading-none opacity-50"
						style={{ color: "var(--muted-foreground)" }}
						aria-hidden="true"
					>
						·
					</span>
					<span
						className="min-w-0 flex-1 truncate text-sm leading-none"
						style={{ color: "var(--muted-foreground)" }}
					>
						{description}
					</span>
				</>
			) : null}
			<span
				className="shrink-0 text-[10px] font-medium uppercase leading-none tracking-wider opacity-70"
				style={{ color: "var(--muted-foreground)" }}
			>
				Ad
			</span>
		</a>
	);
}

// ============================================================
// Tier-2 placement: startup_overlay
// Full-screen loading splash shown during cold boot (between splash hide
// and main app render). Renders a Gravity card centered above the "By AFS
// Agentics" attribution line so the loading wait time earns impressions on
// a placement that would otherwise be a dead pixel.
//
// Treats boot time as ambient context: there's no conversation at mount, so
// the auction matches against a generic "infinitecode desktop startup" hook
// rather than per-turn user text. Like the other always-on slots, the
// rotator cycles on a 60-s timer so a slow boot still resolves fresh fills;
// the IntersectionObserver fires once at 50% viewport (the overlay covers
// 100% of the viewport, so this resolves immediately on first paint in
// practice, not on scroll-in).
//
// Cleanup is automatic: when `phase === "ready"` the React overlay
// unmounts, the useGravityAdRotating hook's setInterval is cleared, and the
// IO observer disconnects via the standard useEffect return. No race with
// app boot — the IPC channel is wired before React mounts.
// ============================================================

/**
 * Sprite context messages stamped into the auction when the user has no
 * active conversation. Stable across mounts so a single boot reuses the
 * same context key for the initial fetch; only the rotation counter
 * diversifies on each 60-s tick. Kept as a module-level constant so JSON
 * serialization in `useGravityAdRotating` doesn't churn on every render.
 */
const STARTUP_OVERLAY_CONTEXT_MESSAGES: { role: string; content: string }[] =
	[
		{ role: "system", content: "infinitecode desktop startup" },
		{ role: "system", content: "cold boot — no active session" },
	];

/**
 * Startup Overlay ad — centered card rendered above the "By AFS Agentics"
 * attribution line during the cold-boot loading splash. Reuses the shared
 * `useGravityAdRotating` hook so the cadence, IO semantics, and click
 * routing match the other always-on placements (sidebar, bottom_page,
 * mid_response, mid_timeline).
 *
 * Caller responsibilities:
 *   - Mount only inside the StartupOverlay component (a fixed full-screen
 *     splash). Mounting elsewhere won't hurt correctness but the IO
 *     observer needs at least 50% viewport intersection — anything below
 *     the fold will underreport impressions.
 *   - Wrap the rendered pill in a centering container (e.g.
 *     `<div className="mx-auto w-full max-w-md px-6 pb-3">`) so the pill
 *     floats above the attribution text on variable screen widths.
 *
 * Attribution: same rules as the other pills — `impUrl` fired once at 50%
 * IO visibility, clickUrl routing, firedRef resets per new `impUrl`. The
 * 60-s rotation fires just inside the boot window on slow cold starts;
 * fast boots (< 60 s from splash hide to overlay unmount) earn only the
 * initial fill.
 *
 * Visual: pill chrome identical to `ThemedGravityBottomPagePill` (rounded
 * card, brand · description · "Ad" label, theme-bound colors). No CTA
 * button — startup loading is too transient for a meaningful action.
 *
 * @example
 *   <StartupOverlayAdCell>
 *     <GravityStartupOverlayAd />
 *   </StartupOverlayAdCell>
 */
export function GravityStartupOverlayAd({
	refreshIntervalMs = 60 * 1000,
}: {
	/** 60s default; matches the always-on Tier-1 rotation cadence. */
	refreshIntervalMs?: number;
}): JSX.Element | null {
	const ad = useGravityAdRotating({
		placement: "startup_overlay",
		messages: STARTUP_OVERLAY_CONTEXT_MESSAGES,
		refreshIntervalMs,
	});
	if (!ad) return renderEmptyOrNull("startup_overlay");
	return <ThemedGravityOverlayCard ad={ad} />;
}

/**
 * Renders the startup-overlay ad as a wide centered pill matching the
 * other wide-card placements' visual treatment. Inline style carries the
 * theme tokens (CSS variables defined on `:root`) since `@theme` doesn't
 * expose them as Tailwind utilities.
 *
 * Slot-specific semantics:
 *   - `data-gravity-ad-slot="startup_overlay"` reports boot-surface
 *     impressions distinctly from chat-context impressions so the
 *     dashboard's per-slot CTR reflects the placement's actual
 *     performance.
 *   - No `mb-2` margin here — the StartupOverlay parent owns vertical
 *     spacing (it has `flex flex-col` + `pb-4` on the attribution
 *     paragraph, so we keep this pill agnostic of mount context).
 *
 * IO + click semantics match the existing themed pills exactly:
 *   - `impUrl` fired once at 50% IO visibility via per-`impUrl` firedRef
 *   - clickUrl || url || "#" href routing for attribution
 *   - data-gravity-ad-slot + data-gravity-ad-brand hooks for analytics
 */
function ThemedGravityOverlayCard({
	ad,
}: {
	ad: GravityAdData;
}): JSX.Element {
	const containerRef = useRef<HTMLAnchorElement>(null);
	const firedRef = useRef(false);
	const href =
		(ad.clickUrl as string | undefined) ||
		(ad.url as string | undefined) ||
		"#";
	const description =
		(ad.adText as string | undefined) ||
		(ad.title as string | undefined) ||
		"";

	useEffect(() => {
		// Per-imp reset — each new ad (different impUrl) fires its own impression.
		// The overlay covers 100% of the viewport, so the IO observer resolves
		// at first paint in practice (50% threshold is comfortably met).
		firedRef.current = false;
		const node = containerRef.current;
		const impUrl = ad.impUrl as string | undefined;
		if (!node || !impUrl) return;

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting && !firedRef.current) {
						firedRef.current = true;
						new Image().src = impUrl;
						observer.disconnect();
					}
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [ad.impUrl]);

	return (
		<a
			ref={containerRef}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`Sponsored: ${(ad.brandName as string | undefined) ?? "ad"}`}
			style={{
				backgroundColor: "var(--card)",
				borderColor: "var(--border)",
				// StartupOverlay's parent uses `-webkit-app-region: drag` to act as
				// a window-drag handle on macOS. Without `no-drag` here, click-and-
				// drag on the ad would also drag the window — confusing UX. Vendor-
				// prefixed property, hence the @ts-expect-error mirror of the
				// parent's pattern.
				// @ts-expect-error -- vendor-prefixed CSS property
				WebkitAppRegion: "no-drag",
			}}
			className="group flex w-full items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
			data-gravity-ad-slot="startup_overlay"
			data-gravity-ad-brand={(ad.brandName as string | undefined) ?? ""}
		>
			{ad.favicon ? (
				<img
					src={ad.favicon as string}
					alt=""
					className="size-5 shrink-0 rounded-sm"
				/>
			) : null}
			<span
				className="shrink-0 text-sm font-semibold leading-none"
				style={{ color: "var(--foreground)" }}
			>
				{(ad.brandName as string | undefined) ?? ""}
			</span>
			{description ? (
				<>
					<span
						className="shrink-0 leading-none opacity-50"
						style={{ color: "var(--muted-foreground)" }}
						aria-hidden="true"
					>
						·
					</span>
					<span
						className="min-w-0 flex-1 truncate text-sm leading-none"
						style={{ color: "var(--muted-foreground)" }}
					>
						{description}
					</span>
				</>
			) : null}
			<span
				className="shrink-0 text-[10px] font-medium uppercase leading-none tracking-wider opacity-70"
				style={{ color: "var(--muted-foreground)" }}
			>
				Ad
			</span>
		</a>
	);
}
