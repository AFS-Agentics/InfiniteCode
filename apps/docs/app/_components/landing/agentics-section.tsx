import Link from "next/link";
import { type ReactNode } from "react";

import { type LandingCopy, type Locale } from "./data";
import { renderWithInfiniteCodeMark } from "./infinitecode-word";
import { ArrowIcon } from "./icons";

type AgenticsSectionProps = {
  copy: LandingCopy["agentics"];
  locale: Locale;
};

type AgenticFeature = AgenticsSectionProps["copy"]["features"][number];

function localizeHref(
  href: string | undefined,
  locale: Locale,
): string | undefined {
  if (!href) {
    return href;
  }
  if (locale === "zh" && href.startsWith("/docs/")) {
    return `/zh${href}`;
  }
  return href;
}

const accentPalette = {
  blue: {
    halo: "from-[#60A5FA]/30 via-[#60A5FA]/10 to-transparent",
    chip: "border-[#60A5FA]/35 bg-[#60A5FA]/12 text-[#bfdbfe]",
    bullet: "bg-[#60A5FA]",
    iconTint: "text-[#bfdbfe]",
    linkTint: "text-[#bfdbfe]",
    ring: "shadow-[0_0_3.5rem_rgb(96_165_250_/_18%)]",
  },
  orange: {
    halo: "from-[#ff941f]/30 via-[#ff941f]/10 to-transparent",
    chip: "border-[#ff941f]/40 bg-[#ff941f]/14 text-[#ffd3a1]",
    bullet: "bg-[#ff941f]",
    iconTint: "text-[#ffd3a1]",
    linkTint: "text-[#ffd3a1]",
    ring: "shadow-[0_0_3.5rem_rgb(255_148_31_/_18%)]",
  },
  violet: {
    halo: "from-[#a78bfa]/30 via-[#a78bfa]/10 to-transparent",
    chip: "border-[#a78bfa]/35 bg-[#a78bfa]/14 text-[#ddd6fe]",
    bullet: "bg-[#a78bfa]",
    iconTint: "text-[#ddd6fe]",
    linkTint: "text-[#ddd6fe]",
    ring: "shadow-[0_0_3.5rem_rgb(167_139_250_/_18%)]",
  },
  green: {
    halo: "from-[#34d399]/30 via-[#34d399]/10 to-transparent",
    chip: "border-[#34d399]/35 bg-[#34d399]/14 text-[#a7f3d0]",
    bullet: "bg-[#34d399]",
    iconTint: "text-[#a7f3d0]",
    linkTint: "text-[#a7f3d0]",
    ring: "shadow-[0_0_3.5rem_rgb(52_211_153_/_18%)]",
  },
} as const;

