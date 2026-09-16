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
// NOTE — this file is duplicated on purpose. Ambient declarations only apply
// to the TypeScript program that `include`s them, and each of these projects
// compiles a different program:
//   - src/lucide-icons.d.ts                                        (renderer app)
//   - packages/ui/openbuddy-ui-conversation/src/lucide-icons.d.ts  (ui-conversation)
//   - packages/ui/openbuddy-ui-markdown/src/lucide-icons.d.ts      (ui-markdown)
// Keep the three copies in sync.
declare module "lucide-react/dist/esm/icons/*" {
  import type { LucideIcon } from "lucide-react";

  const Icon: LucideIcon;

  export default Icon;
}
