/// <reference types="vite/client" />

/**
 * Vite env typing — provides ImportMetaEnv so the package can read
 * VITE_* vars via `import.meta.env`. We don't enumerate every var
 * (Vite's `vite/client` already gives `string | undefined` for all
 * `import.meta.env.<key>` reads), but the reference is enough to make
 * `import.meta.env` non-erroring in `tsc --noEmit`.
 *
 * The package falls back to `window.__OPENBUDDY_*` then a hard-coded
 * default in `question-store.ts` and `permission-store.ts` — see those
 * files for the runtime contract.
 */
