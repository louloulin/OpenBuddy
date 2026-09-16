import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/ThemeProvider';
import CookieConsent from '@/components/CookieConsent';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import SearchDialog from '@/components/search/SearchDialog';
import BackToTop from '@/components/BackToTop';
import { getSearchIndex } from '@/lib/docs-search';
import { SITE_STATS } from '@/lib/constants';
import '../styles/globals.css';

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1117' }
  ],
  width: 'device-width',
  initialScale: 1
};

/**
 * 默认 metadata —— Next.js 会基于每个页面的 metadata 覆盖。
 * 详见 src/app/[lang]/page.tsx 等具体页面的 generateMetadata。
 */
export const metadata: Metadata = {
  metadataBase: new URL('https://openbuddy.dev'),
  title: {
    default: 'OpenBuddy — The open desktop AI workspace',
    template: '%s · OpenBuddy'
  },
  description:
    'OpenBuddy is a 100% open source (MIT) desktop AI workspace rebuilt on Electron + Pi. WorkBuddy-grade UI, BYOK providers, plan mode, skills, MCP — auditable, forkable, yours.',
  keywords: ['OpenBuddy', 'WorkBuddy', 'open source', 'desktop AI', 'Electron', 'Pi agent'],
  authors: [{ name: 'OpenBuddy contributors' }],
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico' }
    ],
    apple: [{ url: '/app-icon.png', sizes: '1024x1024' }]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const searchIndex = getSearchIndex();
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        {/* JSON-LD: SoftwareApplication (基础) + Organization (用于 SEO 知识面板) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={ {
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'SoftwareApplication',
                  name: 'OpenBuddy',
                  applicationCategory: 'DeveloperApplication',
                  operatingSystem: 'Windows, macOS, Linux',
                  description:
                    'OpenBuddy is a 100% open source (MIT) desktop AI workspace rebuilt on Electron + Pi.',
                  softwareVersion: '0.15.0',
                  datePublished: '2026-08-01',
                  offers: {
                    '@type': 'Offer',
                    price: '0',
                    priceCurrency: 'USD'
                  },
                  license: 'https://github.com/louloulin/OpenBuddy/blob/main/LICENSE',
                  url: 'https://openbuddy.dev',
                  downloadUrl: 'https://github.com/louloulin/OpenBuddy/releases',
                  author: { '@type': 'Organization', name: 'OpenBuddy contributors', url: 'https://github.com/louloulin/OpenBuddy' },
                  featureList: [
                    'Multi-provider LLM support (Anthropic, OpenAI, NewAPI, Ollama)',
                    'Local-first SQLite workspace',
                    'BYOK (Bring Your Own Key) mode',
                    'Plan mode · Rewind · Fork',
                    'MCP (Model Context Protocol) connectors',
                    'Casdoor OIDC / SAML / SCIM',
                    `${SITE_STATS.packages} capability packages`,
                    `${SITE_STATS.testFiles} progressive test files`
                  ]
                },
                {
                  '@type': 'Organization',
                  name: 'OpenBuddy',
                  url: 'https://openbuddy.dev',
                  logo: 'https://openbuddy.dev/favicon.svg',
                  sameAs: [
                    'https://github.com/louloulin/OpenBuddy',
                    'https://github.com/louloulin/OpenBuddy/discussions',
                    'https://discord.gg/openbuddy',
                    'https://youtube.com/@openbuddy'
                  ]
                },
                {
                  '@type': 'WebSite',
                  name: 'OpenBuddy',
                  url: 'https://openbuddy.dev',
                  inLanguage: ['en-US', 'zh-CN'],
                  potentialAction: {
                    '@type': 'SearchAction',
                    target: {
                      '@type': 'EntryPoint',
                      urlTemplate: 'https://openbuddy.dev/en/docs?q={search_term_string}'
                    },
                    'query-input': 'required name=search_term_string'
                  }
                },
                {
                  '@type': 'FAQPage',
                  mainEntity: [
                    {
                      '@type': 'Question',
                      name: 'Is OpenBuddy really free and open source?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Yes. OpenBuddy is MIT-licensed, with no premium tier, no telemetry, and no phone-home. The full source code is auditable on GitHub and every release is PGP-signed.'
                      }
                    },
                    {
                      '@type': 'Question',
                      name: 'How does OpenBuddy compare to WorkBuddy?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'OpenBuddy is a pixel-close, 100% open source rewrite of WorkBuddy on Electron + Pi. Same design tokens, same UI; the difference is the open core, the BYOK model, and the data path. See the full comparison at /docs/comparison.'
                      }
                    },
                    {
                      '@type': 'Question',
                      name: 'Which LLM providers does OpenBuddy support?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Anthropic, OpenAI, Google, Bedrock, OpenRouter, Ollama, NewAPI, and any OpenAI-compatible endpoint. Bring your own key or use a service token against a Casdoor / NewAPI gateway.'
                      }
                    },
                    {
                      '@type': 'Question',
                      name: 'Where does my data live?',
                      acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'All conversations, prompts, skills, and the audit ledger live on your machine in ~/.openbuddy/. No telemetry by default; opt-in spans only.'
                      }
                    }
                  ]
                }
              ]
            })
          } }
        />
        <script
          // 注入初始 theme，避免 FOUC
          dangerouslySetInnerHTML={ {
            __html: `(function(){try{var t=localStorage.getItem('openbuddy-theme');var d=t==='light'||t==='dark'?t:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',d);}catch(e){}})();`
          } }
        />
        <script
          // 根 layout 读不到路由参数,lang 只能先写死 'en'。同步改回来,避免首帧
          // 到 hydration 之间中文页被当成英文读;客户端切换语言由 HtmlLang 兜底。
          dangerouslySetInnerHTML={ {
            __html: `(function(){try{var p=location.pathname.split('/').filter(Boolean)[0];if(p==='en'||p==='zh-CN'){document.documentElement.lang=p;}}catch(e){}})();`
          } }
        />
      </head>
      <body className="font-sans antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider>
          { children }
          <BackToTop />
          <CookieConsent />
          <KeyboardShortcuts />
          <SearchDialog index={ searchIndex } />
        </ThemeProvider>
      </body>
    </html>
  );
}