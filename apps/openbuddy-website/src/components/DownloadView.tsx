import { Monitor, Apple, Terminal, ArrowRight, Check, FileWarning } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import CopyButton from '@/components/CopyButton';
import Reveal from '@/components/motion/Reveal';
import { PageHeader, SectionHeader } from '@/components/PageHeader';
import { SITE_STATS } from '@/lib/constants';
import { getDictionary, type Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';
import { formatBytes, isTrustedDownloadUrl, type ReleaseAsset, type ReleaseInfo, type ReleasePlatform } from '@/lib/releases-server';
import Link from 'next/link';

const PLATFORM_ICON: Record<ReleasePlatform, typeof Monitor> = {
  mac: Apple,
  windows: Monitor,
  linux: Terminal
};

const PLATFORM_LABEL: Record<ReleasePlatform, { en: string; zh: string }> = {
  mac: { en: 'macOS', zh: 'macOS' },
  windows: { en: 'Windows', zh: 'Windows' },
  linux: { en: 'Linux', zh: 'Linux' }
};

const INSTALL_HINT: Record<ReleasePlatform, { en: string; zh: string }> = {
  mac: {
    en: 'Open the .dmg and drag OpenBuddy.app into /Applications. Unsigned builds are quarantined by Gatekeeper — see docs/RELEASING.md.',
    zh: '打开 .dmg,把 OpenBuddy.app 拖进 /Applications。未签名版本会被 Gatekeeper 隔离,处理方式见 docs/RELEASING.md。'
  },
  windows: {
    en: 'Run the installer. Unsigned builds trigger SmartScreen — click "More info" → "Run anyway".',
    zh: '运行安装器。未签名版本会触发 SmartScreen —— 点「更多信息」→「仍要运行」。'
  },
  linux: {
    en: 'chmod +x the AppImage and run it directly.',
    zh: 'chmod +x 之后直接运行 AppImage。'
  }
};

const COPY_EN = {
  title: 'Download OpenBuddy',
  subtitle: 'Every release is built by CI and shipped with a real SHA-256. Or build from source — the repo is the product.',
  sourceLabel: 'Build from source',
  sourceDesc: "If you want to read every line before you run it, that's our preferred way too.",
  sourceSteps: [
    '$ git clone --recurse-submodules https://github.com/louloulin/OpenBuddy.git',
    '$ cd OpenBuddy && pnpm install',
    '$ pnpm electron:dev          # local dev with HMR',
    '$ pnpm electron:build:mac    # or :win / :linux / :all'
  ],
  brewLabel: 'Homebrew (macOS)',
  brewFormula: 'brew install --cask openbuddy',
  verifications: 'Verifications',
  verificationsList: [
    `${SITE_STATS.testFiles} test files in the repo (run \`pnpm gate:test\`)`,
    'Closed-loop capability evals (`pnpm test:closed-loop`)',
    'Real-model Playwright UI tests (`pnpm test:electron:real-ui`)'
  ],
  checksumLabel: 'Checksums (SHA-256)',
  noReleaseTitle: 'No release published yet',
  noReleaseBody:
    'OpenBuddy has not published a release yet. Until it does, the only honest way to get the app is to build it from source — the repository is the product.',
  noReleaseBadge: 'No releases',
  latestLabel: 'Latest release',
  sha256Pending: 'SHA-256 published with the release',
  noChecksum: 'No checksum published',
  verifyLink: 'verify →'
};

const COPY_ZH = {
  title: '下载 OpenBuddy',
  subtitle: '每个版本都由 CI 构建,并附真实的 SHA-256 校验和。也可以从源码构建 —— 仓库即产品。',
  sourceLabel: '从源码构建',
  sourceDesc: '如果你想在运行前先读完每一行,这也是我们更推荐的方式。',
  sourceSteps: [
    '$ git clone --recurse-submodules https://github.com/louloulin/OpenBuddy.git',
    '$ cd OpenBuddy && pnpm install',
    '$ pnpm electron:dev          # 本地开发 + HMR',
    '$ pnpm electron:build:mac    # 或 :win / :linux / :all'
  ],
  brewLabel: 'Homebrew (macOS)',
  brewFormula: 'brew install --cask openbuddy',
  verifications: '验证',
  verificationsList: [
    `仓库内 ${SITE_STATS.testFiles} 个测试文件 (运行 \`pnpm gate:test\`)`,
    '闭环能力评估 (`pnpm test:closed-loop`)',
    '真实模型 Playwright UI 测试 (`pnpm test:electron:real-ui`)'
  ],
  checksumLabel: '校验和 (SHA-256)',
  noReleaseTitle: '尚未发布任何版本',
  noReleaseBody:
    'OpenBuddy 还没有发布过版本。在那之前,拿到这个应用的唯一诚实方式是**从源码构建** —— 仓库即产品。',
  noReleaseBadge: '暂无 Release',
  latestLabel: '最新版本',
  sha256Pending: 'SHA-256 随版本一并发布',
  noChecksum: '未发布校验和',
  verifyLink: '校验 →'
};

/** Title/subtitle for this page, shared with the route's generateMetadata. */
export const DOWNLOAD_COPY: Record<Locale, typeof COPY_EN> = {
  en: COPY_EN,
  'zh-CN': COPY_ZH
};

export function DownloadView({ locale, release }: { locale: Locale; release: ReleaseInfo }) {
  const dict = getDictionary(locale);
  const copy = locale === 'zh-CN' ? COPY_ZH : COPY_EN;
  const isZh = locale === 'zh-CN';

  const assets = release.assets.filter((a) => isTrustedDownloadUrl(a.downloadUrl));
  const byPlatform = new Map<ReleasePlatform, ReleaseAsset[]>();
  for (const asset of assets) {
    const list = byPlatform.get(asset.platform) ?? [];
    list.push(asset);
    byPlatform.set(asset.platform, list);
  }
  const platforms: ReleasePlatform[] = ['mac', 'windows', 'linux'];
  const hasRelease = assets.length > 0;

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <PageHeader
              eyebrow={ isZh ? '下载' : 'Download' }
              title={ copy.title }
              subtitle={ copy.subtitle }
              compact={ isZh }
            />

            { release.tag && (
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-muted)]">{ copy.latestLabel }</span>
                <a
                  href={ release.htmlUrl ?? 'https://github.com/louloulin/OpenBuddy/releases' }
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] px-3 py-1 font-mono text-[12px] font-semibold text-[var(--wb-fg)] hover:border-[var(--wb-border-strong)]"
                >
                  { release.tag }
                </a>
                { release.publishedAt && (
                  <span className="font-mono text-[11px] text-[var(--wb-fg-faint)]">{ release.publishedAt.slice(0, 10) }</span>
                )}
              </div>
            )}

            { !hasRelease && (
              <div className="mt-12 rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7 sm:p-8">
                <div className="flex items-start gap-3">
                  <FileWarning className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--wb-fg-muted)]" />
                  <div>
                    <h3 className="font-display-serif text-[24px] leading-tight tracking-[-0.02em] text-[var(--wb-fg)]">{ copy.noReleaseTitle }</h3>
                    <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--wb-fg-muted)]">{ copy.noReleaseBody }</p>
                    <span className="mt-4 inline-flex items-center rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--wb-fg-muted)]">
                      { copy.noReleaseBadge }
                    </span>
                  </div>
                </div>
              </div>
            )}

            { hasRelease && (
              <div className="mt-16 grid gap-5 md:grid-cols-3">
                { platforms.map((platform, platformIndex) => {
                  const list = byPlatform.get(platform) ?? [];
                  if (list.length === 0) return null;
                  const Icon = PLATFORM_ICON[platform];
                  return (
                    <div key={ platform } className="flex flex-col gap-4">
                      { list.map((asset, assetIndex) => (
                        <Reveal
                          key={ asset.name }
                          as="article"
                          delay={ (platformIndex * 2 + assetIndex) * 60 }
                          className="flex flex-col gap-4 rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-6 transition-all hover:border-[var(--wb-border-strong)]"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--wb-bg-soft)]">
                                <Icon className="h-4 w-4 text-[var(--wb-fg)]" />
                              </span>
                              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--wb-fg)]">
                                { PLATFORM_LABEL[platform][isZh ? 'zh' : 'en'] }{ asset.arch ? ` · ${asset.arch}` : '' }
                              </span>
                            </div>
                            <span className="font-mono text-[10.5px] text-[var(--wb-fg-faint)]">{ formatBytes(asset.sizeBytes) }</span>
                          </div>
                          <code className="rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--wb-fg)] break-all">{ asset.name }</code>
                          <p className="text-[13px] leading-snug text-[var(--wb-fg-muted)]">{ INSTALL_HINT[platform][isZh ? 'zh' : 'en'] }</p>
                          { asset.sha256 && (
                            <p className="font-mono text-[10.5px] leading-relaxed text-[var(--wb-fg-faint)] break-all">
                              SHA-256 { asset.sha256 }
                            </p>
                          ) }
                          <a href={ asset.downloadUrl } target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-full bg-[var(--wb-fg)] px-4 py-2.5 text-[13px] font-semibold text-[var(--wb-bg)] transition-opacity hover:opacity-90">
                            <span>Download</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </a>
                        </Reveal>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-8 flex items-center justify-center gap-2 rounded-full border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-4 py-3">
              <Terminal className="h-4 w-4 text-[var(--wb-fg-muted)]" />
              <code className="font-mono text-[13px] text-[var(--wb-fg)]">{ copy.brewFormula }</code>
              <CopyButton text={ copy.brewFormula } className="ml-auto" />
            </div>

            <div className="mt-16 rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7 sm:p-8">
              <SectionHeader eyebrow={ copy.sourceLabel } title={ isZh ? '从源码构建' : 'Read every line, then run it.' } subtitle={ copy.sourceDesc } />
              <div className="mt-6 overflow-hidden rounded-xl border border-[var(--wb-border)] bg-[#0A0F1E]">
                <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#111827] px-4 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                  <span className="ml-3 font-mono text-[11px] text-white/40">~/openbuddy</span>
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-white">
                  { copy.sourceSteps.map((step, idx) => (
                    <div key={ idx } className={ idx > 0 ? 'mt-1' : '' }>
                      <span className="select-none text-[#22C55E] mr-2">❯</span>
                      { step }
                    </div>
                  ))}
                </pre>
              </div>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7">
                <SectionHeader eyebrow={ copy.verifications } title="" />
                <ul className="space-y-3">
                  { copy.verificationsList.map((v) => (
                    <li key={ v } className="flex items-start gap-3 text-[13.5px] leading-snug text-[var(--wb-fg)]">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--wb-working)]" />
                      <span>{ v }</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg-pure)] p-7">
                <SectionHeader eyebrow={ copy.checksumLabel } title="" />
                { hasRelease && release.hasChecksums ? (
                  <table className="w-full text-[13px]">
                    <tbody>
                      { assets.map((asset) => (
                        <tr key={ asset.name } className="border-t border-[var(--wb-border)] first:border-t-0">
                          <td className="py-2 font-medium text-[var(--wb-fg)]">{ PLATFORM_LABEL[asset.platform][isZh ? 'zh' : 'en'] }{ asset.arch ? ` · ${asset.arch}` : '' }</td>
                          <td className="py-2"><code className="font-mono text-[11px] text-[var(--wb-fg-muted)] break-all">{ asset.sha256 ?? copy.noChecksum }</code></td>
                          <td className="py-2 text-right whitespace-nowrap">
                            <a href={ asset.downloadUrl } target="_blank" rel="noreferrer" className="font-mono text-[11px] text-[var(--wb-brand)] hover:underline">{ copy.verifyLink }</a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[13.5px] leading-snug text-[var(--wb-fg-muted)]">
                    { hasRelease ? copy.sha256Pending : copy.noReleaseBody }
                  </p>
                )}
              </div>
            </div>

            <div className="mt-16">
              <Link href={ localizedPath('/', locale) } className="cta-link text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)] text-[14px]">
                <span>← { isZh ? '返回首页' : 'Back to home' }</span>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } locale={ locale } />
    </>
  );
}
