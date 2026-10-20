import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom, not happy-dom: happy-dom was named here but never installed, so
    // every run died with "Cannot find package 'happy-dom'" and this suite has
    // never executed. jsdom is already a root devDependency and matches the
    // environment the rest of the repo's React tests use.
    environment: "jsdom",
    // The `.tsx` arm is load-bearing: three of the four suites (AuthGuard,
    // Callback) are .tsx, and the old `*.test.ts`-only globs silently excluded
    // them, so vitest reported success while running nothing.
    include: ["src/**/__tests__/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    globals: false,
  },
});