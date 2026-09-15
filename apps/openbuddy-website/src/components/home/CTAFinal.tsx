import Link from 'next/link';
import { GithubIcon } from '@/components/icons/BrandIcons';
import { localizedPath, type Locale } from '@/lib/i18n';

interface CTAFinalProps {
  locale: Locale;
}

export default function CTAFinal({ locale }: CTAFinalProps) {
  const isZh = locale === 'zh-CN';

  return (
    <section className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-8 py-16 md:px-16 md:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--wb-brand-soft)] blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-[var(--wb-brand-soft)] blur-3xl"
          />

          <div className="relative">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-faint)]">
              { isZh ? '下一步' : 'Get started' }
            </p>
            <h2 className="mt-4 max-w-3xl font-display-serif text-[clamp(36px,5.5vw,72px)] font-normal leading-[1.02] tracking-[-0.03em] text-[var(--wb-fg)]">
              { isZh
                ? '读源码。跑起来。改成你想要的。'
                : 'Read the code. Run it. Make it yours.' }
            </h2>
            <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
              { isZh
                ? 'MIT 协议。64 个包。1,886 个测试。Star 我们、Clone 我们、改完提 PR。'
                : 'MIT licensed. 64 packages. 1,886 tests. Star us, clone us, send a PR.' }
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href={ localizedPath('/download', locale) }
                className="cta-link cta-link-primary bg-[var(--wb-fg)] px-5 py-3 text-[var(--wb-bg)]"
              >
                <span>{ isZh ? '下载桌面版' : 'Download for desktop' }</span>
                <span className="cta-link-arrow">→</span>
              </Link>
              <a
                href="https://github.com/louloulin/OpenBuddy"
                target="_blank"
                rel="noreferrer"
                className="cta-link border border-[var(--wb-border-strong)] px-5 py-3 text-[var(--wb-fg)]"
              >
                <GithubIcon size={ 14 } />
                <span>{ isZh ? '在 GitHub 查看' : 'View on GitHub' }</span>
              </a>
              <Link
                href={ localizedPath('/docs', locale) }
                className="cta-link px-2 py-3 text-[var(--wb-fg-muted)]"
              >
                <span>{ isZh ? '阅读文档' : 'Read the docs' }</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}