"use client";

import Link from "next/link";
import { useState } from "react";

import { installCommands, type InstallId, type LandingCopy } from "./data";
import { CopyIcon } from "./icons";

const installTabs = ["unix", "windows", "source"] as const;

type InstallSectionProps = {
  copy: LandingCopy["install"];
  docsHref: string;
};

export function InstallSection({ copy, docsHref }: InstallSectionProps) {
  const [activeInstall, setActiveInstall] = useState<InstallId>("unix");
  const [copied, setCopied] = useState(false);
  const command = installCommands[activeInstall];

  async function copyInstallCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section
      id="install"
      className="bg-[#ece7dc] px-5 py-20 text-[#111416] sm:px-8 lg:px-10"
    >
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#995313]">
            {copy.kicker}
          </p>
          <h2 className="mt-4 text-4xl font-semibold tracking-normal sm:text-5xl">
            {copy.title}
          </h2>
          <p className="mt-6 max-w-lg text-lg leading-8 text-black/62">
            {copy.body}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              className="inline-flex min-h-12 items-center justify-center gap-2 border border-[#111416]/20 px-5 text-sm font-bold text-[#111416] transition hover:border-[#111416]/40 hover:bg-white/45"
              href={docsHref}
            >
              {copy.docs}
            </Link>
            <a
              className="inline-flex min-h-12 items-center justify-center gap-2 border border-[#111416]/20 px-5 text-sm font-bold text-[#111416] transition hover:border-[#111416]/40 hover:bg-white/45"
              href="https://github.com/7df-lab/devo"
              rel="noreferrer"
              target="_blank"
            >
              {copy.github}
            </a>
          </div>
        </div>
        <div className="overflow-hidden border border-[#111416]/20 bg-[#090d11] shadow-[0_2rem_5rem_rgb(17_20_22_/_20%)]">
          <div
            className="flex gap-1 overflow-x-auto border-b border-white/10 p-1.5"
            role="tablist"
            aria-label={copy.tabAria}
          >
            {installTabs.map((tab) => (
              <button
                aria-selected={activeInstall === tab}
                className="min-h-10 whitespace-nowrap px-4 text-sm font-bold text-white/60 transition-colors aria-selected:bg-[#ff941f]/20 aria-selected:text-[#ffbd75]"
                key={tab}
                onClick={() => setActiveInstall(tab)}
                role="tab"
                type="button"
              >
                {copy.tabs[tab]}
              </button>
            ))}
          </div>
          <div className="flex min-h-14 items-center justify-between gap-4 border-b border-white/10 px-4 pl-5 font-mono text-sm text-white/55">
            <span>{copy.terminalTitle}</span>
            <button
              className="inline-flex min-h-10 items-center gap-2 border border-white/15 px-3 font-sans text-sm font-bold text-white transition hover:border-white/30 hover:bg-white/10"
              onClick={copyInstallCommand}
              type="button"
            >
              <CopyIcon />
              {copied ? copy.copied : copy.copy}
            </button>
          </div>
          <pre className="min-h-48 overflow-x-auto whitespace-pre-wrap break-words p-6 font-mono text-[clamp(0.9rem,1.3vw,1.05rem)] leading-8 text-[#f5efe4]">
            <code>{command}</code>
          </pre>
        </div>
      </div>
    </section>
  );
}
