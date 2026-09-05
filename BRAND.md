# Brand Guidelines

**English** · [简体中文](BRAND.zh-CN.md)

### Logo

The OpenBuddy logo is the Shiba mascot: a ginger dog face with a cream muzzle and brow spots, on a deep-teal squircle. Flat geometry, three colors — ginger coat `#FCA23F`, cream `#FFF6E8`, ink `#2B1A11` — so it stays legible from 16 px to 1024 px.

| Asset | File | Format | Recommended size |
|---|---|---|---|
| Vector master | `src/assets/logo-mark.svg` | SVG | any |
| Vector logo | `openbuddy-logo.svg` | SVG | any |
| App icon (raster master) | `app-icon.png` | PNG | 1024×1024 |
| Monochrome | `openbuddy-logo-mono.svg` | SVG | ≥ 48 px |
| Wordmark | `openbuddy-wordmark.svg` | SVG | width ≥ 240 px |
| Favicon | `public/favicon.ico` | ICO | 16 / 32 / 48 |
| macOS app | `build/icon.icns` | ICNS | generated |
| Windows app | `build/icon.ico` | ICO | generated |
| Linux app | `build/icon.png` | PNG | generated |

`src/assets/logo-mark.svg` is the single source of truth. Everything raster is
derived from it — never hand-edit a PNG/ICO/ICNS:

```bash
pnpm brand:icons
```

`build/` is gitignored, so run this before packaging on a fresh clone.
Requires `librsvg` and `imagemagick` (`brew install librsvg imagemagick`).

### Logo usage

#### ✅ Do

- Maintain **clear space** equal to the height of one "B" around the logo on all sides.
- Use the **vector** version whenever possible.
- Use the **app icon** for favicons, dock icons, and tile displays.
- Use the **wordmark** when the monogram alone isn't recognizable.

#### ❌ Don't

- Don't change the colors.
- Don't skew, rotate, or distort.
- Don't add drop shadows, glows, or other effects.
- Don't place on busy backgrounds without a solid-color panel underneath.
- Don't use the logo to represent an unrelated product.
- Don't modify the monogram to spell other words.

### Clear space

```
┌───────────────────────────┐
│                           │
│   ┌─────────────┐         │
│   │             │         │
│   │   LOGO      │         │   ← clear space = 1× height of "B"
│   │             │         │
│   └─────────────┘         │
│                           │
└───────────────────────────┘
```

### Minimum sizes

| Asset | Min size | Why |
|---|---|---|
| App icon | 32×32 px | macOS / Windows / Linux dock |
| Monogram | 24×24 px | small UI elements |
| Wordmark | 120 px wide | legibility |

### Color palette

OpenBuddy uses a **two-color** system: accent + neutral.

#### Accent

| Name | Hex | RGB | Use |
|---|---|---|---|
| `--wb-accent` | `#5B6CFF` | `91, 108, 255` | Primary accent, CTAs, links |
| `--wb-accent-hover` | `#4858E0` | `72, 88, 224` | Hover state |
| `--wb-accent-active` | `#3547C2` | `53, 71, 194` | Active / pressed |

#### Neutral

| Name | Hex | RGB | Use |
|---|---|---|---|
| `--wb-bg` | `#FFFFFF` | `255, 255, 255` | Light theme background |
| `--wb-bg-dark` | `#0E1117` | `14, 17, 23` | Dark theme background |
| `--wb-fg` | `#1F2328` | `31, 35, 40` | Primary text |
| `--wb-fg-muted` | `#656D76` | `101, 109, 118` | Secondary text |
| `--wb-border` | `#D0D7DE` | `208, 215, 222` | Borders (light) |
| `--wb-border-dark` | `#30363D` | `48, 54, 61` | Borders (dark) |

#### Status

| Name | Hex | Use |
|---|---|---|
| `--wb-success` | `#1F883D` | Success, online, enabled |
| `--wb-warning` | `#9A6700` | Warning, deprecated |
| `--wb-error` | `#CF222E` | Error, destructive |