function FeatureIcon({ kind }: { kind: AgenticFeature["icon"] }) {
  const common = "h-5 w-5";

  if (kind === "review") {
    return (
      <svg
        aria-hidden="true"
        className={common}
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H9l-4 4v-4H5.5A1.5 1.5 0 0 1 4 14.5v-9Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
        <path
          d="m8.5 9.7 2.1 2.1L15.7 6.7"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  if (kind === "mic") {
    return (
      <svg
        aria-hidden="true"
        className={common}
        fill="none"
        viewBox="0 0 24 24"
      >
        <rect
          x="9"
          y="3"
          width="6"
          height="12"
          rx="3"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M5 11a7 7 0 0 0 14 0M12 18v3.5M9 21.5h6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  if (kind === "search") {
    return (
      <svg
        aria-hidden="true"
        className={common}
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          cx="11"
          cy="11"
          r="6"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="m20 20-4-4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
        <path
          d="M11 8v6M8 11h6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  // sliders
  return (
    <svg aria-hidden="true" className={common} fill="none" viewBox="0 0 24 24">
      <path
        d="M4 7h11.5M18.5 7H20M4 12h4.5M7.5 12H20M4 17h13.5M20.5 17H20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
      <circle cx="16" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="17" r="2.2" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function FeatureCard({
  feature,
  locale,
}: {
  feature: AgenticFeature;
  locale: Locale;
}) {
  const accent = accentPalette[feature.accent];
  const localizedHref = localizeHref(feature.href, locale);

  return (
    <article
      className={[
        "relative isolate flex flex-col gap-5 overflow-hidden border border-white/12 bg-[#0a0f14] p-6 transition-transform",
        accent.ring,
      ].join(" ")}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-px h-32 bg-[radial-gradient(circle_at_top,rgb(255_255_255_/_0.04),transparent_60%)]"
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 bg-gradient-to-b ${accent.halo} opacity-60 mix-blend-screen`}
      />

      <header className="relative flex items-center justify-between gap-4">
        <span
          className={`inline-flex h-10 w-10 items-center justify-center border ${accent.chip}`}
        >
          <span className={accent.iconTint}>
            <FeatureIcon kind={feature.icon} />
          </span>
        </span>
        <span className="inline-flex items-center gap-2 border border-white/14 bg-white/[0.04] px-2.5 py-1 font-mono text-[0.66rem] uppercase tracking-[0.18em] text-white/58">
          <span className={`h-1.5 w-1.5 rounded-full ${accent.bullet}`} />
          v0.1.31
        </span>
      </header>

      <div className="relative">
        <h3 className="text-2xl font-semibold tracking-normal text-white">
          {feature.title}
        </h3>
        <p className="mt-3 text-sm leading-7 text-white/58">
          {renderWithInfiniteCodeMark(feature.body)}
        </p>
      </div>

      <ul className="relative flex flex-col gap-2.5 border-t border-white/10 pt-5">
        {feature.bullets.map((bullet) => (
          <li
            className="grid grid-cols-[0.85rem_1fr] items-start gap-3 text-sm leading-6 text-white/74"
            key={bullet}
          >
            <span
              aria-hidden="true"
              className={`mt-[0.55rem] h-1.5 w-1.5 ${accent.bullet}`}
            />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      {localizedHref ? (
        <footer className="relative mt-auto flex items-center justify-between border-t border-white/10 pt-5">
          <Link
            className={`inline-flex items-center gap-2 text-sm font-bold ${accent.linkTint} transition hover:opacity-80`}
            href={localizedHref}
          >
            Read more
            <ArrowIcon />
          </Link>
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-white/36">
            docs
          </span>
        </footer>
      ) : null}
    </article>
  );
}

export function AgenticsSection({ copy, locale }: AgenticsSectionProps) {
  return (
    <section
      className="relative isolate overflow-hidden border-y border-white/10 bg-[#080c11] px-5 py-24 sm:px-8 lg:px-10"
      id="agentics"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_28%_22%,rgb(255_148_31_/_16%),transparent_22rem),radial-gradient(circle_at_82%_78%,rgb(96_165_250_/_14%),transparent_22rem)]"
      />

      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-8 pb-12 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1.38fr)] lg:items-end lg:gap-14">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#60A5FA]">
              {copy.kicker}
            </p>
            <h2 className="mt-5 max-w-xl text-4xl font-semibold tracking-normal text-white sm:text-5xl">
              {copy.title}
            </h2>
          </div>
          <div>
            <p className="max-w-2xl text-lg leading-8 text-white/62">
              {renderWithInfiniteCodeMark(copy.body)}
            </p>
            <div className="mt-5 inline-flex items-center gap-2 border border-white/14 bg-white/[0.04] px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-white/58">
              <span className="h-1.5 w-1.5 rounded-full bg-[#34d399] shadow-[0_0_0.75rem_rgb(52_211_153_/_70%)]" />
              released in v0.1.31
            </div>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {copy.features.map((feature) => (
            <FeatureCard
              feature={feature}
              key={feature.title}
              locale={locale}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
