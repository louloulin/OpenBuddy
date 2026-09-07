# OpenBuddy Website

The official marketing website for **OpenBuddy** — built with **Next.js 14 App Router**, **Tailwind**, and the OpenBuddy `--wb-*` design tokens.

> **Live:** [openbuddy.dev](https://openbuddy.dev) (Vercel)
> **Repo root:** [/Users/louloulin/appx/OpenBuddy](../../)

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 14.2 (App Router, Server Components, Turbopack) |
| Language | TypeScript 5.6 |
| Styling | Tailwind CSS 3.4 + custom CSS variables (`--wb-*`) |
| Font | Inter (UI), JetBrains Mono (code) via `next/font/google` |
| Icons | lucide-react |
| Deployment | Vercel (auto-detected via `vercel.json`) |

## Routes

| Path | Purpose | i18n |
| --- | --- | --- |
| `/` | Home — Hero, Showcase, Features, Architecture, Comparison, Capabilities, CLI, Community, CTA | en (default) |
| `/zh-CN` | Same as `/` but in 简体中文 | zh-CN |
| `/download` | Download installers for Win / macOS / Linux | en |
| `/zh-CN/download` | Chinese download page | zh-CN |
| `/docs` | Documentation entry — links to GitHub Markdown docs + code example | en |
| `/zh-CN/docs` | Same in Chinese | zh-CN |
| `/sponsors` | Sponsor tiers & transparency log | en |
| `/zh-CN/sponsors` | Same in Chinese | zh-CN |
| `/sitemap.xml` | Generated from `src/app/sitemap.ts` | – |
| `/robots.txt` | Generated from `src/app/robots.ts` | – |

## File layout

```
apps/openbuddy-website/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout: fonts, theme, JSON-LD
│   │   ├── page.tsx            # / (English)
│   │   ├── sitemap.ts          # sitemap.xml generator
│   │   ├── robots.ts           # robots.txt generator
│   │   ├── not-found.tsx       # 404
│   │   ├── download/page.tsx   # /download (English)
│   │   ├── docs/page.tsx       # /docs (English)
│   │   ├── sponsors/page.tsx   # /sponsors (English)
│   │   └── [locale]/           # /zh-CN/* mirrors English routes
│   │       ├── page.tsx
│   │       ├── download/page.tsx
│   │       ├── docs/page.tsx
│   │       └── sponsors/page.tsx
│   ├── components/             # Reusable React components
│   │   ├── SiteHeader.tsx      # Sticky header w/ backdrop blur
│   │   ├── SiteFooter.tsx
│   │   ├── Hero.tsx            # Editor-style hero + animated terminal
│   │   ├── ShowcaseSection.tsx # Tabbed screenshot viewer (mock + real)
│   │   ├── FeaturesSection.tsx # 6 feature cards
│   │   ├── ArchitectureSection.tsx
│   │   ├── ComparisonSection.tsx
│   │   ├── CapabilitiesSection.tsx
│   │   ├── CLISection.tsx      # Dark terminal demo
│   │   ├── CommunitySection.tsx
│   │   ├── CTASection.tsx
│   │   ├── DownloadView.tsx    # Shared download view (en/zh)
│   │   ├── DocsView.tsx        # Shared docs view
│   │   ├── SponsorsView.tsx    # Shared sponsors view
│   │   └── ThemeProvider.tsx   # next-themes wrapper
│   ├── lib/i18n.ts             # EN / zh-CN dictionaries + helpers
│   └── styles/globals.css      # Tailwind base + --wb-* tokens
├── public/favicon.svg          # Shiba mascot mark
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── moon.yml                    # `openbuddy-website:*` tasks
├── tsconfig.json
├── package.json
└── vercel.json                 # Deployment config
```

## Design system

We reuse the **OpenBuddy `--wb-*` design tokens** from the main repo's
`src/styles/tokens.css` (so the website and the desktop app stay visually
consistent). On top of that, Tailwind provides:

- **Brand palette** mapped from `--wb-palette-brand-*` to `tailwind.colors.brand`
- **Surface tokens** mapped to `tailwind.colors.surface`
- **Custom keyframes**: `fade-up`, `cursor-blink`, `shimmer`, `gradient-pan`
- **Custom utilities**: `bg-editor-grid`, `bg-radial-glow`, `wb-window`, `wb-card`, `wb-chip`, `btn-primary`, `btn-secondary`

## Develop

```bash
# From repo root
pnpm website:dev              # http://localhost:3001 (Turbopack)

# Or directly inside this package
cd apps/openbuddy-website
pnpm dev
```

## Build & preview

```bash
pnpm website:build
pnpm website:start            # http://localhost:3001
```

## Type-check & lint

```bash
pnpm website:typecheck
pnpm website:lint
```

## Deployment (Vercel)

The `vercel.json` in this directory configures Vercel to:

- Build via `next build`
- Install only this subpackage via `pnpm install --filter @openbuddy/website...`
- Deploy to multi-region: `iad1, sin1, fra1, hnd1`
- Set security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Cache static assets for 1 year

**First-time setup:**

1. Connect this repo to Vercel.
2. Set **Root Directory** to `apps/openbuddy-website`.
3. Vercel auto-detects `next build` from `vercel.json` / package.json.
4. Add custom domain `openbuddy.dev` in the Vercel Domains tab.

**Preview deployments:** Every PR gets a unique URL.

## License

MIT — same as the parent project. Logo and Shiba mascot are not part of the MIT grant (see `/BRAND.md` for trademark policy).