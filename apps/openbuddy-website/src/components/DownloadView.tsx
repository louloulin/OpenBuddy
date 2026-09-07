import type { Metadata } from 'next';
import { Monitor, Apple, Terminal, Github, ArrowRight, Check } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import CopyButton from '@/components/CopyButton';
import { defaultLocale, getDictionary, type Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/i18n';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Download OpenBuddy',
  description:
    'Download OpenBuddy for Windows, macOS, and Linux. 100% MIT, free forever. Or build from source via pnpm.'
};

interface DownloadPlatform {
  icon: typeof Monitor;
  name: string;
  file: string;
  size: string;
  arch: string;
  installHint: string;
  downloadUrl: string;
}

const PLATFORMS_EN: DownloadPlatform[] = [
  {
    icon: Apple,
    name: 'macOS',
    file: 'OpenBuddy-0.14.0-macOS.dmg',
    size: '124 MB',
    arch: 'Apple Silicon & Intel',
    installHint: 'Open the .dmg and drag OpenBuddy.app to /Applications',
    downloadUrl: 'https://github.com/louloulin/OpenBuddy/releases/latest'
  },
  {
    icon: Monitor,
    name: 'Windows',
    file: 'OpenBuddy-0.14.0-win-x64.exe',
    size: '108 MB',
    arch: 'x64 · NSIS installer',
    installHint: 'Run the installer. SmartScreen warning? Click "More info" → "Run anyway".',
    downloadUrl: 'https://github.com/louloulin/OpenBuddy/releases/latest'
  },
  {
    icon: Terminal,
    name: 'Linux',
    file: 'openbuddy_0.14.0_amd64.deb',
    size: '102 MB',
    arch: 'x86_64 · AppImage + .deb',
    installHint: 'sudo dpkg -i openbuddy_0.14.0_amd64.deb  ·  or run the AppImage directly',
    downloadUrl: 'https://github.com/louloulin/OpenBuddy/releases/latest'
  }
];

const PLATFORMS_ZH: DownloadPlatform[] = [
  {
    icon: Apple,
    name: 'macOS',
    file: 'OpenBuddy-0.14.0-macOS.dmg',
    size: '124 MB',
    arch: 'Apple Silicon & Intel',
    installHint: '打开 .dmg,将 OpenBuddy.app 拖入 /Applications',
    downloadUrl: 'https://github.com/louloulin/OpenBuddy/releases/latest'
  },
  {
    icon: Monitor,
    name: 'Windows',
    file: 'OpenBuddy-0.14.0-win-x64.exe',
    size: '108 MB',
    arch: 'x64 · NSIS 安装器',
    installHint: '运行安装器。SmartScreen 警告?点击"更多信息" → "仍要运行"。',
    downloadUrl: 'https://github.com/lougoulin/OpenBuddy/releases/latest'
  },
  {
    icon: Terminal,
    name: 'Linux',
    file: 'openbuddy_0.14.0_amd64.deb',
    size: '102 MB',
    arch: 'x86_64 · AppImage + .deb',
    installHint: 'sudo dpkg -i openbuddy_0.14.0_amd64.deb · 或直接运行 AppImage',
    downloadUrl: 'https://github.com/lougoulin/OpenBuddy/releases/latest'
  }
];

const COPY_EN = {
  title: 'Download OpenBuddy',
  subtitle:
    'Three installers, one MIT license, zero telemetry. Or build from source — the repo is the product.',
  sourceLabel: 'Build from source',
  sourceDesc:
    'If you want to read every line before you run it, that\'s our preferred way too.',
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
    '455 test files in the repo (run `pnpm workspace:test`)',
    'Closed-loop capability evals (`pnpm test:closed-loop`)',
    'Real-model Playwright UI tests (`pnpm test:electron:real-ui`)'
  ],
  checksumLabel: 'Checksums (SHA-256)',
  checksums: [
    { platform: 'macOS', hash: '7e3b…c4d2' },
    { platform: 'Windows', hash: 'a8f1…b9e5' },
    { platform: 'Linux', hash: '2c6d…7a4f' }
  ]
};

const COPY_ZH = {
  title: '下载 OpenBuddy',
  subtitle: '三个安装器,一个 MIT 协议,零遥测。或从源码构建 —— 仓库即产品。',
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
    '仓库内 455 个测试文件 (运行 `pnpm workspace:test`)',
    '闭环能力评估 (`pnpm test:closed-loop`)',
    '真实模型 Playwright UI 测试 (`pnpm test:electron:real-ui`)'
  ],
  checksumLabel: '校验和 (SHA-256)',
  checksums: [
    { platform: 'macOS', hash: '7e3b…c4d2' },
    { platform: 'Windows', hash: 'a8f1…b9e5' },
    { platform: 'Linux', hash: '2c6d…7a4f' }
  ]
};