### Typography

#### Display

For headings, slide titles, and the wordmark:

- **Inter** (preferred) — `font-family: 'Inter', system-ui, sans-serif`
- **SF Pro Display** (macOS) — fallback
- **Segoe UI** (Windows) — fallback

#### Body

For paragraphs and UI text, use the system font stack:

- macOS: `SF Pro Text`
- Windows: `Segoe UI`
- Linux: `Ubuntu`, `Cantarell`, `DejaVu Sans`

#### Monospace

For code, paths, and identifiers:

- **JetBrains Mono** (preferred)
- **SF Mono** (macOS)
- **Cascadia Code** (Windows)

### Tone of voice

OpenBuddy communicates in three modes. Pick the right one for your context.

| Mode | When | Example |
|---|---|---|
| **Marketing** | Website, blog, talks | "The open desktop AI workspace that you can actually read, fork, and own." |
| **Technical** | Docs, code, issues | "Renderer ↔ IPC surface is allowlisted in `electron/preload/index.ts`." |
| **Supportive** | Community, errors | "Sorry about that! Can you share the output of `pnpm workspace:test`?" |

#### Voice principles

- **Friendly but technical.** Assume the reader knows what an API key is.
- **Open by default.** Don't claim features you can't substantiate in the repo.
- **Plain English.** Avoid marketing jargon ("synergize", "revolutionize").
- **Inclusive.** Use "you" not "the user". Use "they" or "the contributor" for third-person.

### Naming

#### The product

- ✅ **"OpenBuddy"** — one word, capitalized "O" + "B".
- ✅ **"OpenBuddy Pi"** — full product name (with the agent runtime attribution).
- ❌ "openbuddy" (all lowercase, except at the start of a sentence).
- ❌ "OpenBuddy™" (no trademark symbol; we're MIT-licensed).
- ❌ "OB" (unless space-constrained).

#### Code identifiers

- ✅ `@openbuddy/*` — npm scope.
- ✅ `openbuddy:*` — IPC channel prefix.
- ✅ `openbuddy.capability.*` — Cordis plugin ID.
- ❌ `OB-*` (don't use the monogram as code prefix).

### Tagline options

Pick the right one for your context.

| Audience | Tagline |
|---|---|
| General | "The open desktop AI workspace." |
| WorkBuddy users | "WorkBuddy, but open source." |
| Developers | "100% open. 100% auditable. 100% yours." |
| Enterprise | "Enterprise AI workspace, open at the core." |
| Chinese | "基于 Pi 的开源桌面 AI 工作台" |
| Japanese (planned) | "オープンソースのデスクトップ AI ワークスペース" |

### Social media

- **Mastodon / X**: `@openbuddy` (post links to GitHub Discussions, releases)
- **GitHub**: <https://github.com/louloulin/OpenBuddy>
- **YouTube**: <https://youtube.com/@openbuddy> (Office Hours, talks)
- **Discord**: <https://discord.gg/openbuddy>
- **LinkedIn**: <https://linkedin.com/company/openbuddy> (planned)

### Press kit

For media inquiries, see the [press kit](https://openbuddy.dev/press):

- High-resolution logos
- Founder bios
- Product screenshots
- Press release archive

Or email `press@openbuddy.dev`.

### Trademark policy

OpenBuddy is MIT-licensed for **code**. The **name and logo** are not part of the MIT grant.

You may:

- ✅ Use the name and logo to refer to the OpenBuddy project.
- ✅ Use the name and logo in plugins that extend OpenBuddy.
- ✅ Use the name and logo in educational / blog / talk contexts.

You may not:

- ❌ Use the name and logo for a fork that materially misrepresents itself as official.
- ❌ Use the name and logo in a commercial product name without written permission.

For commercial use inquiries: `trademark@openbuddy.dev`.
