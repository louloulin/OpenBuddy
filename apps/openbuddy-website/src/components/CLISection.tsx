import { Terminal } from 'lucide-react';
import type { Dict } from '@/lib/i18n';
import { SectionHeader } from './FeaturesSection';

interface CLISectionProps {
  dict: Dict;
}

/**
 * CLISection —— "现场演示"区块
 *
 * 设计要点：
 * - 大型终端窗口，左右两栏对话示例
 * - 终端内彩色语法：command 蓝、output 灰、success 绿
 * - 顶部小标题 "Try it without installing"
 */
export default function CLISection({ dict }: CLISectionProps) {
  return (
    <section className="relative bg-[var(--wb-bg-dark)] py-24 text-white sm:py-32">
      <div className="absolute inset-0 -z-10 bg-editor-grid opacity-20" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 justify-center text-[var(--wb-fg-muted)]">
            <Terminal className="h-4 w-4" />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
              { dict.cli.sectionLabel }
            </span>
          </div>
          <h2 className="mt-4 font-display text-display-lg text-balance text-white">
            { dict.cli.title }
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-[15px] leading-relaxed text-[#8B949E] sm:text-[16px]">
            { dict.cli.subtitle }
          </p>
        </div>

        {/* Terminal */}
        <div className="mx-auto mt-16 max-w-4xl overflow-hidden rounded-xl border border-white/10 bg-[#0E1117] shadow-2xl shadow-brand-9/20">
          <div className="flex items-center gap-2 border-b border-white/10 bg-[#161B22] px-4 py-2.5">
            <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
            <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
            <span className="h-3 w-3 rounded-full bg-[#28C840]" />
            <span className="ml-3 font-mono text-[11px] text-[#8B949E]">
              ~/openbuddy — zsh — 96×24
            </span>
          </div>

          <div className="space-y-6 p-6 font-mono text-[13px]">
            { dict.cli.commands.map((cmd, idx) => (
              <div key={ idx } className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="select-none text-brand-8">❯</span>
                  <span className="text-white">{ cmd.prompt }</span>
                </div>
                <pre className="ml-5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#8B949E]">
                  { cmd.response }
                </pre>
                { idx < dict.cli.commands.length - 1 ? (
                  <div className="ml-5 h-px w-12 bg-white/10" />
                ) : null }
              </div>
            )) }

            {/* Live prompt */}
            <div className="flex items-center gap-2 pt-2">
              <span className="select-none text-brand-8">❯</span>
              <span className="inline-block h-3.5 w-2 animate-cursor-blink bg-white" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}