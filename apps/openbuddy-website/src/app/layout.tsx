import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/ThemeProvider';
import CookieConsent from '@/components/CookieConsent';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import BackToTop from '@/components/BackToTop';
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
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://openbuddy.dev',
    title: 'OpenBuddy — The open desktop AI workspace',
    description: '100% MIT, auditable, forkable. Built on Electron + Pi with WorkBuddy-grade UI.',
    siteName: 'OpenBuddy',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'OpenBuddy — The open desktop AI workspace'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenBuddy — The open desktop AI workspace',
    description: '100% MIT, auditable, forkable. Built on Electron + Pi with WorkBuddy-grade UI.',
    images: ['/og.png']
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }]
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1
    }
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
                  offers: {
                    '@type': 'Offer',
                    price: '0',
                    priceCurrency: 'USD'
                  },
                  license: 'https://github.com/louloulin/OpenBuddy/blob/main/LICENSE',
                  url: 'https://openbuddy.dev',
                  downloadUrl: 'https://github.com/louloulin/OpenBuddy/releases'
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
                  inLanguage: ['en-US', 'zh-CN']
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
        </ThemeProvider>
      </body>
    </html>
  );
}