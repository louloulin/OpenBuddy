/**
 * sheriff.config.ts — OpenBuddy module-boundary rules.
 *
 * A-7 in the ts-error-architecture-overhaul change.
 *
 * What Sheriff does: enforces that imports between modules follow a tag
 * graph. Each directory is a module; `index.ts` is the public surface;
 * everything else is private to that module. Cross-module imports must be
 * declared in `depRules` below.
 *
 * Why this matters: the codebase had 252 `@/` reverse-deps
 * (`packages/ui/openbuddy-ui-*/src/**` → `src/lib/**`), which silently
 * broke the L3 package boundary. Sheriff makes those illegal at lint time.
 *
 * Current state (A-7 initial):
 *   - All `ui:*` and `core:*` tags are declared.
 *   - depRules reflect the existing intent (ui packages can depend on
 *     the core types they already need).
 *   - Rules are enforced as `warn` in ESLint (see eslint.config.mjs).
 *     Promoting to `error` for specific tag pairs is the next commit.
 */
import type { SheriffConfig } from "@softarc/sheriff-core";

export const sheriffConfig: SheriffConfig = {
  // Sheriff config schema version. Bump only when adopting a new schema.
  version: 1,

  // Tag every module. Modules are any directory containing an `index.ts`.
  // Files outside a module are tagged `root` automatically.
  tagging: {
    // ── UI packages (the @/ reverse-dep offenders) ──
    "packages/ui/openbuddy-ui-conversation/src": ["ui:conversation"],
    "packages/ui/openbuddy-ui-workbench/src": ["ui:workbench"],
    "packages/ui/openbuddy-ui-experts/src": ["ui:experts"],
    "packages/ui/openbuddy-ui-settings/src": ["ui:settings"],
    "packages/ui/openbuddy-ui-sidebar/src": ["ui:sidebar"],
    "packages/ui/openbuddy-ui-email/src": ["ui:email"],
    "packages/ui/openbuddy-ui-runtime/src": ["ui:runtime"],

    // ── Core types currently imported by the ui packages above ──
    // A-7 step 2: extract these from src/ into @openbuddy/agent-rpc and
    // @openbuddy/ui-state, then update the ui tsconfig paths to drop
    // baseUrl=repo-root. Until then, we tag the source so Sheriff can
    // gate the @/ reverse-dep path.
    "src/lib/agent/pi-client.ts": ["core:agent-rpc"],
    "src/lib/agent/pi-session-events.ts": ["core:agent-rpc"],
    "src/lib/agent": ["core:agent"],
    "src/stores/session-store.ts": ["core:ui-state"],
    "src/stores": ["core:ui-state"],
    "src/lib/platform/loading-tips.ts": ["core:platform"],
    "src/lib/security/command-risk.ts": ["core:platform"],
    "src/lib/files/extract-text.ts": ["core:platform"],
    "src/lib": ["core:lib"],
  },

  // Dependency rules. Each rule says "modules tagged X may import from
  // modules tagged Y". Sheriff auto-untags internals and only allows
  // imports through the public index.ts surface.
  //
  // A-7 initial: the 4 top-offender ui packages may depend on the core
  // types they currently import. All other ui:* modules are restricted
  // to themselves + core:* + node built-ins.
  depRules: {
    "ui:conversation": ["core:agent-rpc", "core:agent", "core:ui-state", "core:platform", "core:lib"],
    "ui:workbench": ["core:agent-rpc", "core:agent", "core:ui-state", "core:platform", "core:lib"],
    "ui:experts": ["core:agent-rpc", "core:agent", "core:ui-state", "core:platform", "core:lib"],
    "ui:settings": ["core:agent-rpc", "core:agent", "core:ui-state", "core:platform", "core:lib"],
    "ui:sidebar": ["core:agent-rpc", "core:ui-state", "core:platform", "core:lib"],
    "ui:email": ["core:agent-rpc", "core:ui-state", "core:platform", "core:lib"],
    "ui:runtime": ["core:agent-rpc", "core:ui-state", "core:platform", "core:lib"],
  },
};
