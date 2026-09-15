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
 *   - Main-process workspace dependencies are bundled into the generated
 *     chunks. Dynamic imports stay as relative chunks so the agent host and
 *     optional plugin graph are not evaluated during cold boot.
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
  // Phase B.3 step 2b — DSH core shared state + PI extensions. Subpath
  // aliases must precede the bare-package alias below so the longer
  // `@openbuddy/dsh-core/state` lookup wins over the bare
  // `@openbuddy/dsh-core` fallback.
  { find: "@openbuddy/dsh-core/state", replacement: resolve(repoRoot, "packages/runtime/openbuddy-dsh-core/src/state.ts") },
  { find: "@openbuddy/dsh-core/goals", replacement: resolve(repoRoot, "packages/runtime/openbuddy-dsh-core/src/goals.ts") },
  { find: "@openbuddy/dsh-core/message-feedback", replacement: resolve(repoRoot, "packages/runtime/openbuddy-dsh-core/src/message-feedback.ts") },
  { find: "@openbuddy/team-team/pi", replacement: resolve(repoRoot, "packages/team/openbuddy-team/src/pi.ts") },
  { find: "@openbuddy/core-session/lifecycle", replacement: resolve(repoRoot, "packages/core/openbuddy-session/src/lifecycle.ts") },


  // Bare-package aliases.
  { find: "@deepseek-ai/cordis",    replacement: resolve(repoRoot, "packages/runtime/openbuddy-cordis/src/index.ts") },
  { find: "@openbuddy/cordis",         replacement: resolve(repoRoot, "packages/runtime/openbuddy-cordis/src/index.ts") },
  { find: "@openbuddy/plugin-host",    replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/index.ts") },
  { find: "@openbuddy/plugin-host/runtime", replacement: resolve(repoRoot, "packages/runtime/openbuddy-plugin-host/src/runtime.ts") },
  { find: "@openbuddy/dsh-core",       replacement: resolve(repoRoot, "packages/runtime/openbuddy-dsh-core/src/index.ts") },
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
  // Phase I.2 — calendar PI extension (electron/main/agent/extensions/calendar-pi-extension.ts)
  // needs the live calendar handlers + createCalendarToolDefinitions factory.
  { find: "@openbuddy/capability-calendar",         replacement: resolve(repoRoot, "packages/capability/openbuddy-calendar/src/index.ts") },
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

/**
 * Vite plugin — patch `__vite_browser_external__` so the renderer
 * doesn't crash on `fileURLToPath`, `EventEmitter`, etc.
 *
 * Background: Vite externalizes Node built-ins to a synthetic CJS
 * module that exports `{}`. The renderer's `node:url` / `node:events`
 * aliases above only catch source-level imports of those specifiers;
 * transitive deps inside `pi-coding-agent` (and other
 * `node: built-in`-using packages) get their imports satisfied
 * through `__vite_browser_external__.fileURLToPath`, which is
 * `undefined`. The renderer then crashes with `(...).fileURLToPath is
 * not a function`. This plugin mutates the synthetic CJS module
 * AFTER Vite resolves it so every call site sees the shim.
 *
 * Vite 8's optimize-deps step also inlines a Proxy facade into each
 * prebundled module that uses a Node built-in, e.g.
 *   var require_browser_external_url = /* @__PURE__ *\/ __commonJSMin(((exports, module) => {
 *     module.exports = Object.create(new Proxy({}, { get(_, key) { ... } }));
 *   }));
 * Every property access on `require_browser_external_url()` returns
 * undefined and warns to the console. We rewrite those facades in
 * place so the renderer can resolve `fileURLToPath`, `readFileSync`,
 * etc. without crashing.
 */
// buildOpenBuddyExternalPatch returns the ESM body Vite should serve for
// every `browser-external:<built-in>` and `__vite-browser-external:<built-in>`
// virtual id. Vite 8 renamed the namespace from `__vite-browser-external:`
// to `browser-external:` and the default shim is now a Proxy with no
// `default` export, which breaks `import { x } from "node:fs/promises"`
// (vite 8 rewrites named imports through `interopHelper(m.default, …)`).
// The body assigns every method/property the renderer ever asks for to a
// fresh `__openbuddyFac` constructor so the polyfill module is itself a
// valid class (for `class X extends require___vite_browser_external() {}`),
// then exposes both a default export and a plain-object facade with all
// static methods attached as own enumerable properties (so spread/destructuring
// through `import * as url from "node:url"` keeps every method reachable).
function buildOpenBuddyExternalPatch(): string {
  return [
    "function __openbuddyFac(){this._listeners=[];}",
    "__openbuddyFac.defaultMaxListeners=10;",
    "__openbuddyFac.prototype.on=function(){return this;};",
    "__openbuddyFac.prototype.once=function(){return this;};",
    "__openbuddyFac.prototype.off=function(){return this;};",
    "__openbuddyFac.prototype.emit=function(){return false;};",
    "__openbuddyFac.prototype.removeAllListeners=function(){return this;};",
    "__openbuddyFac.prototype.setMaxListeners=function(){return this;};",
    "__openbuddyFac.prototype.getMaxListeners=function(){return 10;};",
    "__openbuddyFac.prototype.listenerCount=function(){return 0;};",
    // Self-reference so `const { EventEmitter } = require(...)` and
    // `require(...).EventEmitter` both work.
    "__openbuddyFac.EventEmitter=__openbuddyFac;",
    "__openbuddyFac.fileURLToPath=function(){return '';};",
    "__openbuddyFac.pathToFileURL=function(p){return new URL('file://'+(p||''));};",
    "__openbuddyFac.createRequire=function(){return function(id){if(id==='node:events')return __openbuddyFac;return undefined;};};",
    "__openbuddyFac.dirname=function(p){return '/';};",
    "__openbuddyFac.basename=function(p){return '';};",
    "__openbuddyFac.extname=function(p){return '';};",
    "__openbuddyFac.join=function(){return '/';};",
    "__openbuddyFac.resolve=function(){return '/';};",
    "__openbuddyFac.isAbsolute=function(){return true;};",
    "__openbuddyFac.homedir=function(){return '/';};",
    // node:buffer — many old npm packages do `const Buffer = require('buffer').Buffer`
    // at module load. Provide a minimal buffer shim.
    "__openbuddyFac.Buffer=function(){return [];};",
    "__openbuddyFac.Buffer.from=function(){return [];};",
    "__openbuddyFac.Buffer.alloc=function(){return [];};",
    "__openbuddyFac.Buffer.allocUnsafe=function(){return [];};",
    "__openbuddyFac.Buffer.allocUnsafeSlow=function(){return [];};",
    "__openbuddyFac.isBuffer=function(){return false;};",
    "__openbuddyFac.isAscii=function(){return true;};",
    // node:util — promisify(undefined) used to throw at module load.
    // Extend the util shim with a few more entries that Node-only
    // npm packages (e.g. `debug`) read at module load.
    "__openbuddyFac.deprecate=function(fn){return function(){return fn.apply(this,arguments);};};",
    "__openbuddyFac.format=function(){return '';};",
    "__openbuddyFac.inspect=function(){return '';};",
    "__openbuddyFac.debuglog=function(){return function(){};};",
    "__openbuddyFac.isDeepStrictEqual=function(){return false;};",
    // node:tty — `debug@4` calls `tty.isatty(fd)` at module load
    // via `require('tty')`. Renderer never has a real tty.
    "__openbuddyFac.isatty=function(){return false;};",
    "__openbuddyFac.setRawMode=function(){};",
    // node:diagnostics_channel — undici/fetch load this at module
    // load. The renderer never subscribes; provide a no-op.
    "__openbuddyFac.channel=function(name){return{name:name,subscribe:function(){return function(){};},publish:function(){},unsubscribe:function(){}};};",
    "__openbuddyFac.hasSubscribers=function(){return false;};",
    "__openbuddyFac.subscribe=function(){return function(){};};",
    "__openbuddyFac.unsubscribe=function(){};",
    // node:http2 — undici's `client-h2.js` does
    //   `var { constants: { HTTP2_HEADER_AUTHORITY, ... } } = http2;`
    // where `http2 = require___vite_browser_external()`. Without a
    // `constants` property the destructure crashes with
    // `Cannot read properties of undefined (reading
    // 'HTTP2_HEADER_AUTHORITY')` — second reason the renderer
    // ended up showing white. Expose `constants` as an empty
    // object so the destructure evaluates; the HTTP/2 path is
    // never executed in the renderer.
    "__openbuddyFac.constants={};",
    "__openbuddyFac.Http2ServerRequest=function(){};",
    "__openbuddyFac.Http2ServerResponse=function(){};",
    "__openbuddyFac.createServer=function(){return{on:function(){},listen:function(){}};};",
    "__openbuddyFac.createSecureServer=function(){return{on:function(){},listen:function(){}};};",
    "__openbuddyFac.connect=function(){return{on:function(){},end:function(){},destroy:function(){}};};",
    "__openbuddyFac.constants={};",
    // node:crypto — undici's `web/fetch/data-url.js` does
    //   `const cryptoHashes = crypto.getHashes()`. Without
    //   `getHashes` on the facade, that line crashes with
    //   `crypto.getHashes is not a function` (fifth reason the
    //   renderer ended up showing white). The renderer uses
    //   `window.crypto.subtle` for hashing; the Node-side API
    //   here only needs to NOT throw. Report a static set of
    //   algorithm names so SRI / hash detection logic in undici
    //   treats them as supported.
    "var __openbuddyCryptoHashes=['sha256','sha384','sha512','sha1','md5','sha224','sha3-256','sha3-384','sha3-512'];",
    "function __openbuddyHash(){this._buf=[];}",
    "__openbuddyHash.prototype.update=function(d){return this;};",
    "__openbuddyHash.prototype.digest=function(){return {};};",
    "__openbuddyHash.prototype.copy=function(){return new __openbuddyHash();};",
    "__openbuddyFac.getHashes=function(){return __openbuddyCryptoHashes.slice();};",
    // node:worker_threads — undici's `web/webidl/index.js` requires
    // `markAsUncloneable` from the facade. Provide a noop so the
    // destructure evaluates; the renderer never spawns a real
    // worker thread.
    "__openbuddyFac.markAsUncloneable=function(){};",
    "__openbuddyFac.isMarkedAsUncloneable=function(){return false;};",
    "__openbuddyFac.isClonable=function(){return true;};",
    "__openbuddyFac.getCiphers=function(){return [];};",
    "__openbuddyFac.getCurves=function(){return [];};",
    "__openbuddyFac.createHash=function(){return new __openbuddyHash();};",
    "__openbuddyFac.createHmac=function(){return new __openbuddyHash();};",
    "__openbuddyFac.randomBytes=function(){return new Uint8Array(0);};",
    "__openbuddyFac.randomUUID=function(){return '00000000-0000-0000-0000-000000000000';};",
    "__openbuddyFac.constants={};",
    // node:async_hooks — undici's `api/api-request.js` does
    //   `class RequestHandler extends AsyncResource {}`. Without
    //   an `AsyncResource` export on the facade, the `extends`
    //   clause crashes with `Class extends value undefined is not
    //   a constructor or null` (fourth reason the renderer ended
    //   up showing white). The renderer's fetch path never actually
    //   uses Node's async resource tracking — provide a noop class
    //   so the destructure + `super("UNDICI_REQUEST")` call evaluates
    //   without crashing.
    "function __openbuddyAsyncResource(){this._id=0;}",
    "__openbuddyAsyncResource.prototype.runInAsyncScope=function(fn){if(typeof fn==='function')fn();};",
    "__openbuddyAsyncResource.prototype.emitDestroy=function(){};",
    "__openbuddyAsyncResource.prototype.asyncId=function(){return 0;};",
    "__openbuddyAsyncResource.prototype.triggerAsyncId=function(){return 0;};",
    "__openbuddyAsyncResource.prototype.bind=function(fn){return fn;};",
    "__openbuddyAsyncResource.prototype[Symbol.toStringTag]='AsyncResource';",
    "__openbuddyFac.AsyncResource=__openbuddyAsyncResource;",
    "__openbuddyFac.createHook=function(){return{};};",
    "__openbuddyFac.executionAsyncId=function(){return 0;};",
    "__openbuddyFac.executionAsyncResource=function(){return{kAsyncId:0};};",
    "__openbuddyFac.triggerAsyncId=function(){return 0;};",
    // node:stream — undici's `web/fetch/body.js` does
    //   `var { Readable } = require___vite_browser_external()`,
    //   then `class BodyReadable extends Readable {}`. Without a
    //   stream class on the facade, the `extends` clause crashes with
    //   `Class extends value undefined is not a constructor or
    //   null` (third reason the renderer ended up showing white).
    // Provide a no-op Readable / Writable / Duplex / Transform /
    // PassThrough hierarchy so the destructure evaluates; the
    // renderer never actually streams bytes through Node's
    // stream machinery — fetch responses are decoded by the
    // browser-side Fetch API instead.
    "function __openbuddyNoopStream(){}",
    "function __openbuddyReadable(){this._listeners=[];this._state={};}",
    "__openbuddyReadable.prototype.on=function(){return this;};",
    "__openbuddyReadable.prototype.once=function(){return this;};",
    "__openbuddyReadable.prototype.off=function(){return this;};",
    "__openbuddyReadable.prototype.emit=function(){return false;};",
    "__openbuddyReadable.prototype.pipe=function(){return this;};",
    "__openbuddyReadable.prototype.unpipe=function(){return this;};",
    "__openbuddyReadable.prototype.read=function(){return null;};",
    "__openbuddyReadable.prototype.pause=function(){return this;};",
    "__openbuddyReadable.prototype.resume=function(){return this;};",
    "__openbuddyReadable.prototype.destroy=function(){return this;};",
    "__openbuddyReadable.prototype.pause=function(){return this;};",
    "__openbuddyReadable.prototype.isPaused=function(){return false;};",
    "__openbuddyReadable.prototype.setEncoding=function(){return this;};",
    "__openbuddyReadable.prototype.unshift=function(){return undefined;};",
    "__openbuddyReadable.prototype.wrap=function(){return this;};",
    "__openbuddyReadable.prototype[Symbol.toStringTag]='Readable';",
    "function __openbuddyWritable(){this._listeners=[];this._state={};}",
    "__openbuddyWritable.prototype.on=function(){return this;};",
    "__openbuddyWritable.prototype.once=function(){return this;};",
    "__openbuddyWritable.prototype.off=function(){return this;};",
    "__openbuddyWritable.prototype.emit=function(){return false;};",
    "__openbuddyWritable.prototype.write=function(cb){if(typeof cb==='function')cb();return true;};",
    "__openbuddyWritable.prototype.end=function(cb){if(typeof cb==='function')cb();return this;};",
    "__openbuddyWritable.prototype.destroy=function(){return this;};",
    "__openbuddyWritable.prototype.cork=function(cb){if(typeof cb==='function')cb();return undefined;};",
    "__openbuddyWritable.prototype.uncork=function(){return undefined;};",
    "__openbuddyWritable.prototype.setDefaultEncoding=function(){return this;};",
    "__openbuddyWritable.prototype[Symbol.toStringTag]='Writable';",
    "function __openbuddyDuplex(){}",
    "__openbuddyDuplex.prototype=Object.create(__openbuddyReadable.prototype);",
    "var __openbuddyTransform=__openbuddyDuplex;",
    "var __openbuddyPassThrough=__openbuddyDuplex;",
    "__openbuddyFac.Readable=__openbuddyReadable;",
    "__openbuddyFac.Writable=__openbuddyWritable;",
    "__openbuddyFac.Duplex=__openbuddyDuplex;",
    "__openbuddyFac.Transform=__openbuddyTransform;",
    "__openbuddyFac.PassThrough=__openbuddyPassThrough;",
    "__openbuddyFac.Stream=__openbuddyReadable;",
    "__openbuddyFac.pipeline=function(){return Promise.resolve();};",
    "__openbuddyFac.finished=function(){return Promise.resolve();};",
    "__openbuddyFac.addAbortListener=function(){return function(){};};",
    "__openbuddyFac.removeAbortListener=function(){};",
    "__openbuddyFac.getDefaultHighWaterMark=function(){return 65536;};",
    "__openbuddyFac.setDefaultHighWaterMark=function(){};",
    "__openbuddyFac.isDisturbed=function(){return false;};",
    "__openbuddyFac.isReadable=function(){return true;};",
    "__openbuddyFac.isWritable=function(){return true;};",
    "__openbuddyFac.isDuplex=function(){return false;};",
    "__openbuddyFac.isTransform=function(){return false;};",
    "__openbuddyFac.isReadableNodeStream=function(){return false;};",
    "__openbuddyFac.isWritableNodeStream=function(){return false;};",
    "__openbuddyFac.constants={};",
    "__openbuddyFac.platform=function(){return 'darwin';};",
    "__openbuddyFac.cpus=function(){return [];};",
    // node:fs / node:fs/promises — return noop fs. Renderer
    // never actually touches the filesystem; this only needs to
    // exist so module-level `import { readFileSync } from "node:fs"`
    // doesn't crash. Return a default JSON string for `readFileSync`
    // since `JSON.parse(stripBom(readFileSync(...)))` is the typical
    // shape and would otherwise crash on `stripBom(undefined)`.
    "var __noopFs=function(){return function(){return '{}';};};",
    "var __noopFsSync=function(){return function(){return false;};};",
    "__openbuddyFac.readFileSync=__noopFs();",
    "__openbuddyFac.readFile=__noopFs();",
    "__openbuddyFac.writeFileSync=__noopFsSync();",
    "__openbuddyFac.writeFile=__noopFsSync();",
    "__openbuddyFac.existsSync=__noopFsSync();",
    "__openbuddyFac.statSync=__noopFsSync();",
    "__openbuddyFac.readdirSync=__noopFsSync();",
    "__openbuddyFac.mkdirSync=__noopFsSync();",
    "__openbuddyFac.openSync=__noopFsSync();",
    "__openbuddyFac.closeSync=__noopFsSync();",
    "__openbuddyFac.promises={readFile:__noopFs(),writeFile:__noopFsSync(),stat:__noopFsSync(),mkdir:__noopFsSync(),readdir:__noopFsSync(),cp:__noopFsSync(),rm:__noopFsSync(),rename:__noopFsSync(),realpath:__noopFs(),access:__noopFsSync()};",
    // node:child_process — make spawn/exec/execFile no-op stubs so
    // `import { execFile } from "node:child_process"` doesn't blow
    // up when the renderer accidentally evaluates a call site.
    "__openbuddyFac.execFile=__noopFs();",
    "__openbuddyFac.exec=__noopFs();",
    "__openbuddyFac.spawn=__noopFs();",
    // node:util — promisify(undefined) used to throw at module load.
    "__openbuddyFac.promisify=function(fn){if(typeof fn!=='function')return fn;return function(){return Promise.resolve(undefined);};};",
    "__openbuddyFac.types={isUint8Array:function(){return false;},isDate:function(){return false;}};",
    "if(typeof process!=='undefined'){if(typeof process.getMaxListeners!=='function'){process.getMaxListeners=function(){return 0;};process.setMaxListeners=function(){};}process.versions={};process.features={};process.argv=[];process.execPath='/';process.exit=function(){};process.getBuiltinModule=function(){return undefined;};process.version='v0.0.0';process.platform='darwin';if(!process.stderr){process.stderr={fd:1,write:function(){},_handle:{}};}if(!process.stdout){process.stdout={fd:1,write:function(){},_handle:{}};}process.stderr.fd=process.stderr.fd||1;}",
    // Make `module.exports` itself the no-op class so
    // `class X extends require___vite_browser_external() {}` works
    // (the constructor is now a valid class with a prototype).
    // All the static methods assigned to `__openbuddyFac` above
    // become available as `require___vite_browser_external().method`,
    // and `__toESM(...)` copies them through to the
    // `import_..._browser_external` namespace so consumers using
    // `import_X.Y(...)` style access keep working too.
    "var __openbuddyExports = Object.assign({default: __openbuddyFac, EventEmitter: __openbuddyFac}, __openbuddyFac);",
    "export default __openbuddyExports;",
  ].join("");
}

/**
 * Same facade body as `buildOpenBuddyExternalPatch()` but WITHOUT the
 * trailing `export default` statement. Use this when patching Vite 8
 * optimize-deps output (`.vite/deps/*.js`) — those files already carry
 * their own `export default require_X()` / `export { ... }` tail added
 * by the optimizer, so prepending a body that itself exports `default`
 * produces `SyntaxError: Identifier '.default' has already been declared`.
 */
function buildOpenBuddyDepsPatch(): string {
  return buildOpenBuddyExternalPatch().replace(/export default __openbuddyExports;/, "");
}

function nodeExternalPatch() {
  const patchBody = buildOpenBuddyExternalPatch();
  // Optimize-deps files already end with their own `export default` /
  // named `export { ... }` tail, so they need the no-export variant.
  const depsPatchBody = buildOpenBuddyDepsPatch();
  return {
    name: "openbuddy:renderer-node-external-patch",
    enforce: "pre",
    load(id: string): { code: string; map: null } | null | undefined {
      // Vite 8 renamed the browser-external shim from
      // `__vite-browser-external:` to `browser-external:`. The shim
      // returns a Proxy with no real exports, which then explodes
      // inside vite 8's `interopNamedImports` for
      // `import { x } from "node:fs/promises"` because the rewrite
      // calls `interopHelper(m.default, …)` on a value that has no
      // `default` property. Returning our own no-op facade body here
      // short-circuits vite 8's load handler so the patch always wins.
      if (id.startsWith("browser-external:") || id.startsWith("__vite-browser-external:")) {
        return { code: buildOpenBuddyExternalPatch(), map: null };
      }
      return null;
    },
    renderChunk(code: string, _chunk: unknown): { code: string; map: null } | null | undefined {
      // Patch 2 (chunk-level) — `require___vite_browser_external()`
      // is the renderer-side facade for Node built-ins. We leave it
      // untouched here; the per-module patch (Patch 1) installs the
      // required methods/properties (`.EventEmitter`, `.constants`,
      // `.Readable`, `.AsyncResource`, etc.) so every consumer in the
      // chunk sees a usable shape. We deliberately do NOT wrap the
      // call result here — wrapping `require___vite_browser_external()`
      // in `.EventEmitter || ...` causes `__toESM` to put the class
      // (not the namespace) into the `default` slot, breaking
      // `import___vite_browser_external.promisify(...)` style access.
      // Instead, every call site that needs the class imports it
      // explicitly through `.EventEmitter` and the patched module
      // already exposes that.
      return undefined;
    },
    transform(code: string, id: string): null | { code: string; map: null } | undefined {
      // Patch 1 — the `__vite_browser_external` CJS shim itself.
      if (id.includes("__vite-browser-external")) {
        return { code: patchBody, map: null };
      }
      // Patch 3 — Vite 8 optimize-deps inline Proxy facades. Each
      // prebundled module contains a `module.exports = Object.create(
      // new Proxy({}, { get(_, key) { ... } }))` per Node built-in.
      // The Proxy returns undefined for every property access, so
      // `require_browser_external_url().fileURLToPath` blows up.
      // Match that block and replace it with `module.exports =
      // __openbuddyFac`, then prepend the facade body so the symbol
      // is defined before any of the require calls run.
      if (
        id.includes(".vite/deps/") &&
        code.includes("Object.create(new Proxy({}, { get(_, key) {")
      ) {
        const replaced = code.replace(
          /module\.exports\s*=\s*Object\.create\(new Proxy\(\{\},\s*\{\s*get\(_, key\)\s*\{[\s\S]*?\}\s*\}\)\)/g,
          "module.exports=__openbuddyFac",
        );
        if (replaced !== code) {
          return { code: depsPatchBody + ";\n" + replaced, map: null };
        }
      }
      return undefined;
    },
  };
}


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
          // pino + its transport dependencies are intentionally external:
          // they're heavy native modules loaded at runtime by
          // @openbuddy/logging-main and resolving them at bundle time
          // requires the pino bundle-graph which is unstable under Vite 8.
          "pino",
          "pino-roll",
          "pino-pretty",
        ],
        output: {
          // Keep `await import(...)` boundaries as real ESM chunks. All
          // workspace TypeScript dependencies are still resolved through
          // the aliases above and compiled by Rollup, so emitted chunks do
          // not depend on Node loading `.ts` files at runtime.
          //
          // Phase F.1 — split the heaviest workspace packages into
          // dedicated chunks so cold start only loads the entry. We use
          // Rolldown's native `codeSplitting.groups[].test` regex form
          // (NOT the `output.manualChunks` function form) because
          // rolldown@1.2.7 has a bindingify bug where a function-form
          // `manualChunks` is captured as `undefined` and crashes with
          // `TypeError: manualChunks is not a function`. The regex form
          // matches module ids by file path and works under both
          // Vite 5 (Rollup) and Vite 8 (Rolldown). See
          // docs/OPENBUDDY_PI_NATIVE_PLAN.md §F.1 for the perf rationale.
          codeSplitting: {
            groups: [
              {
                name: "capability-email",
                test: /packages\/capability\/openbuddy-email\/src\//,
                priority: 30,
              },
              {
                name: "capability-calendar",
                test: /packages\/capability\/openbuddy-calendar\/src\//,
                priority: 30,
              },
              {
                name: "capability-mcp-client",
                test: /packages\/capability\/openbuddy-mcp-client\/src\//,
                priority: 30,
              },
              {
                name: "capability-authorization",
                test: /packages\/capability\/openbuddy-authorization\/src\//,
                priority: 30,
              },
              {
                name: "collaboration-coordinator",
                test: /packages\/collaboration\/openbuddy-coordinator\/src\//,
                priority: 30,
              },
              {
                name: "collaboration-policy",
                test: /packages\/collaboration\/openbuddy-policy\/src\//,
                priority: 30,
              },
              {
                name: "collaboration-task",
                test: /packages\/collaboration\/openbuddy-task\/src\//,
                priority: 30,
              },
              {
                name: "collaboration-evidence",
                test: /packages\/collaboration\/openbuddy-evidence\/src\//,
                priority: 30,
              },
              {
                name: "collaboration-room",
                test: /packages\/collaboration\/openbuddy-room\/src\//,
                priority: 30,
              },
              {
                name: "collaboration-inbox",
                test: /packages\/collaboration\/openbuddy-inbox\/src\//,
                priority: 30,
              },
              {
                name: "collaboration-network",
                test: /packages\/collaboration\/openbuddy-network\/src\//,
                priority: 30,
              },
              {
                name: "auth-casdoor",
                test: /packages\/auth\/openbuddy-casdoor\/src\//,
                priority: 30,
              },
              {
                name: "auth-permission",
                test: /packages\/auth\/openbuddy-permission\/src\//,
                priority: 30,
              },
              {
                name: "fs-fs-local",
                test: /packages\/fs\/openbuddy-fs-local\/src\//,
                priority: 30,
              },
              {
                name: "team-team",
                test: /packages\/team\/openbuddy-team\/src\//,
                priority: 30,
              },
              {
                name: "logging-main",
                test: /packages\/core\/openbuddy-logging-main\/src\//,
                priority: 30,
              },
              {
                name: "dsh-core",
                test: /packages\/runtime\/openbuddy-dsh-core\/src\//,
                priority: 30,
              },
              {
                name: "plugin-host",
                test: /packages\/runtime\/openbuddy-plugin-host\/src\//,
                priority: 30,
              },
              {
                name: "bundle-base",
                test: /packages\/bundle\/openbuddy-base\/src\//,
                priority: 30,
              },
              {
                name: "pi-bridge",
                test: /electron\/main\/agent\/pi-bridge\//,
                priority: 30,
              },
              {
                name: "storage",
                test: /packages\/runtime\/openbuddy-storage\/src\//,
                priority: 30,
              },
            ],
          },
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
          // Phase F.1 — same migration as the main config. Use
          // `codeSplitting.groups[].test` regex form instead of the
          // `manualChunks` object form because rolldown@1.2.7 has the
          // same bindingify bug for the renderer's manualChunks object.
          // Module-name matching is replaced with module-path regex
          // matching; semantically equivalent for our use case.
          codeSplitting: {
            groups: [
              {
                name: "markdown",
                test: (id: string) =>
                  /node_modules\/(react-markdown|remark-gfm|remark-breaks|remark-math|rehype-highlight|rehype-sanitize|lowlight)(\/|$)/.test(id),
                priority: 30,
              },
              {
                name: "katex",
                test: (id: string) =>
                  /node_modules\/(katex|rehype-katex)(\/|$)/.test(id),
                priority: 30,
              },
              {
                name: "mermaid",
                test: (id: string) => /node_modules\/mermaid(\/|$)/.test(id),
                priority: 30,
              },
            ],
          },
        },
      },
    },
    resolve: {
      alias: rendererOnlyAliases,
    },
    // Node-only surface is shimmed at runtime by `./renderer-node-shim.ts`,
    // imported first from `src/main.tsx`. Doing it as a real import
    // (rather than Vite `define` strings) lets the polyfill reach
    // Vite's internal `__vite_browser_external__` polyfill object
    // directly, which `process.platform`, `global`, and `fileURLToPath`
    // look up against. `define` strings only replace top-level
    // identifiers and don't reach that object.
    plugins: [react(), nodeExternalPatch()],
    server: {
      // Electron main reads ELECTRON_RENDERER_URL (set automatically by
      // electron-vite). The port here must match the Vite dev port the main
      // process loads. If the preferred port is busy, Vite selects the next
      // available port and electron-vite updates ELECTRON_RENDERER_URL.
      port: 1420,
      strictPort: false,
      host: "0.0.0.0",
    },
    // Phase UX-perf: dev cold-start was blocked on Vite crawling the heavy
    // workspace alias graph. `@openbuddy/*` aliases point at `.ts` sources
    // (NOT prebundled npm packages), so esbuild's dep crawler would either
    // stall or rewrite them away. Mark the workspace aliases as
    // non-prebundlable and explicitly enumerate the heavy npm dependencies
    // that DO benefit from prebundling (katex/mermaid/markdown/univerjs).
    //
    // A1 fix: holdUntilCrawled previously waited for an esbuild dep-scan
    // graph that Vite 8.3.0 cannot produce (path.at / str.replace / Failed
    // to resolve dependency: date-fns, dompurify, nanoid). Disabling the
    // flag lets the renderer proceed even when prebundling skips; Vite
    // serves deps on-the-fly. date-fns / dompurify / nanoid are removed
    // from `include` because esbuild's scanner consistently fails them
    // here; runtime still resolves them via the workspace alias graph.
    optimizeDeps: {
      holdUntilCrawled: false,
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react-router-dom",
        "zustand",
        "react-markdown",
        "remark-gfm",
        "remark-breaks",
        "remark-math",
        "rehype-highlight",
        "rehype-katex",
        "rehype-sanitize",
        "lowlight",
        "highlight.js",
        "katex",
        "mermaid",
        "lucide-react",
        "grok-mermaid",
        "diff",
      ],
      exclude: [
        // Workspace packages are aliased to `.ts` source — esbuild cannot
        // prebundle them. Vite's normal module resolver handles them.
        // NOTE: `optimizeDeps.exclude` must be string globs in Vite 8.
        // Passing a RegExp crashes `rolldownCjsExternalPlugin` with
        // `str.replace is not a function` because it tries to call
        // `escapeRegex(item)` on every entry. Workspace aliases are
        // matched via their literal name + the `@openbuddy` /
        // `@earendil-works` scope prefix patterns below.
        "@openbuddy/electron-api",
        "@openbuddy/*",
        "@earendil-works/*",
        // Optional native dep that fails to load in dev. Consumed only by
        // mermaid/grok-mermaid; the runtime paths fall back gracefully.
        "@napi-rs/canvas",
      ],
    },
  },
});
