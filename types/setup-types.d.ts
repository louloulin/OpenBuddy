// Type-only side-effect import shared by every package that extends
// tsconfig.package-base.json. See ./ambient.d.ts for why this cannot live in
// the same file as the `declare module` blocks.
//
// Importing `@testing-library/jest-dom/vitest` is what augments vitest's
// `Assertion` interface with the jest-dom matchers (`toBeInTheDocument`, ...).
// The matchers are registered at RUNTIME by src/test-setup.ts, which a
// per-package `tsc --noEmit` never loads, so without this import every package
// containing a `toBeInTheDocument()` assertion failed to typecheck — which is
// why 33 `ui-*` packages shipped with no moon.yml and were never typechecked in
// CI at all.
//
// A `/// <reference types="@testing-library/jest-dom" />` does NOT work here:
// `types` entries resolve against @types/*, and this package ships its own
// bundled types rather than living under @types.
import "@testing-library/jest-dom/vitest";
