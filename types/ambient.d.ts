// Ambient module declarations shared by every package that extends
// tsconfig.package-base.json.
//
// This file MUST stay a *script* (no top-level `import`/`export`). A top-level
// import turns the file into a module, and `declare module "x"` inside a module
// is a module AUGMENTATION — which silently does nothing when the target module
// does not already exist. The jest-dom side effect that needs an `import` lives
// in ./setup-types.ts, which is pulled in via `files` alongside this file.
//
// Wired in via `files` (not `include`) in tsconfig.package-base.json, because
// every package overrides `include` with its own src glob — `files` is merged
// across the extends chain, `include` is replaced.
//
// Prefer adding package-wide ambient declarations HERE rather than a per-package
// `src/*.d.ts` copy: a declaration inside one package's `src/` is invisible to
// every other package's compilation, which is how the divergent copies of the
// lucide workaround below came to exist.

/// <reference types="vite/client" />

// Ambient declaration so per-icon deep imports
// (`lucide-react/dist/esm/icons/<name>`) type-check.
//
// lucide-react only ships type definitions for the barrel entry
// (`dist/lucide-react.d.ts`). The deep `dist/esm/icons/*` modules ship nothing
// but `.mjs` files, and the package has no `exports`/`typesVersions` map, so
// TypeScript reports TS2307 ("Cannot find module") for every per-icon import
// even though the bundler resolves it fine at runtime.
//
// A *wildcard* module declaration keeps this drift-free: adding a new
// per-icon import does not require editing a per-icon allow-list (which is
// what made the previous, enumerated version of this file go stale). The deep
// module's default export is the same component type the barrel exports.
//
// This replaces the three per-package copies that used to exist
// (src/, ui-conversation/, ui-markdown/); they drifted because a declaration is
// only visible to the program that includes it. The renderer app's copy
// (src/lucide-icons.d.ts) is still needed — the root tsconfig.json does not
// extend the package base.
declare module "lucide-react/dist/esm/icons/*" {
  import type { LucideIcon } from "lucide-react";

  const Icon: LucideIcon;

  export default Icon;
}
