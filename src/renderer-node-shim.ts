/**
 * Renderer-side Node polyfill.
 *
 * Vite's `__vite_browser_external` polyfill provides a browser-shaped
 * facade over Node built-ins, but the surface is too thin for code that
 * was originally written for Node:
 *   - `fileURLToPath` is not a function on the polyfill
 *   - `process.platform`, `process.cwd`, `process.homedir`, etc. are
 *     all `undefined` and crash any module-level access
 *   - `global` is not aliased to `globalThis`
 *   - `Buffer` is not defined (undici's `client.js` does
 *     `var EMPTY_BUF = Buffer.alloc(0)` at module load — crashes
 *     with `ReferenceError: Buffer is not defined`)
 *
 * Those crashes used to take down the entire renderer the moment the
 * bundle evaluated `@openbuddy/plugin-host` (which transitively pulls
 * in `pi-coding-agent` → `which` → `cross-spawn`). Importing this
 * module FIRST in `src/main.tsx` patches the polyfill before any
 * heavy module evaluates.
 *
 * Everything here is a no-op for the renderer — the renderer never
 * shells out, never reads `process.platform`, never resolves file URLs,
 * never actually allocates a Buffer. The goal is to keep the
 * renderer-side evaluation of Node-only packages from crashing before
 * the preload bridge takes over.
 *
 * Note: the inline script in `index.html` installs a parallel JS-only
 * shim that runs BEFORE this module evaluates, since undici's
 * `client.js` is reached via lazy `__commonJSMin` evaluation chains
 * that start as soon as any other module touches `fetch`. The inline
 * shim is what makes `Buffer.alloc(0)` etc. survive the initial pass;
 * this file keeps the TS-side mirror in sync so the rest of the
 * renderer's code (which imports through bundler resolution, not the
 * inline script) sees a consistent `globalThis`.
 */

const viteExternal = (globalThis as unknown as { __vite_browser_external__?: Record<string, unknown> }).__vite_browser_external__;
if (viteExternal) {
  // fileURLToPath / pathToFileURL — return empty strings; the renderer
  // never needs the resolved path.
  if (typeof viteExternal.fileURLToPath !== "function") {
    viteExternal.fileURLToPath = (): string => "";
  }
  if (typeof viteExternal.pathToFileURL !== "function") {
    viteExternal.pathToFileURL = (path: string): string => `file://${path ?? ""}`;
  }
  // `createRequire` — return a noop require. Anything the polyfilled
  // module asks for would have been bundled in by Vite anyway.
  if (typeof viteExternal.createRequire !== "function") {
    viteExternal.createRequire = () => (id: string): unknown => {
      if (id === "node:events") {
        return { EventEmitter: class EventEmitter {} };
      }
      return undefined;
    };
  }
}

// `global` alias used by `which.js` and a handful of older Node polyfills.
if (typeof (globalThis as Record<string, unknown>).global === "undefined") {
  (globalThis as Record<string, unknown>).global = globalThis;
}

// `process` shim — covers the most common module-level reads. Each
// method returns a sensible default so module-level expressions like
// `if (process.env.NODE_ENV === 'production')` evaluate cleanly.
if (typeof (globalThis as Record<string, unknown>).process === "undefined") {
  (globalThis as Record<string, unknown>).process = {
    env: {} as Record<string, string | undefined>,
    platform: "darwin",
    pid: 0,
    cwd: (): string => "/",
    homedir: (): string => "/",
    getMaxListeners: (): number => 0,
    setMaxListeners: (): void => undefined,
  };
}

// `Buffer` shim — undici's `client.js` reads `Buffer.alloc(0)` and
// `Buffer[Symbol.species]` at module load. The inline `<script>` in
// `index.html` already installed a working Buffer on `globalThis`; we
// only need to make sure it survives the bundler boundary. A full
// `Buffer` polyfill would balloon the bundle; the minimal facade
// below lets `Buffer.alloc(n).length === n` and
// `Buffer.isBuffer(x) === false`, which is enough for undici's
// module-load destructure to evaluate. Real byte decoding is done
// by `window.crypto.subtle` on the renderer side, not via Node Buffer.
const g = globalThis as Record<string, unknown>;
if (typeof g.Buffer === "undefined") {
  const emptyBuf = (len: number): unknown => {
    const u8 = new Uint8Array(len);
    const wrap: Record<string, unknown> = u8 as unknown as Record<string, unknown>;
    wrap.toString = (): string => "";
    wrap.write = (): number => 0;
    wrap.slice = (s?: number, e?: number): unknown => emptyBuf((e ?? len) - (s ?? 0));
    wrap.copy = (): number => 0;
    wrap.fill = (): unknown => wrap;
    wrap.equals = (): boolean => false;
    wrap.compare = (): number => 0;
    wrap.indexOf = (): number => -1;
    wrap.includes = (): boolean => false;
    wrap.readUInt32BE = (): number => 0;
    wrap.writeUInt32BE = (): number => 4;
    return wrap;
  };
  const BufferCtor = function Buffer(this: unknown, arg: unknown): unknown {
    if (typeof arg === "number") return emptyBuf(arg);
    if (ArrayBuffer.isView(arg as ArrayBufferLike)) return emptyBuf((arg as { length: number }).length);
    return emptyBuf(0);
  } as unknown as Record<string, unknown>;
  BufferCtor.from = (): unknown => emptyBuf(0);
  BufferCtor.alloc = (n: number): unknown => emptyBuf(n);
  BufferCtor.allocUnsafe = (n: number): unknown => emptyBuf(n);
  BufferCtor.allocUnsafeSlow = (n: number): unknown => emptyBuf(n);
  BufferCtor.isBuffer = (): boolean => false;
  BufferCtor.isAscii = (): boolean => true;
  BufferCtor.byteLength = (input: unknown): number => {
    if (typeof input === "string") return (input as string).length;
    if (ArrayBuffer.isView(input as ArrayBufferLike)) return (input as { length: number }).length;
    return 0;
  };
  BufferCtor.concat = (list: ArrayLike<unknown>): unknown => emptyBuf(list.length);
  BufferCtor.compare = (): number => 0;
  // `Buffer[Symbol.species]` is what undici reads at module load —
  // provide a self-reference so the destructure evaluates.
  (BufferCtor as unknown as Record<symbol, unknown>)[Symbol.species] = BufferCtor;
  g.Buffer = BufferCtor;
}

export {};
