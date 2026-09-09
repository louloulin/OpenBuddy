/**
 * sheriff.config.ts — OpenBuddy module-boundary rules.
 *
 * Phase J.1 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v6 §26.4 step 3):
 * v6 §3.4 / v4 §24 layer model is now encoded as tag graph + depRules.
 *
 * Layer model (v4 §24.3 — "微内核 + 插件蓝图"):
 *
 *   Layer 1  Plugins  (openbuddy-plugin-sdk / openbuddy-plugin-host)
 *     └── The 4-track OpenBuddyPlugin SDK + harness / cordis / slot /
 *         extension loaders. May import from Layers 2 + 4 only.
 *
 *   Layer 2  Microkernel  (electron/main/agent/**)
 *     └── PI AgentSession + ExtensionRunner + SessionManager +
 *         Cordis Context + agentHost facade. May import from
 *         Layer 1 (plugin SDK types) + Layer 3 (its own ipc adapter).
 *
 *   Layer 3  IPC adapter  (electron/main/ipc/**)
 *     └── 16 capability files that translate renderer invoke calls into
 *         microkernel facade calls. May import from Layer 2 only.
 *
 *   Layer 4  Renderer  (packages/ui/openbuddy-ui-*/src + src/)
 *     └── 7 ui packages + renderer-only state. May import from
 *         `core:*` tag group (the public IPC types).
 *
 * Strict direction: Layer 1 → 2 → 3 → 4 cannot reverse-import.
 *
 * Current state:
 *   - v6 §3.4 enforced as `warn` in ESLint (see eslint.config.mjs).
 *   - Boundary script `pnpm storage:boundaries` scans 403 files
 *     for reverse-deps across 6 production roots and reports 0
 *     violations (per v6 §26.4 step 3 baseline).
 *   - Promoting specific tag pairs to `error` is the J.1 follow-up
 *     after this commit's tag coverage stabilizes.
 */
import type { SheriffConfig } from "@softarc/sheriff-core";

export const sheriffConfig: SheriffConfig = {
  // Sheriff config schema version. Bump only when adopting a new schema.
  version: 1,

  // Tag every module. Modules are any directory containing an `index.ts`.
  // Files outside a module are tagged `root` automatically.
  tagging: {
    // ── Layer 1: Plugins (openbuddy-plugin-sdk / openbuddy-plugin-host) ──
    "packages/runtime/openbuddy-plugin-sdk/src": ["plugin:sdk"],
    "packages/runtime/openbuddy-plugin-host/src": ["plugin:host"],

    // ── Layer 2: Microkernel ──
    "electron/main/agent/host-modules/bootstrap": ["microkernel:bootstrap"],
    "electron/main/agent/host-modules/facade": ["microkernel:facade"],
    "electron/main/agent/host-modules": ["microkernel:host-modules"],
    "electron/main/agent/host-modules/profile": ["microkernel:profile"],
    "electron/main/agent/host-modules/lifecycle": ["microkernel:lifecycle"],
    "electron/main/agent/extensions": ["microkernel:extensions"],
    "electron/main/agent/pi-resources": ["microkernel:pi-resources"],
    "electron/main/agent/pi-bridge": ["microkernel:pi-bridge"],
    "electron/main/agent": ["microkernel:agent"],

    // ── Layer 2.5: DSH residual thin layer (post-L.*) ──
    "electron/main/deepseek": ["dsh:residual"],

    // ── Layer 3: IPC adapter ──
    "electron/main/ipc": ["ipc:adapter"],

    // ── Layer 4: UI packages (the @/ reverse-dep offenders) ──
    "packages/ui/openbuddy-ui-conversation/src": ["ui:conversation"],
    "packages/ui/openbuddy-ui-workbench/src": ["ui:workbench"],
    "packages/ui/openbuddy-ui-experts/src": ["ui:experts"],
    "packages/ui/openbuddy-ui-settings/src": ["ui:settings"],
    "packages/ui/openbuddy-ui-sidebar/src": ["ui:sidebar"],
    "packages/ui/openbuddy-ui-email/src": ["ui:email"],
    "packages/ui/openbuddy-ui-runtime/src": ["ui:runtime"],

    // ── Layer 4: Core types currently imported by the ui packages ──
    // (J.1 follow-up: extract these from src/ into @openbuddy/agent-rpc and
    //  @openbuddy/ui-state, then drop baseUrl=repo-root.)
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
  // v6 §3.4 layer model (strict direction Layer 1 → 2 → 3 → 4):
  //   plugin:sdk + plugin:host may depend on microkernel:host-modules
  //     (PI extension surface is a microkernel concern, but the SDK
  //      serializer reads PI types).
  //   microkernel:* may depend on plugin:sdk (host bootstraps extension
  //     loader through the SDK public surface).
  //   microkernel:* + dsh:residual may depend on ipc:adapter (the
  //     facade is consumed by ipc; the bootstrap calls into facade).
  //   ipc:adapter may depend on microkernel:host-modules + microkernel:facade
  //     (translates renderer invokes into microkernel facade calls).
  //   ui:* may depend on core:* (only public IPC types).
  //   dsh:residual may depend on microkernel:host-modules (the runtime
  //     facade is the only thing left after Phase L.* — the runtime
  //     helper imports pi-resources and plugin types).
  depRules: {
    // Layer 1 → 2 (plugin SDK reads PI types from microkernel)
    "plugin:sdk": ["microkernel:host-modules"],
    "plugin:host": [
      "plugin:sdk",
      "microkernel:host-modules",
    ],

    // Layer 2: microkernel may consume plugin SDK + ipc facade
    "microkernel:agent": ["plugin:sdk", "microkernel:host-modules", "ipc:adapter"],
    "microkernel:host-modules": ["plugin:sdk", "microkernel:facade"],
    "microkernel:bootstrap": ["microkernel:host-modules", "microkernel:facade"],
    "microkernel:facade": ["microkernel:host-modules"],
    "microkernel:profile": ["microkernel:host-modules"],
    "microkernel:lifecycle": ["microkernel:host-modules"],
    "microkernel:extensions": ["plugin:sdk", "microkernel:host-modules"],
    "microkernel:pi-resources": ["plugin:sdk", "microkernel:host-modules"],
    "microkernel:pi-bridge": ["plugin:sdk", "microkernel:host-modules"],

    // Layer 2.5: DSH residual thin layer (post-L.*)
    "dsh:residual": [
      "plugin:sdk",
      "microkernel:host-modules",
      "microkernel:facade",
    ],

    // Layer 3: IPC adapter may import microkernel facade
    "ipc:adapter": ["microkernel:host-modules", "microkernel:facade"],

    // Layer 4: ui packages may only depend on core types
    "ui:conversation": ["core:agent-rpc", "core:agent", "core:ui-state", "core:platform", "core:lib"],
    "ui:workbench": ["core:agent-rpc", "core:agent", "core:ui-state", "core:platform", "core:lib"],
    "ui:experts": ["core:agent-rpc", "core:agent", "core:ui-state", "core:platform", "core:lib"],
    "ui:settings": ["core:agent-rpc", "core:agent", "core:ui-state", "core:platform", "core:lib"],
    "ui:sidebar": ["core:agent-rpc", "core:ui-state", "core:platform", "core:lib"],
    "ui:email": ["core:agent-rpc", "core:ui-state", "core:platform", "core:lib"],
    "ui:runtime": ["core:agent-rpc", "core:ui-state", "core:platform", "core:lib"],
  },
};
