/**
 * electron-vite configuration for OpenBuddy.
 *
 * Three bundles:
 *   - main:    `electron/main/index.ts` → `out/main/index.js`    (ESM, electron 28+)
 *   - preload: `electron/preload/index.ts` → `out/preload/index.js` (CJS, contextBridge)
 *   - renderer: repo-root `index.html` + `src/` → `out/renderer/index.html` (ESM, Vite + React)
 *
 * Workspace package strategy:
 *   - The 17 `@openbuddy/*` packages live in `packages/<group>/<pkg>/src/index.ts`. We
 *     alias them in `resolve.alias` so Vite/Rollup can process the TS source.
 *   - BUT: electron-vite's default `externalizeDeps` walks `package.json`
 *     `dependencies` and leaves them as bare imports in the bundle, expecting
 *     Node.js to resolve them at runtime. That breaks here because (a) the
 *     packages resolve to `.ts` source via pnpm symlinks, and (b) Electron's
 *     ESM loader refuses to import `.ts` directly.
 *   - Fix: set `externalizeDeps: false` (disables the default externalizer)
 *     AND use `rollupOptions.external` with a tight allow-list of just
 *     `electron` + `node:*` + the Pi SDK. Everything else - workspace
 *     packages AND runtime deps like react / katex / mermaid / pi-coding-agent
 *     - gets bundled into `out/main/index.js` so the runtime never has to
 *     resolve them.
 *   - `output.inlineDynamicImports: true` force-inlines the lazy
 *     `await import(...)` plugin loader calls into the main chunk, for
 *     the same reason.
 *   - The renderer is unaffected (Vite bundles everything by default).
 *   - `@openbuddy/<pkg>/<subpath>` exports (e.g. `./yaml-patch`) get
 *     their own alias entries; Vite's alias is prefix-matching, so the
 *     subpath entries appear BEFORE the bare-package alias.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// Node 20.11+/22.x supports `import.meta.dirname` natively — no `require()`,
// no `fileURLToPath`, no shim. electron-vite compiles this config file to
// ESM before evaluating it, so any `require()` call here would explode with
// "Dynamic require ... is not supported".
const repoRoot = import.meta.dirname;

// Array form (NOT object form). Vite alias is prefix-matching, so the
// longer subpath `@openbuddy/team-team/pi` MUST come before the bare
// `@openbuddy/team-team` alias — otherwise the bare alias would consume
// the subpath import and Vite would try to load
// `packages/.../src/index.ts/pi` (a directory under a file → ENOTDIR).
const workspacePackageAliases = [
  // Subpath aliases — most specific first. Auto-discovered from
  // each workspace package exports field. Order matters:
  // longer paths MUST precede the bare-package alias below.

  { find: "@openbuddy/plugin-host/bundle-manifest", replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/bundle-manifest.ts") },
  { find: "@openbuddy/plugin-host/persistence", replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/persistence.ts") },
  { find: "@openbuddy/plugin-host/yaml-patch", replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/yaml-patch.ts") },
  { find: "@openbuddy/plugin-host/js-expr", replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/js-expr.ts") },
  { find: "@openbuddy/team-team/pi", replacement: resolve(repoRoot, "packages/team/openbuddy-team/src/pi.ts") },
  { find: "@openbuddy/core-session/lifecycle", replacement: resolve(repoRoot, "packages/core/openbuddy-session/src/lifecycle.ts") },


  // Bare-package aliases.
  { find: "@deepseek-ai/cordis",    replacement: resolve(repoRoot, "packages/runtime/openbuddy-cordis/src/index.ts") },
  { find: "@openbuddy/cordis",         replacement: resolve(repoRoot, "packages/runtime/openbuddy-cordis/src/index.ts") },
  { find: "@openbuddy/plugin-host",    replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/index.ts") },
  { find: "@openbuddy/bundle-base",    replacement: resolve(repoRoot, "packages/bundle/openbuddy-base/src/index.ts") },
  { find: "@openbuddy/renderer-host",  replacement: resolve(repoRoot, "packages/renderer/openbuddy-renderer-host/src/index.ts") },
  { find: "@openbuddy/core-session",   replacement: resolve(repoRoot, "packages/core/openbuddy-session/src/index.ts") },
  { find: "@openbuddy/logging-main", replacement: resolve(repoRoot, "packages/core/openbuddy-logging-main/src/index.ts") },
  { find: "@openbuddy/logging-renderer", replacement: resolve(repoRoot, "packages/core/openbuddy-logging-renderer/src/index.ts") },
  { find: "@openbuddy/logging-shared", replacement: resolve(repoRoot, "packages/shared/openbuddy-logging-shared/src/index.ts") },
  { find: "@openbuddy/storage",         replacement: resolve(repoRoot, "packages/runtime/openbuddy-storage/src/index.ts") },
  // openbuddy-web-search removed; web capability delegated to pi-web-access (passthrough)
  // Stage G-1c: openbuddy-ui-automation restored per user directive
  // "自动化ui保留不要删除". The UI shells are preserved; automation
  // is owned by pi-background-tasks + pi-goal (passthrough).
  { find: "@openbuddy/capability-plan",            replacement: resolve(repoRoot, "packages/capability/openbuddy-plan/src/index.ts") },
  { find: "@openbuddy/capability-authorization",   replacement: resolve(repoRoot, "packages/capability/openbuddy-authorization/src/index.ts") },
  { find: "@openbuddy/capability-mcp-client",       replacement: resolve(repoRoot, "packages/capability/openbuddy-mcp-client/src/index.ts") },
  { find: "@openbuddy/auth-permission",            replacement: resolve(repoRoot, "packages/auth/openbuddy-permission/src/index.ts") },
  { find: "@openbuddy/auth-casdoor",               replacement: resolve(repoRoot, "packages/auth/openbuddy-casdoor/src/index.ts") },
  { find: "@openbuddy/shared-types",               replacement: resolve(repoRoot, "packages/shared/openbuddy-types/src/index.ts") },
  { find: "@openbuddy/files-kb",                  replacement: resolve(repoRoot, "packages/shared/openbuddy-files-kb/src/index.ts") },
  { find: "@openbuddy/fs-fs-local",                replacement: resolve(repoRoot, "packages/fs/openbuddy-fs-local/src/index.ts") },
  { find: "@openbuddy/team-team",                  replacement: resolve(repoRoot, "packages/team/openbuddy-team/src/index.ts") },
  { find: "@openbuddy/collaboration-protocol",     replacement: resolve(repoRoot, "packages/collaboration/openbuddy-protocol/src/index.ts") },
  { find: "@openbuddy/collaboration-policy",       replacement: resolve(repoRoot, "packages/collaboration/openbuddy-policy/src/index.ts") },
  { find: "@openbuddy/collaboration-task",         replacement: resolve(repoRoot, "packages/collaboration/openbuddy-task/src/index.ts") },
  { find: "@openbuddy/collaboration-evidence",     replacement: resolve(repoRoot, "packages/collaboration/openbuddy-evidence/src/index.ts") },
  { find: "@openbuddy/collaboration-room",         replacement: resolve(repoRoot, "packages/collaboration/openbuddy-room/src/index.ts") },
  { find: "@openbuddy/collaboration-inbox",        replacement: resolve(repoRoot, "packages/collaboration/openbuddy-inbox/src/index.ts") },
  { find: "@openbuddy/collaboration-coordinator", replacement: resolve(repoRoot, "packages/collaboration/openbuddy-coordinator/src/index.ts") },
  { find: "@openbuddy/collaboration-network", replacement: resolve(repoRoot, "packages/collaboration/openbuddy-network/src/index.ts") },
];

// 从 packages/ui/alias-list.json 读 ui-* 包清单,生成 vite alias 数组。
// 长前缀(/client 与 /invariant 子路径)在前,裸包名在后,与 tsconfig paths
// 顺序保持一致(alias 数组按 prefix 顺序匹配,顺序错就匹配错)。
function buildUiRendererAliases(repoRoot: string): Array<{ find: string; replacement: string }> {
  const listPath = resolve(repoRoot, "packages/ui/alias-list.json");
  if (!existsSync(listPath)) return [];
  type UiAliasEntry = {
    name: string;
    main: string;
    client?: string;
    invariant?: string;
    subpaths?: Record<string, string>;
  };
  const list: UiAliasEntry[] = JSON.parse(readFileSync(listPath, "utf8"));
  const out: Array<{ find: string; replacement: string }> = [];
  for (const p of list) {
    // 长前缀在前:subpaths(含 /client /invariant /styles /icons 等)先注册,
    // 避免被裸名 prefix 误吞导致路径变成 ".../src/index.ts/<sub>"(ENOTDIR)。
    for (const [seg, target] of Object.entries(p.subpaths ?? {})) {
      out.push({ find: `${p.name}/${seg}`, replacement: resolve(repoRoot, target) });
    }
    if (p.client)     out.push({ find: `${p.name}/client`,     replacement: resolve(repoRoot, p.client) });
    if (p.invariant)  out.push({ find: `${p.name}/invariant`,  replacement: resolve(repoRoot, p.invariant) });
    out.push(         { find: p.name,                          replacement: resolve(repoRoot, p.main) });
  }
  return out;
}
const uiRendererAliases = buildUiRendererAliases(repoRoot);

// The renderer only needs the renderer-host dependency graph. Keeping the
// Node-only plugin-host entry points out of the renderer Vite graph avoids
// false browser externalization warnings and prevents Node built-ins from
// being discovered during a render-only build.
const rendererOnlyAliases: Array<{ find: string; replacement: string }> = [
  // Renderer-safe workspace packages only.
  { find: "@openbuddy/plugin-host/renderer-patch", replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/renderer-patch.ts") },
  { find: "@openbuddy/bundle-base/renderer", replacement: resolve(repoRoot, "packages/bundle/openbuddy-base/src/renderer.ts") },
  { find: "@openbuddy/plugin-host/yaml-patch", replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/yaml-patch.ts") },
  { find: "@deepseek-ai/cordis", replacement: resolve(repoRoot, "packages/runtime/openbuddy-cordis/src/index.ts") },
  { find: "@openbuddy/cordis", replacement: resolve(repoRoot, "packages/runtime/openbuddy-cordis/src/index.ts") },
  { find: "@openbuddy/renderer-host", replacement: resolve(repoRoot, "packages/renderer/openbuddy-renderer-host/src/index.ts") },
  { find: "@openbuddy/auth-casdoor", replacement: resolve(repoRoot, "packages/auth/openbuddy-casdoor/src/index.ts") },
  { find: "@openbuddy/shared-types", replacement: resolve(repoRoot, "packages/shared/openbuddy-types/src/index.ts") },
  { find: "@openbuddy/files-kb", replacement: resolve(repoRoot, "packages/shared/openbuddy-files-kb/src/index.ts") },
  { find: "@openbuddy/logging-shared", replacement: resolve(repoRoot, "packages/shared/openbuddy-logging-shared/src/index.ts") },
  { find: "@openbuddy/logging-renderer", replacement: resolve(repoRoot, "packages/core/openbuddy-logging-renderer/src/index.ts") },

  // ui-* 包:自动消费 sync-ui-aliases.mjs 维护的 packages/ui/alias-list.json,
  // 让新增 / 移除 ui-* 包无需手动改 vite 配置。每个包按"长前缀 client/invariant 在前,
  // 裸包名在后"展开,与 tsconfig paths 顺序保持一致。
  ...uiRendererAliases,

  // `@/*` → `src/*`. Listed last so it can't accidentally shadow a workspace
  // package name (none of them start with `@` followed by something matching
  // the `*` glob, but order = safety).
  { find: "@", replacement: resolve(repoRoot, "src") },
];

// Force Rollup to inline these packages (i.e. NOT keep them as bare imports
// in the bundle). Keys must match the specifiers used in source code, e.g.
// `@openbuddy/plugin-host`. Without this, electron-vite leaves them as
// `import ... from "@openbuddy/plugin-host"` and the runtime tries to load
// `packages/runtime/openbuddy-plugin-host/src/index.ts` via Node ESM, which
// fails because `.ts` files aren't supported by the ESM loader.
export default defineConfig({
  // ---------------------------------------------------------------------------
  // main process — Electron 44 supports ESM, so we output `index.js` and let
  // package.json's `"type": "module"` drive module resolution. The 17
  // workspace packages are inlined; everything else (electron, react, katex,
  // mermaid, etc.) stays externalized and is loaded from node_modules.
  // ---------------------------------------------------------------------------
  main: {
    build: {
      outDir: "out/main",
      lib: {
        entry: resolve(repoRoot, "electron/main/index.ts"),
        formats: ["es"],
      },
      // Disable electron-vite's automatic `externalizeDeps` (which walks
      // `package.json` `dependencies` and externalizes them). Without
      // this, our `rollupOptions.external` is overridden and the
      // workspace packages end up as bare imports at runtime.
      externalizeDeps: false,
      rollupOptions: {
        // Anything not in this list gets bundled into out/main/index.js.
        // We keep only the Electron runtime + Node built-ins external;
        // everything else — including all `@openbuddy/*` workspace
        // packages that alias to `.ts` source — is inlined because
        // Node's ESM loader refuses to import `.ts` at runtime.
        external: [
          "electron",
          /^node:/,
          /^@earendil-works\/pi-/,
        ],
        output: {
          // Force-bundle every dynamic import (`await import(...)`) into
          // the main chunk. The source uses dynamic imports to lazily
          // load plugins (see electron/main/openbuddy-core-plugin.ts),
          // but the Node ESM loader cannot resolve those runtime
          // `import()` calls when their specifier points at `.ts`
          // source. Inlining them trades a slightly bigger initial
          // bundle for a working app.
          inlineDynamicImports: true,
        },
      },
    },
    resolve: {
      alias: workspacePackageAliases,
    },
  },

  // ---------------------------------------------------------------------------
  // preload — contextBridge runs in a sandboxed CJS context. We bundle to a
  // CJS .js file. The same workspace-package exclusion applies so any
  // `@openbuddy/*` import that preload does gets inlined.
  // ---------------------------------------------------------------------------
  preload: {
    build: {
      outDir: "out/preload",
      lib: {
        entry: resolve(repoRoot, "electron/preload/index.ts"),
        formats: ["cjs"],
      },
      externalizeDeps: false,
      rollupOptions: {
        external: [
          "electron",
          /^node:/,
        ],
      },
    },
    resolve: {
      alias: workspacePackageAliases,
    },
  },

  // ---------------------------------------------------------------------------
  // renderer — the React app rooted at the repository root (index.html + src/).
  // `base: "./"` keeps asset URLs relative so file:// loading in production
  // works inside the packaged Electron app. The renderer doesn't need
  // externalizeDeps.exclude because Vite bundles everything by default.
  // ---------------------------------------------------------------------------
  renderer: {
    root: repoRoot,
    base: "./",
    build: {
      outDir: "out/renderer",
      // P0-02: Disable Vite's __vitePreload() polyfill wrapper AND filter out
      // heavy chunks from the auto-generated <link rel="modulepreload">
      // tags. The polyfill stop alone doesn't prevent Vite from emitting
      // modulepreload HTML tags for the manualChunks siblings — those
      // tags race with the first-paint critical path and force-fetch
      // markdown/mermaid before they're needed.
      //
      // Heavy chunks (markdown 2.2MB, katex 485K, mermaid 1.3MB, cytoscape
      // 940K, cynefin 1.2MB) are pulled by manualChunks and only fetched
      // when their consumer module evaluates its dynamic import. They
      // should NEVER appear in the initial <link> tags or the entry
      // chunk's __vitePreload() invocations.
      modulePreload: {
        polyfill: false,
        resolveDependencies: (_filename, deps, _context) => {
          // `deps` is the list of chunk filenames Vite would emit as
          // <link rel="modulepreload"> for the entry. Filter out heavy
          // lazy chunks so they don't get preloaded before they're
          // needed.
          const skip = ["markdown", "katex", "mermaid", "cytoscape", "cynefin"];
          return deps.filter((dep) => !skip.some((name) => dep.includes(`/${name}-`) || dep.includes(`/${name}.`)));
        },
      },
      // P2-12: Aggressive tree-shaking. Tell Rollup that no source
      // modules have side effects unless they explicitly mark so —
      // removes unused exports that the default conservative setting
      // would keep (e.g. UI primitives that look like they could run
      // at import time but don't).
      treeshake: {
        moduleSideEffects: (id) => {
          // These entrypoints DO have side effects (they register
          // handlers, set globals, register plugin UI). Everything
          // else: assume pure.
          if (id.endsWith("/main.tsx")) return true;
          if (id.endsWith("/preload/index.ts")) return true;
          if (id.endsWith("/index.html")) return true;
          if (id.endsWith("/client.tsx") || id.endsWith("/client.ts")) return true;
          if (id.endsWith("/invariant.ts") || id.endsWith("/invariant.tsx")) return true;
          // CSS imports are inherently side-effecting (they inject styles).
          if (/\.(css|scss|sass|less)$/.test(id)) return true;
          return false;
        },
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
      },
      rollupOptions: {
        input: resolve(repoRoot, "index.html"),
        output: {
          manualChunks: {
            markdown: [
              "react-markdown",
              "remark-gfm",
              "remark-breaks",
              "remark-math",
              "rehype-highlight",
              "rehype-sanitize",
              "lowlight",
            ],
            katex: ["katex", "rehype-katex"],
            mermaid: ["mermaid"],
          },
        },
      },
    },
    resolve: {
      alias: rendererOnlyAliases,
    },
    plugins: [react()],
    server: {
      // Electron main reads ELECTRON_RENDERER_URL (set automatically by
      // electron-vite). The port here must match the Vite dev port the main
      // process loads. If the preferred port is busy, Vite selects the next
      // available port and electron-vite updates ELECTRON_RENDERER_URL.
      port: 1420,
      strictPort: false,
      host: "0.0.0.0",
    },
  },
});
