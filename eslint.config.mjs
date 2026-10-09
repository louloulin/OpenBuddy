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
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/out/**",
      "**/dist/**",
      "**/.worktrees/**",
      "**/build/**",
      "apps/**",
      // `scripts/**/_*.mjs` 是一次性调试探针(含 JSX/残缺语法,本身跑不起来),
      // 计划在结构债清理阶段整体归档;在此之前不参与 lint。
      "scripts/**/_*.mjs",
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
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      react,
    },
    settings: {
      react: { version: "18.3" },
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
      // ── react hooks ──
      // 2026-10-07: 这三个插件此前未安装,12+3 处 `eslint-disable
      // react-hooks/exhaustive-deps` / `jsx-a11y/*` / `react/no-danger`
      // 指向未注册规则 —— eslint 报 "rule not found",且检查从未真正运行。
      // 注册后这些 disable 才会生效(否则它们只是在掩盖一个不存在的规则)。
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "jsx-a11y/media-has-caption": "warn",
      "react/no-danger": "warn",
      // ── jsx-a11y ──
      // 2026-10-07:此前只开了 media-has-caption 一条,`jsx-a11y/*` 的
      // eslint-disable 注释因此指向一个几乎不存在的规则集 —— 无障碍实际上
      // 完全没人管。存量已按下面两条策略逐个查证并修完,这里直接把
      // recommended 全量打开为 error,新代码不得再引入键盘不可达的假按钮。
      ...jsxA11y.flatConfigs.recommended.rules,
      // 关闭理由(逐个查证过全部 15 处,不是"太吵就关掉"):该规则针对的是
      // **页面加载时**抢走焦点。本仓库的 autoFocus 全部挂在条件渲染的子视图
      // 上 —— 抽屉展开后才出现的 textarea、点"添加来源"才挂载的 input、
      // 对话框的首个按钮。焦点落在这些位置是**用户刚刚自己触发的结果**,直接
      // 往正在看的界面里打字才是期望行为。真正要防的是 App 一启动就把光标
      // 塞进一个用户没要求的输入框;那种写法不在本仓库出现。
      "jsx-a11y/no-autofocus": "off",
      // no-noninteractive-tabindex:规则把 `separator` 硬编码成非交互元素,不给
      // "带 aria-valuenow 的可聚焦 separator"开口。但那正是 WAI-ARIA 的
      // **Window Splitter** 规范形态 —— 可拖拽分隔条必须可聚焦、必须能被方向键
      // 操作,否则纯键盘用户根本没法调宽度。仓库里 Resizable 的把手就是照这个
      // 做的,Resizable.test.tsx 明确断言 getByRole("separator") + aria-valuenow,
      // 键盘路径(方向键 8px / Shift 32px、Home/End 到端点)已实现且有测试。
      // 按 role 精确放行 separator,不整体关掉这条规则。
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { tags: [], roles: ["separator"], allowExpressionValues: true },
      ],
      // ul/ol 的 role="list" 在 list-style:none 时**不是**冗余。Safari/VoiceOver
      // 会因为 list-style:none 丢掉整个列表语义,读屏不再播报"列表,共 N 项";
      // 显式写回 role="list" 是 Apple 自己文档里的标准补救。规则看不到
      // inline style 里是否有 list-style:none,所以按元素类型豁免。
      // (nav: navigation 是规则自带的默认豁免,见其文档。)
      "jsx-a11y/no-redundant-roles": [
        "error",
        { nav: ["navigation"], ul: ["list"], ol: ["list"] },
      ],
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
      // reports 0 reverse-dep violations across 403 files. J.1.1 also
      // normalized the 16 `"./../packages/..."` path aliases in
      // `electron/tsconfig.json` to `../packages/...`, but Sheriff 0.19.6
      // still surfaces 3 SH-001 false positives for paths that combine
      // `baseUrl: "../../.."` with the `@openbuddy/cordis` alias
      // (`packages/runtime/...`). The 3 errors are pre-existing on the
      // 9 `packages/ui/openbuddy-ui-*/tsconfig.json` files. Kept at
      // `warn` until those 9 configs migrate to root-relative paths
      // (ui-* baseUrl collapse is a separate follow-up after v9 §28.2
      // core-session / ui-state extraction).
      "sheriff/dependency-rule": "warn",
      "sheriff/deep-import": "warn",
      "sheriff/encapsulation": "warn",
    },
  },
  {
    // Window Splitter 把手:`<div role="separator">` 带指针 + 键盘 handler。
    // 规则的 no-noninteractive-element-interactions 豁免是按**元素类型**给的
    // (config[type]),不是按 role,所以没法在上面的通用块里只放行 separator ——
    // div 太通用,在全局放行等于把这半条规则关掉。收窄到这一个文件。
    //
    // 为什么不整体关规则 / 不 inline disable:这个把手的键盘路径是真的
    // (方向键 8px / Shift 32px、Home/End 到端点,handleKeyDown 里 clamp 到
    // [min,max]),Resizable.test.tsx 也断言了 getByRole("separator") 与
    // aria-valuenow。规则在这一个点上是误报,不是缺陷 —— 所以豁免要窄、要写理由,
    // 并且留在配置里让下一个人看得见,而不是散落成一行 eslint-disable。
    files: ["packages/ui/openbuddy-ui-primitives/src/components/Resizable.tsx"],
    rules: {
      // 这个规则的豁免是按**元素类型**取的:`config[type]` 里列出的 prop 会被
      // 从该元素的属性里剔除,剩下的才拿去比对 handlers。所以要两样都给:
      // `div` 键列出这个把手上真实存在的交互 prop,handlers 保持规则默认值
      // (逐字取自 jsx-ast-utils 的 focus/image/keyboard/mouse 合并结果 ——
      // 写成别的组合,没列到的名字照报)。
      // onPointer* 不在规则默认表里,规则本来就看不见它们。
      "jsx-a11y/no-noninteractive-element-interactions": [
        "error",
        {
          div: ["onKeyDown", "onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel"],
          handlers: [
            "onFocus", "onBlur", "onLoad", "onError",
            "onKeyDown", "onKeyPress", "onKeyUp",
            "onClick", "onContextMenu", "onDblClick", "onDoubleClick",
            "onDrag", "onDragEnd", "onDragEnter", "onDragExit", "onDragLeave",
            "onDragOver", "onDragStart", "onDrop",
            "onMouseDown", "onMouseEnter", "onMouseLeave", "onMouseMove",
            "onMouseOut", "onMouseOver", "onMouseUp",
          ],
        },
      ],
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
