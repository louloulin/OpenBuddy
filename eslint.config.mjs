// @ts-check
/**
 * ESLint flat config for OpenBuddy.
 *
 * A-6 in the ts-error-architecture-overhaul change.
 *
 * Design notes:
 *   - Uses ESLint 9 flat config (eslint.config.mjs) and the
 *     typescript-eslint v8 plugin (typed lint rules).
 *   - Rules are introduced in "warn" mode first to surface the current
 *     state of the codebase without breaking CI. Promoting individual
 *     rules to "error" is tracked per-item in the change plan.
 *   - Project-specific boundaries (no `@/` reverse-dep, no cross-package
 *     import of `electron/*` from `packages/`) are enforced by Sheriff —
 *     see `sheriff.config.ts`. ESLint handles style + correctness.
 *   - `.worktrees/`, `node_modules/`, `out/`, `dist/` are ignored.
 */
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import sheriff from "@softarc/eslint-plugin-sheriff";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**",
      "**/.worktrees/**",
      "**/build/**",
      "apps/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
      sheriff,
    },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true, project: ["./tsconfig.json", "./electron/tsconfig.json"] },
        node: { extensions: [".js", ".ts", ".tsx"] },
      },
    },
    rules: {
      // ── typescript-eslint ──
      "@typescript-eslint/no-explicit-any": "warn", // tracked in B-17: warn → error
      "@typescript-eslint/no-non-null-assertion": "warn", // tracked in B-17
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-misused-promises": "off", // too noisy for fire-and-forget patterns
      "@typescript-eslint/ban-ts-comment": "off", // opt-in per item
      // ── import ──
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-cycle": ["warn", { maxDepth: 5 }],
      "import/no-self-import": "error",
      "import/no-useless-path-segments": "warn",
      // ── sheriff (module boundaries) ──
      // See sheriff.config.ts. Phase J.1 (v6 §26.4) promotes specific tag
      // pairs to "error" once the v6 §3.4 layer model stabilizes. The
      // three rules below are the ones shipped by @softarc/eslint-plugin-
      // sheriff@0.19.6 (rule names renamed from earlier 0.15.x releases):
      //   - dependency-rule : assert depRules (UI ↔ core, microkernel ↔ plugin)
      //   - deep-import     : assert public-surface only (no skipping index.ts)
      //   - encapsulation   : assert tag isolation (no reverse-deps)
      //
      // J.1 follow-up (2026-09): baseline `pnpm storage:boundaries`
      // reports 0 reverse-dep violations across 403 files, so the three
      // rules are *ready* for `warn -> error` promotion. We keep them at
      // `warn` for now because Sheriff 0.19.6 has a path-resolution quirk
      // for `./../packages/...` aliases in `electron/tsconfig.json` that
      // yields 3 false-positive SH-001 errors unrelated to the layer model.
      // Promote after the path alias is normalised (J.1.1 follow-up).
      "sheriff/dependency-rule": "warn",
      "sheriff/deep-import": "warn",
      "sheriff/encapsulation": "warn",
    },
  },
  {
    files: ["**/*.mjs", "**/*.cjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // test stubs routinely need any
      "@typescript-eslint/no-non-null-assertion": "off", // test assertions often !-narrow
    },
  },
];