export function DownloadView({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const platforms = locale === 'zh-CN' ? PLATFORMS_ZH : PLATFORMS_EN;
  const copy = locale === 'zh-CN' ? COPY_ZH : COPY_EN;

  return (
    <>
      <SiteHeader dict={ dict } locale={ locale } />
      <main id="main-content" className="pt-12">
        <section className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-radial-glow opacity-50" />
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 justify-center text-[var(--wb-fg-muted)]">
                <span className="h-px w-6 bg-[var(--wb-fg-muted)]" />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em]">
                  { copy.title }
                </span>
                <span className="h-px w-6 bg-[var(--wb-fg-muted)]" />
              </div>
              <h1 className="mt-4 font-display text-display-lg text-balance text-[var(--wb-fg)]">
                { copy.title }
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-[16px] leading-relaxed text-[var(--wb-fg-muted)]">
                { copy.subtitle }
              </p>
            </div>

            {/* Platform cards */}
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              { platforms.map((p) => {
                const Icon = p.icon;
                return (
                  <article
                    key={ p.name }
                    className="group flex flex-col rounded-xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 transition-all hover:-translate-y-1 hover:border-[var(--wb-fg-muted)] hover:shadow-wb-card-hover"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-brand-2 to-brand-4 text-brand-10 transition-transform group-hover:scale-110 dark:text-brand-8">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="font-mono text-[10px] text-[var(--wb-fg-muted)]">{ p.size }</span>
                    </div>
                    <h3 className="mt-5 font-display text-[22px] font-semibold tracking-tight text-[var(--wb-fg)]">
                      { p.name }
                    </h3>
                    <p className="mt-1 text-[12px] text-[var(--wb-fg-muted)]">{ p.arch }</p>
                    <code className="mt-3 rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-2 py-1.5 font-mono text-[11px] text-[var(--wb-fg)]">
                      { p.file }
                    </code>
                    <p className="mt-4 text-[13px] leading-snug text-[var(--wb-fg-muted)]">
                      { p.installHint }
                    </p>
                    <a
                      href={ p.downloadUrl }
                      target="_blank"
                      rel="noreferrer"
                      className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--wb-fg)] px-3 py-2 text-[13px] font-medium text-[var(--wb-bg)] transition-colors hover:opacity-90"
                    >
                      <span>Download</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  </article>
                );
              }) }
            </div>

            {/* Brew badge */}
            <div className="mx-auto mt-10 flex max-w-2xl items-center justify-center gap-2 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg-soft)] px-4 py-3">
              <Terminal className="h-4 w-4 text-[var(--wb-fg-muted)]" />
              <code className="font-mono text-[13px] text-[var(--wb-fg)]">{ copy.brewFormula }</code>
              <CopyButton text={ copy.brewFormula } className="ml-auto" />
            </div>

            {/* Source build */}
            <div className="mx-auto mt-16 max-w-3xl rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 sm:p-8">
              <div className="flex items-center gap-2 text-[var(--wb-fg-muted)]">
                <Github className="h-4 w-4" />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{ copy.sourceLabel }</span>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--wb-fg-muted)]">{ copy.sourceDesc }</p>

              <div className="mt-5 overflow-hidden rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg-dark)]">
                <div className="flex items-center gap-1.5 border-b border-white/10 bg-[#161B22] px-4 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                  <span className="ml-3 font-mono text-[11px] text-[#8B949E]">~/openbuddy</span>
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-white">
                  { copy.sourceSteps.map((step, idx) => (
                    <div key={ idx } className={ idx > 0 ? 'mt-1' : '' }>
                      <span className="select-none text-brand-8 mr-2">❯</span>
                      { step }
                    </div>
                  )) }
                </pre>
              </div>
            </div>

            {/* Verifications */}
            <div className="mx-auto mt-16 max-w-3xl rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 sm:p-8">
              <h2 className="font-display text-[18px] font-semibold tracking-tight text-[var(--wb-fg)]">
                { copy.verifications }
              </h2>
              <ul className="mt-4 space-y-2">
                { copy.verificationsList.map((v) => (
                  <li key={ v } className="flex items-start gap-2 text-[14px] text-[var(--wb-fg-muted)]">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-8" />
                    <span>{ v }</span>
                  </li>
                )) }
              </ul>
            </div>

            {/* Checksums */}
            <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-[var(--wb-border)] bg-[var(--wb-bg)] p-6 sm:p-8">
              <h2 className="font-display text-[18px] font-semibold tracking-tight text-[var(--wb-fg)]">
                { copy.checksumLabel }
              </h2>
              <table className="mt-4 w-full text-[13px]">
                <tbody>
                  { copy.checksums.map((c) => (
                    <tr key={ c.platform } className="border-t border-[var(--wb-border)]">
                      <td className="py-2 font-medium text-[var(--wb-fg)]">{ c.platform }</td>
                      <td className="py-2">
                        <code className="font-mono text-[12px] text-[var(--wb-fg-muted)]">{ c.hash }</code>
                      </td>
                      <td className="py-2 text-right">
                        <a
                          href="https://github.com/louloulin/OpenBuddy/releases/latest"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12px] text-brand-9 hover:underline"
                        >
                          Verify →
                        </a>
                      </td>
                    </tr>
                  )) }
                </tbody>
              </table>
            </div>

            {/* Back link */}
            <div className="mt-12 text-center">
              <Link
                href={ localizedPath('/', locale) }
                className="inline-flex items-center gap-2 text-[13px] text-[var(--wb-fg-muted)] hover:text-[var(--wb-fg)]"
              >
                ← { locale === 'zh-CN' ? '返回首页' : 'Back to home' }
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter dict={ dict } />
    </>
  );
}