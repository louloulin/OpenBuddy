import { Terminal } from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface CLISectionProps {
  dict: Dict;
}

/**
 * CLISection —— 跟随 global theme (终端框保留深色作为 UI 元素)
 */
export default function CLISection({ dict }: CLISectionProps) {
  return (
    <section className="relative section-pad">
      <div className="absolute inset-0 -z-10 opacity-15 bg-editor-grid" />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-end gap-6 md:grid-cols-[100px_1fr] md:gap-10">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--wb-fg-faint)]">
              § 08
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              { dict.cli.sectionLabel }
            </span>
          </div>
          <h2 className="text-display-xl text-[var(--wb-fg)] text-balance">
            { dict.cli.title }
          </h2>
        </div>
        { dict.cli.subtitle ? (
          <p className="mt-6 max-w-2xl text-body-lg text-[var(--wb-fg-muted)] text-pretty md:ml-[120px]">
            { dict.cli.subtitle }
          </p>
        ) : null }

        {/* Terminal 框 —— 作为 UI 元素, 始终深色, 这是真实终端的样式 */}
        <div className="mt-16 overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[#0A0A0A]">
          <div className="flex items-center gap-2 border-b border-white/10 bg-[#111113] px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
            <span className="ml-3 flex items-center gap-1.5 font-mono text-[11.5px] text-white/65">
              <Terminal className="h-3 w-3" />
              ~/openbuddy — pnpm electron:dev
            </span>
          </div>

          <div className="space-y-6 p-7 font-mono text-[13px]">
            { dict.cli.commands.map((cmd, idx) => (
              <div key={ idx } className="space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="select-none text-[#22C55E]">❯</span>
                  <span className="text-white">{ cmd.prompt }</span>
                </div>
                <pre className="ml-6 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/65">
                  { cmd.response }
                </pre>
                { idx < dict.cli.commands.length - 1 ? (
                  <div className="ml-6 h-px w-12 bg-white/10" />
                ) : null }
              </div>
            )) }

            <div className="flex items-center gap-2.5 pt-2">
              <span className="select-none text-[#22C55E]">❯</span>
              <span className="inline-block h-4 w-2 animate-cursor-blink bg-white" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
