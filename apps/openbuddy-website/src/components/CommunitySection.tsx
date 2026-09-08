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
import { SharedHeader } from './SharedHeader';

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
 * CommunitySection —— 6 渠道列表 (cream 背景)
 */
export default function CommunitySection({ dict }: CommunitySectionProps) {
  return (
    <section
      id="community"
      data-section-theme="cream"
      className="relative section-pad bg-[var(--wb-bg)]"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SharedHeader
          number="11"
          label={ dict.community.sectionLabel }
          title={ dict.community.title }
          subtitle={ dict.community.subtitle }
        />

        <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          { dict.community.channels.map((channel, idx) => {
            const Icon = ICON_MAP[channel.icon] ?? MessageCircle;
            const isExternal = channel.href.startsWith('http');
            return (
              <a
                key={ channel.name }
                href={ channel.href }
                target={ isExternal ? '_blank' : undefined }
                rel={ isExternal ? 'noreferrer' : undefined }
                className="group flex items-start gap-4 rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-6 transition-all hover:border-[var(--wb-border-strong)] hover:-translate-y-0.5"
              >
                <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">
                  { String(idx + 1).padStart(2, '0') }
                </span>
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-[var(--wb-bg-soft)]">
                  <Icon className="h-4 w-4 text-[var(--wb-fg)] transition-colors" />
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display-serif text-[18px] leading-snug text-[var(--wb-fg)]">
                    { channel.name }
                  </h3>
                  <p className="mt-1 text-[13.5px] leading-snug text-[var(--wb-fg-muted)]">
                    { channel.description }
                  </p>
                </div>
                { isExternal ? (
                  <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-[var(--wb-fg-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                ) : null }
              </a>
            );
          }) }
        </div>
      </div>
    </section>
  );
}
