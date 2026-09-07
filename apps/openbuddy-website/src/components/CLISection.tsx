import { Terminal } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface CLISectionProps {
  dict: Dict;
}

/**
 * CLISection —— tutti 风格 (深色海军面板)
 */
export default function CLISection({ dict }: CLISectionProps) {
  return (
    <section className="relative bg-[#0A0F1E] py-24 text-white sm:py-32">
      <div className="absolute inset-0 -z-10 opacity-15 bg-editor-grid" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/40">
              { dict.cli.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-white/40">06</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-white">
            { dict.cli.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-white/60">
          { dict.cli.subtitle }
        </p>

        {/* Terminal */}
        <div className="mt-16 overflow-hidden rounded-lg border border-white/10 bg-[#010409]">
          <div className="flex items-center gap-2 border-b border-white/10 bg-[#111827] px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <span className="ml-3 flex items-center gap-1.5 font-mono text-[11px] text-white/40">
              <Terminal className="h-3 w-3" />
              ~/openbuddy — pnpm electron:dev
            </span>
            <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-white/30">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
              </span>
              live
            </span>
          </div>

          <div className="space-y-6 p-6 font-mono text-[13px]">
            { dict.cli.commands.map((cmd, idx) => (
              <div key={ idx } className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="select-none text-[#22C55E]">❯</span>
                  <span className="text-white">{ cmd.prompt }</span>
                </div>
                <pre className="ml-5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/55">
                  { cmd.response }
                </pre>
                { idx < dict.cli.commands.length - 1 ? (
                  <div className="ml-5 h-px w-12 bg-white/10" />
                ) : null }
              </div>
            )) }

            <div className="flex items-center gap-2 pt-2">
              <span className="select-none text-[#22C55E]">❯</span>
              <span className="inline-block h-3.5 w-2 animate-cursor-blink bg-white" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}