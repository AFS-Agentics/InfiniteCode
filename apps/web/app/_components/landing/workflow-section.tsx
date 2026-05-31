import Image from "next/image";

import { type LandingCopy } from "./data";

type WorkflowSectionProps = {
  copy: LandingCopy["workflow"];
};

export function WorkflowSection({ copy }: WorkflowSectionProps) {
  return (
    <section className="bg-[#070a0f] px-5 py-20 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#ffb057]/85">
            {copy.kicker}
          </p>
          <h2 className="mt-4 max-w-xl text-4xl font-semibold tracking-normal text-white sm:text-5xl">
            {copy.title}
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-white/62">
            {copy.body}
          </p>
        </div>
        <div className="relative min-h-[27rem] md:min-h-[clamp(25rem,52vw,43rem)]">
          <Image
            src="/cli.png"
            alt={copy.imageAlt}
            width={1104}
            height={621}
            className="absolute right-0 top-0 h-auto w-[min(92vw,34rem)] border border-white/12 shadow-[0_2rem_5rem_rgb(0_0_0_/_42%)] md:w-[min(78vw,43rem)]"
          />
          <div className="absolute bottom-0 left-0 h-auto w-[min(78vw,27rem)] border border-white/12 bg-[linear-gradient(135deg,rgb(255_148_31_/_12%),transparent_42%),#0a0f14] p-5 shadow-[0_2rem_5rem_rgb(0_0_0_/_42%)] md:w-[min(72vw,35rem)]">
            <p className="text-xs uppercase tracking-[0.18em] text-orange-200/72">
              {copy.noteLabel}
            </p>
            <p className="mt-4 font-mono text-sm leading-7 text-white/74">
              {copy.noteLines.map((line) => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
