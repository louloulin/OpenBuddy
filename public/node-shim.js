/**
 * node-shim.js — R4.3 Node polyfill shim(自 index.html 内联外置)。
 *
 * 必须以 classic script、在 module script(main.tsx)之前同步运行,给渲染层
 * 一个 `process` / `global` facade 与可用的 fileURLToPath/createRequire shim,
 * 让 @openbuddy/plugin-host(pi-coding-agent → which → cross-spawn)求值不炸。
 * CSP(P0.3,2026-10-19)要求 script-src 不含 unsafe-inline —— 内联脚本会被拦,
 * 因此外置为 public/node-shim.js('self'/file: 覆盖)。
 * 值对渲染层均为 no-op:渲染层不 shell out、不解析文件 URL。
 */
      (function () {
        var g = globalThis;
        if (typeof g.global === "undefined") g.global = g;
        if (typeof g.process === "undefined") {
          g.process = {
            env: {},
            platform: "darwin",
            pid: 0,
            cwd: function () { return "/"; },
            homedir: function () { return "/"; },
            getMaxListeners: function () { return 0; },
            setMaxListeners: function () {},
          };
        }
        if (typeof g.Buffer === "undefined") {
          // Minimal Uint8Array-backed Buffer shim. undici's `client.js`
          // does `var EMPTY_BUF = Buffer.alloc(0)` and
          // `var FastBuffer = Buffer[Symbol.species]` at module load
          // — without this shim the renderer crashes with
          // `ReferenceError: Buffer is not defined` before React mounts,
          // which is the actual reason the page ended up showing white.
          // Renderer never decodes bytes — the preload bridge hands
          // strings — so the empty-buffer default is safe.
          function makeBuf(len) {
            var u8 = new Uint8Array(len);
            u8.toString = function () { return ""; };
            u8.write = function () { return 0; };
            u8.slice = function (s, e) { return makeBuf((e == null ? u8.length : e) - (s || 0)); };
            u8.copy = function () { return 0; };
            u8.fill = function () { return u8; };
            u8.equals = function () { return false; };
            u8.compare = function () { return 0; };
            u8.indexOf = function () { return -1; };
            u8.includes = function () { return false; };
            u8.readUInt32BE = function () { return 0; };
            u8.writeUInt32BE = function () { return 4; };
            return u8;
          }
          var BufferCtor = function Buffer(arg) {
            if (arg == null) return makeBuf(0);
            if (typeof arg === "number") return makeBuf(arg);
            if (ArrayBuffer.isView(arg)) return makeBuf(arg.length);
            return makeBuf(0);
          };
          BufferCtor.from = function () { return makeBuf(0); };
          BufferCtor.alloc = function (n) { return makeBuf(n); };
          BufferCtor.allocUnsafe = function (n) { return makeBuf(n); };
          BufferCtor.allocUnsafeSlow = function (n) { return makeBuf(n); };
          BufferCtor.isBuffer = function () { return false; };
          BufferCtor.isAscii = function () { return true; };
          BufferCtor.byteLength = function (input) {
            if (typeof input === "string") return input.length;
            if (ArrayBuffer.isView(input)) return input.length;
            return 0;
          };
          BufferCtor.concat = function (list) { return makeBuf(list.length); };
          BufferCtor.compare = function () { return 0; };
          BufferCtor.Symbol = { species: Symbol("Buffer.species") };
          BufferCtor[Symbol.species] = BufferCtor;
          g.Buffer = BufferCtor;
        }
        // Vite injects `__vite_browser_external__` as a Node-built-in
        // facade; patch missing entries before modules evaluate.
        var ext = g.__vite_browser_external__;
        if (ext) {
          if (typeof ext.fileURLToPath !== "function") ext.fileURLToPath = function () { return ""; };
          if (typeof ext.pathToFileURL !== "function") ext.pathToFileURL = function (p) { return "file://" + (p || ""); };
          if (typeof ext.createRequire !== "function") ext.createRequire = function () { return function (id) { if (id === "node:events") return { EventEmitter: function () {} }; return undefined; }; };
          // undici's `client-h2.js` does
          //   `var { constants: { HTTP2_HEADER_AUTHORITY, ... } } = http2;`
          // where `http2 = require___vite_browser_external()`. The default
          // facade doesn't expose `constants`, so the destructure crashes
          // with `Cannot read properties of undefined (reading
          // 'HTTP2_HEADER_AUTHORITY')` — the second reason the renderer
          // ended up showing white. Patch the facade so missing keys return
          // empty objects; the H2 path is never reached in the renderer
          // (no real socket layer) but the destructure has to evaluate.
          var SHIM = {
            constants: {},
            EventEmitter: function () {},
            createRequire: function () { return function () { return undefined; }; },
            fileURLToPath: function () { return ""; },
            pathToFileURL: function (p) { return new URL("file://" + (p || "")); },
            platform: function () { return "darwin"; },
            tmpdir: function () { return "/"; },
            homedir: function () { return "/"; },
            cpus: function () { return []; },
            env: {},
            cwd: function () { return "/"; },
            isatty: function () { return false; },
            setRawMode: function () {},
            promisify: function (fn) { return function () { return Promise.resolve(undefined); }; },
            types: { isUint8Array: function () { return false; }, isDate: function () { return false; } },
            deprecate: function (fn) { return fn; },
            format: function () { return ""; },
            inspect: function () { return ""; },
            debuglog: function () { return function () {}; },
            isDeepStrictEqual: function () { return false; },
            channel: function (name) { return { name: name, subscribe: function () { return function () {}; }, publish: function () {}, unsubscribe: function () {} }; },
            hasSubscribers: function () { return false; },
            subscribe: function () { return function () {}; },
            unsubscribe: function () {},
            channel$1: undefined,
            getMaxListeners: function () { return 0; },
            setMaxListeners: function () {},
            Buffer: g.Buffer,
            dirname: function () { return "/"; },
            basename: function () { return ""; },
            extname: function () { return ""; },
            join: function () { return "/"; },
            resolve: function () { return "/"; },
            isAbsolute: function () { return true; }
          };
          // Wrap __vite_browser_external accessor so every missing key
          // resolves to the SHIM rather than `undefined`. This catches
          // the `http2.constants` and similar missing-prop destructure
          // sites in undici that previously crashed the renderer.
          if (!ext.__patched) {
            for (var key in SHIM) {
              if (typeof ext[key] === "undefined") {
                try { ext[key] = SHIM[key]; } catch (_) {}
              }
            }
            ext.__patched = true;
          }
        }
      })();
