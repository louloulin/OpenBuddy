import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
import '../styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains'
});

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
    <html lang="en" className={ `${inter.variable} ${jetbrains.variable}` } suppressHydrationWarning>
      <head>
        {/* 字体预加载 + JSON-LD 结构化数据 */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={ {
            __html: JSON.stringify({
              '@context': 'https://schema.org',
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
              downloadUrl: 'https://github.com/lougoulin/OpenBuddy/releases'
            })
          } }
        />
      </head>
      <body className="font-sans antialiased">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider>{ children }</ThemeProvider>
      </body>
    </html>
  );
}