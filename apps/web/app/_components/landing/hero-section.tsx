import Image from "next/image";
import Link from "next/link";

import { type LandingCopy, type Locale } from "./data";
import { ArrowIcon } from "./icons";

type HeroSectionProps = {
  copy: LandingCopy;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
};

export function HeroSection({
  copy,
  locale,
  onLocaleChange,
}: HeroSectionProps) {
  return (
    <section className="relative isolate min-h-[94vh] overflow-hidden md:min-h-[92vh]">
      <Image
        src="/devo-hero-halftone.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-[64%_center] md:object-center"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,10,15,0.98)_0%,rgba(7,10,15,0.88)_34%,rgba(7,10,15,0.38)_67%,rgba(7,10,15,0.1)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_58%,rgba(255,139,24,0.14),transparent_32%),linear-gradient(180deg,rgba(7,10,15,0)_55%,#070a0f_100%)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 text-base font-bold tracking-normal text-white"
          aria-label="Devo home"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center border border-white/15 bg-white/8 font-mono text-[#ffb057]">
            &gt;_
          </span>
          <span>Devo</span>
        </Link>
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
          <nav className="grid grid-cols-4 items-center gap-1 rounded-full border border-white/12 bg-black/22 p-1 text-sm text-white/72 backdrop-blur-md sm:flex">
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-full px-3 transition-colors hover:bg-white/10 hover:text-white sm:min-h-9 sm:px-4"
              href={locale === "zh" ? "/zh/docs" : "/docs"}
            >
              {copy.nav.docs}
            </Link>
            <a
              className="inline-flex min-h-10 items-center justify-center rounded-full px-3 transition-colors hover:bg-white/10 hover:text-white sm:min-h-9 sm:px-4"
              href="#install"
            >
              {copy.nav.install}
            </a>
            <a
              className="inline-flex min-h-10 items-center justify-center rounded-full px-3 transition-colors hover:bg-white/10 hover:text-white sm:min-h-9 sm:px-4"
              href="#contact"
            >
              {copy.nav.contact}
            </a>
            <a
              className="inline-flex min-h-10 items-center justify-center rounded-full px-3 transition-colors hover:bg-white/10 hover:text-white sm:min-h-9 sm:px-4"
              href="https://github.com/7df-lab/devo"
              rel="noreferrer"
              target="_blank"
            >
              {copy.nav.github}
            </a>
          </nav>
          <div
            aria-label={copy.language.label}
            className="grid grid-cols-2 rounded-full border border-white/12 bg-black/22 p-1 text-xs font-bold text-white/64 backdrop-blur-md"
            role="group"
          >
            <button
              aria-pressed={locale === "en"}
              className="min-h-9 rounded-full px-3 transition-colors aria-pressed:bg-white/12 aria-pressed:text-white hover:bg-white/10 hover:text-white"
              onClick={() => onLocaleChange("en")}
              type="button"
            >
              {copy.language.en}
            </button>
            <button
              aria-pressed={locale === "zh"}
              className="min-h-9 rounded-full px-3 transition-colors aria-pressed:bg-white/12 aria-pressed:text-white hover:bg-white/10 hover:text-white"
              onClick={() => onLocaleChange("zh")}
              type="button"
            >
              {copy.language.zh}
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex min-h-[calc(92vh-84px)] w-full max-w-7xl items-center px-5 pb-16 pt-8 sm:px-8 lg:px-10">
        <div className="max-w-3xl">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-orange-100">
            {copy.hero.badge}
          </div>
          <h1 className="text-[clamp(3.6rem,10vw,8.8rem)] font-semibold leading-[0.84] tracking-normal text-white">
            Devo
          </h1>
          <p className="mt-6 max-w-2xl text-balance text-xl leading-8 text-white/76 sm:text-2xl sm:leading-9">
            {copy.hero.body}
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              className="inline-flex min-h-12 items-center justify-center gap-2 bg-[#ff941f] px-5 text-sm font-bold text-[#080a0e] transition hover:-translate-y-px hover:bg-[#ffb45f]"
              href="#install"
            >
              {copy.hero.primaryCta}
              <ArrowIcon />
            </a>
            <Link
              className="inline-flex min-h-12 items-center justify-center gap-2 border border-white/20 bg-white/7 px-5 text-sm font-bold text-white transition hover:-translate-y-px hover:border-white/35 hover:bg-white/12"
              href={locale === "zh" ? "/zh/docs" : "/docs"}
            >
              {copy.hero.secondaryCta}
            </Link>
          </div>
          <dl className="mt-12 grid max-w-xl grid-cols-3 gap-px overflow-hidden border-y border-white/12 bg-white/12 text-sm">
            {copy.hero.metrics.map(([value, label]) => (
              <div className="bg-[#080c12]/82 px-4 py-4" key={label}>
                <dt className="text-lg font-semibold text-white">{value}</dt>
                <dd className="mt-1 text-white/48">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
