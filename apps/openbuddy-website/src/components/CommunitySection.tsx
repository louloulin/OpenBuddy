import {
  MessageCircle,
  CircleDot,
  MessagesSquare,
  UsersRound,
  Video,
  Youtube,
  ArrowUpRight,
  type LucideIcon
} from 'lucide-react';
import type { Dict } from '@/lib/i18n';

interface CommunitySectionProps {
  dict: Dict;
}

const ICON_MAP: Record<string, LucideIcon> = {
  'message-circle': MessageCircle,
  'circle-dot': CircleDot,
  'messages-square': MessagesSquare,
  'users-round': UsersRound,
  video: Video,
  youtube: Youtube
};

/**
 * CommunitySection —— tutti 风格重做
 *
 * - 简洁列表式
 * - 编号 + icon + 名称 + 描述 + 箭头
 */
export default function CommunitySection({ dict }: CommunitySectionProps) {
  return (
    <section id="community" className="relative section-pad">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-end gap-8 md:grid-cols-[auto_1fr] md:gap-16">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--wb-fg-faint)]">
              { dict.community.sectionLabel }
            </span>
            <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">09</span>
          </div>
          <h2 className="font-display-serif text-[clamp(2rem,4vw,3rem)] leading-[1.05] text-balance text-[var(--wb-fg)]">
            { dict.community.title }
          </h2>
        </div>

        <p className="mt-6 max-w-2xl text-pretty text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">
          { dict.community.subtitle }
        </p>

        <div className="mt-12 grid gap-px overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-border)] md:grid-cols-2 lg:grid-cols-3">
          { dict.community.channels.map((channel, idx) => {
            const Icon = ICON_MAP[channel.icon] ?? MessageCircle;
            const isExternal = channel.href.startsWith('http');
            return (
              <a
                key={ channel.name }
                href={ channel.href }
                target={ isExternal ? '_blank' : undefined }
                rel={ isExternal ? 'noreferrer' : undefined }
                className="group relative flex items-start gap-3 bg-[var(--wb-bg-pure)] p-5 transition-colors hover:bg-[var(--wb-bg-soft)]"
              >
                <span className="font-mono text-[10px] text-[var(--wb-fg-faint)]">
                  { String(idx + 1).padStart(2, '0') }
                </span>
                <Icon className="h-4 w-4 flex-shrink-0 text-[var(--wb-fg-faint)] transition-colors group-hover:text-[var(--wb-fg)]" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-display-serif text-[16px] leading-snug text-[var(--wb-fg)]">
                    { channel.name }
                  </h3>
                  <p className="mt-1 text-[12.5px] leading-snug text-[var(--wb-fg-muted)]">
                    { channel.description }
                  </p>
                </div>
                { isExternal ? (
                  <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--wb-fg-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                ) : null }
              </a>
            );
          }) }
        </div>
      </div>
    </section>
  );
}