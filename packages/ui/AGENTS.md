# packages/ui — UI plugin tier

Browser-side product UI packages. Each child owns one self-contained UI
domain; composition happens through the slot system in
`@openbuddy/ui-runtime`, which wraps the renderer-host SlotCore provided
by `@openbuddy/renderer-host`. This tier mirrors the deepseek-harness
`packages/client/*` pattern (per-feature packages, slot-only composition,
declarative shell registration) and reuses OpenBuddy's existing
`@openbuddy/renderer-host` for the slot core / IPC / event-bus plumbing so
product UI ships without recreating the load-and-compose machinery.

## Conventions

- **Name:** `@openbuddy/ui-<domain>`, directory
  `packages/ui/openbuddy-ui-<domain>/`. The directory prefix and the
  package scope both encode "ui".
- **Three registration surfaces** (mirrors deepseek-harness "new plugin
  package checklist"):
  1. `packages/ui/tsconfig.json` project-references entry
  2. App-side declaration in `src/App.tsx`'s SlotTree mount (or via
     `@openbuddy/ui-runtime`'s auto-discovery)
  3. The dependency entry in the consuming root `package.json` /
     `tsconfig.json` paths (kept in sync by
     `scripts/sync-ui-aliases.mjs`).

- **Slot-only composition.** A package composes UI only through
  `ctx.slots.register({ name, children?, store?, inject? }, Component)` —
  no global singletons, no manual DOM mounting, no React Context outside
  the `useStore` / framework-injected hooks.
- **Component props are the four shares**, all derived from the SlotMap
  declaration. The runtime package merges the global + session standard
  kit hooks (`useSession`, `useSessions`, `useWorkspaces`,
  `useStore`) into `PropsRuntime`. The store seat comes from a
  `defineStore({ init, actions, persist? })` factory declared at the
  register site. The inject face comes from the registrant's `inject(ctx)`
  closure.
- **Reactivity ladder.** All live data that survives remounts goes through
  a store; data shared across slots goes through a registered provide
  service (`ctx.sessions.provide(...)` etc.); per-render data goes
  through owner props.
- **No global React context.** The `<SlotProvider>` at the app root is
  the only place where `@openbuddy/ui-runtime` exposes a top-level
  provider. Below that, every component reads from props or framework
  hooks.
- **CSS modules** (`*.module.css`) for component-local styles. Token-level
  styles live in `@openbuddy/ui-theme` (the only place `data-theme` and
  `--wb-*` CSS variables are touched). Global resets / utilities come
  from the host's `src/styles/*`.
- **i18n keys** live in the package's `locales/<pkg>.json` (when the
  package ships its own vocabulary) and are bound through
  `@openbuddy/ui-locale`'s `bindNamespace()`. The `@openbuddy/ui-locale`
  package holds the shared common vocabulary.

## Package layout (template)

Every package ships this minimal skeleton — copy / paste to start a new
`ui-*`:

```
packages/ui/openbuddy-ui-<name>/
├── package.json
├── tsconfig.json
├── README.md
├── locales/<name>.json     (optional)
└── src/
    ├── index.ts            (browser entry; exports `apply` and any
                             public types — products and third-party
                             plugins import from here)
    ├── client.ts           (SlotCore registration body; called by
                             ui-runtime when the package is mounted)
    ├── invariant.ts        (debug-only invariant companion; no-op when
                             no runtime invariants apply)
    └── ...                 (component-local modules)
```

## `apply` contract

Every `@openbuddy/ui-*` package exports a function-plugin `apply(ctx,
config?)` from its `src/index.ts`. `@openbuddy/ui-runtime` invokes
`apply` once per mounted instance, on a renderer-context that already
has `ctx.slots`, `ctx.sessions`, `ctx.workspaces`, `ctx.theme`,
`ctx.locale`, and `ctx.events`. The `apply` body is the only place
that may call `ctx.slots.register(...)` — components do not mount
themselves.

The function form mirrors the renderer-host `RendererPlugin` shape so
that third-party `dsh.client` plugins continue to compose through the
same loader.

## Adding a new ui-* package

1. Copy the template directory above.
2. Update `package.json` name (`@openbuddy/ui-<name>`) and add any
   workspace dependencies.
3. Update `tsconfig.json` references (only for workspace deps the
   package actually imports).
4. Run `node scripts/sync-ui-aliases.mjs` to refresh paths / Vite
   aliases — it scans `packages/ui/*` and updates
   `tsconfig.json` + `electron.vite.config.ts` automatically.
5. Implement `apply` in `src/index.ts` and the component(s) in
   `src/client.ts`.
6. Register the package in `src/App.tsx`'s SlotTree (or via
   `@openbuddy/ui-runtime`'s `registerBuiltinUi()`).

## What this tier is NOT

- **Not a runtime replacement.** `@openbuddy/renderer-host` owns the
  slot core, IPC, plugin loader, and dsh.client compatibility. The
  `packages/ui/*` tier only adds product UI packages on top.
- **Not an internal-only seam.** Third-party UI plugins can ship against
  the same slot surface — composition is symmetric.
- **Not a replacement for capability packages.** Capability packages
  (e.g. `@openbuddy/capability-email`) own data and side-effects;
  `ui-*` packages own presentation. A capability ships a service that
  the relevant `ui-*` package consumes via `ctx.get(...)`.
