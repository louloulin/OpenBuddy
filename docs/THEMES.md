# OpenBuddy Themes (v2)

OpenBuddy ships **19 OKLCh-based themes**, a **Match-system** mode that pairs a
light and a dark theme, **per-theme font loading**, and a **Theme Studio** for
building your own theme.

This document is the single source of truth for the theme system. It replaces
the light/dark-only description in earlier docs.

---

## 1. Theme catalogue

| Name | Label | Type | Accent |
|------|-------|------|--------|
| `claude` | Claude | dark | `#cc785c` |
| `black` | Black | dark | `#737373` |
| `midnight-ocean` | Midnight Ocean | dark | `#3b82f6` |
| `aurora` | Aurora | dark | `#22d3ee` |
| `ember` | Ember | dark | `#f97316` |
| `forest` | Forest | dark | `#10b981` |
| `cyber` | Cyber | dark | `#22ff88` |
| `matrix` | Matrix | dark | `#00ff41` |
| `white` | White | light | `#737373` |
| `paper` | Paper | light | `#a07a4a` |
| `sakura` | Sakura | light | `#ec4899` |
| `meadow` | Meadow | light | `#16a34a` |
| `sky` | Sky | light | `#0ea5e9` |
| `lavender` | Lavender | light | `#8b5cf6` |
| `apple` | Apple | light | `#007aff` |
| `win95` | Windows 95 | light | `#008080` |
| `winxp` | Windows XP | light | `#245edb` |

Definitions live in

> **Note**: the two built-in defaults — `openbuddy` (light) and `openbuddy-dark`
> (dark) — also live in this list and can be picked explicitly. The list is
> therefore 19 themes total, not 17.


[`packages/ui/openbuddy-ui-theme/src/themes.ts`](../packages/ui/openbuddy-ui-theme/src/themes.ts).

## 2. Token model

Every theme is a flat record of CSS custom properties using the existing
`--wb-*` names, so the 26 ui-* packages need no changes:

```
--wb-bg-primary / -secondary / -tertiary / -elevated / -overlay
--wb-fg-primary / -secondary / -tertiary
--wb-border / -soft
--wb-accent / -soft / -fg
--wb-danger / -success / -warning
--wb-shadow / -md / -lg
--wb-radius-sm / -md / -lg / -xl
--wb-font / -font-mono
```

Two base blocks (`LIGHT_BASE`, `DARK_BASE`) supply defaults; a theme's `vars`
is merged on top. The store writes both the variables and two attributes on
`document.documentElement`:

- `data-theme="dark" | "light"` — kept for back-compat with existing CSS.
- `data-theme-name="claude" | "sakura" | ...` — the new, precise identity.

Win95 / WinXP deliberately opt out of OKLCh to preserve their pixel-era look.

## 3. Modes

| Mode | Behaviour |
|------|-----------|
| `manual` | Exactly one named theme is active. This is the default. |
| `system` | The OS light/dark preference picks between a stored **pair** (one theme for light, one for dark). |

Switching to a named theme implicitly forces `manual` mode.

Storage keys (localStorage):

| Key | Value |
|-----|-------|
| `openbuddy.theme` | `light` \| `dark` \| `system` (v1 preference) |
| `openbuddy.theme.name` | active theme name (manual mode) |
| `openbuddy.theme.mode` | `manual` \| `system` |
| `openbuddy.theme.pair.light` | theme name used when the OS is light |
| `openbuddy.theme.pair.dark` | theme name used when the OS is dark |

## 4. Service API

`useTheme()` (and `ctx.theme` for plugins) returns a `ThemeService`:

```ts
// v1 — preserved verbatim
current(): "light" | "dark"
preference(): "light" | "dark" | "system"
setPreference(t): void
setTheme(t): void
toggle(): void
systemPrefersDark(): boolean
subscribe(fn): () => void

// v2 — new
currentName(): ThemeName
mode(): "manual" | "system"
getPair(): { light: ThemeName; dark: ThemeName }
setThemeByName(name: ThemeName): void
setPair({ light?, dark? }): void
setMode(mode: "manual" | "system"): void
list(): readonly ThemeDefinition[]
```

## 5. FOUC prevention

`initializeThemeSync()` (exported from `@openbuddy/ui-theme/client`) paints the
document **before React mounts**. It is called at the top of `src/main.tsx`.
`<ThemeInitializer />` is mounted as the first child of `<SlotProvider>` and
re-paints idempotently if the two ever disagree.

Unlike cabinet's old `next-themes` setup, no inline `<script>` is injected —
which kept React 19 from logging a console error on every render.

## 6. Theme picker

`<ThemePicker />` is a self-contained popover:

- Groups themes by dark / light.
- Shows the accent swatch and a heading-font preview per row.
- Exposes the `manual` / `follow system` toggle.
- In system mode, reveals a light/dark pair selector.

It is rendered from the settings panel (`个性化 → 主题库（19 套）`) and may be
dropped anywhere else — it manages its own portal and outside-click handling.

## 7. Fonts

Each theme may declare `font` / `headingFont`. Only the active theme's families
are requested from Google Fonts (see `loadThemeFonts`), avoiding cabinet's old
behaviour of loading 30+ families on every page load.

The stylesheet link is tagged `#openbuddy-theme-fonts-link` so it can be
swapped rather than accumulated.

## 8. Adding a theme

1. Append a `ThemeDefinition` to `THEMES` in `themes.ts`.
2. Add the name to the `ThemeName` union.
3. Run `pnpm vitest run packages/ui/openbuddy-ui-theme` — the "all 17 themes
   apply" suite automatically covers the new entry once the union grows.

## 9. Roadmap

- **Theme Studio** (v1.0): an in-app OKLCh editor that exports / imports theme
  JSON. Not shipped in v0.15.x.
- Per-component radius and density overrides.


## 10. Phase A — Dark-theme scoping fix (R17.7)

`src/styles/tokens.css` previously hard-coded a single dark palette with
`!important` on `[data-theme="dark"]`, which collapsed every named dark theme
(black / aurora / matrix / forest / ember / midnight-ocean / cyber) to the
same `#1f1f1f` / `#2a2a2a` surface — killing each theme's colour identity.

The hard-coded `!important` block is now scoped to the **default** dark theme:

```css
[data-theme="dark"][data-theme-name="openbuddy-dark"],
[data-theme="dark"]:not([data-theme-name]),
[data-theme="dark"] body,
[data-theme="dark"] html {
  --wb-bg-primary: #1f1f1f !important;
  ...
}
```

All other named dark themes now consume the OKLCh vars written by
`applyThemeAttrs()` (see `theme-store.ts`). Visual regression assets live in
`tests/screenshots/themes/` (19 PNGs).

