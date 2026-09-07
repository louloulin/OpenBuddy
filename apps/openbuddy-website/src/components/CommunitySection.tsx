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
import { SectionHeader } from './FeaturesSection';

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
 * CommunitySection —— 社区渠道网格
 *
 * 设计要点：
 * - 6 个卡片，每个代表一个社区渠道
 * - 卡片：icon + 名称 + 描述 + 右上角箭头
 * - hover 时卡片显示 brand 色光晕
 */
export default function CommunitySection({ dict }: CommunitySectionProps) {
  return (
    <section id="community" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          label={ dict.community.sectionLabel }
          title={ dict.community.title }
          subtitle={ dict.community.subtitle }
        />

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          { dict.community.channels.map((channel) => {
            const Icon = ICON_MAP[channel.icon] ?? MessageCircle;
            const isExternal = channel.href.startsWith('http');
            return (
              <a
                key={ channel.name }
                href={ channel.href }
                target={ isExternal ? '_blank' : undefined }
                rel={ isExternal ? 'noreferrer' : undefined }
                className="group relative flex items-start gap-4 overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-5 transition-all hover:-translate-y-0.5 hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-2 to-brand-4 text-brand-10 transition-transform group-hover:scale-110 dark:text-brand-8">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-[15px] font-semibold tracking-tight text-[var(--wb-fg)]">
                    { channel.name }
                  </h3>
                  <p className="mt-1 text-[13px] leading-snug text-[var(--wb-fg-muted)]">
                    { channel.description }
                  </p>
                </div>
                { isExternal ? (
                  <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-[var(--wb-fg-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
                ) : null }
                <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-gradient-to-br from-brand-3 to-brand-8 opacity-0 blur-2xl transition-opacity group-hover:opacity-40" />
              </a>
            );
          }) }
        </div>
      </div>
    </section>
  );
}