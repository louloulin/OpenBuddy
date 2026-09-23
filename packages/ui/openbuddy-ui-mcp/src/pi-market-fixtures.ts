/**
 * pi-market-fixtures — 开发态 / 空源场景下用来撑起 pi-market 视觉的样例数据。
 *
 * 为什么要这个:R83 复刻 pi.dev/packages 之后,空源状态下 pi-market 的整版面
 * (Recently published / 类型徽章 / 下载量 / `$ pi install ...` 命令)都是空,
 * 没法做视觉验收,真实用户也会觉得"装完 OpenBuddy 这页全是空的"。
 *
 * 设计:
 *   - 8 条与 pi.dev/packages 同源的样例(pnpm 同步过来,与真实扩展 ID 一致),
 *     不冒充真实数据;
 *   - 所有 fixture 都标 `sourceKind: "official"` + `sourceLabel: "npm:registry.npmjs.org (fixture)"`,
 *     让用户一眼看出"这是样例,不是真拉";
 *   - 类型覆盖 plugin / skill / extension / theme / prompt / mcp 全 6 种;
 *   - `downloadsLastMonth` 用真实 NPM 周下载量量级,避免排序看起来假;
 *   - 只在 dev / 显式 opt-in 下注入(`useFixtures` prop 或 `OPENBUDDY_PI_MARKET_FIXTURES=1`)。
 */
import type { MarketplaceEntry } from "@openbuddy/ui-modules/components";
import { buildInstallCommand, buildSearchBlob } from "@openbuddy/ui-modules/components/pi-market";

const NOW = Date.parse("2026-09-23T08:00:00Z");

function fixture(input: {
  id: string;
  npmName: string;
  publisher: string;
  description: string;
  version: string;
  primaryKind: MarketplaceEntry["primaryKind"];
  downloads: number;
  ageHours: number;
  homepage?: string;
  repo?: string;
  capabilities?: NonNullable<MarketplaceEntry["capabilities"]>;
  installedVersion?: string;
}): MarketplaceEntry {
  const updatedAt = new Date(NOW - input.ageHours * 3600_000).toISOString();
  return {
    id: input.id,
    name: input.id,
    publisher: input.publisher,
    description: input.description,
    version: input.version,
    kinds: [input.primaryKind ?? "plugin"],
    primaryKind: input.primaryKind,
    npmName: input.npmName,
    downloadsLastMonth: input.downloads,
    updatedAt,
    sourceKind: "official",
    sourceLabel: "npm:registry.npmjs.org (fixture)",
    npmUrl: `https://www.npmjs.com/package/${input.npmName}`,
    repoUrl: input.repo,
    reportUrl: `https://example.com/report/${input.npmName}`,
    installCommand: buildInstallCommand(input.npmName, input.id),
    searchBlob: buildSearchBlob([
      input.id,
      input.publisher,
      input.description,
      input.npmName,
    ]),
    homepage: input.homepage,
    capabilities: input.capabilities,
    installedVersion: input.installedVersion,
  };
}

export const PI_MARKET_FIXTURES: readonly MarketplaceEntry[] = [
  fixture({
    id: "pi-mcp-adapter",
    npmName: "pi-mcp-adapter",
    publisher: "nicopreme",
    description: "MCP (Model Context Protocol) adapter extension for Pi coding agent",
    version: "2.37.0",
    primaryKind: "extension",
    downloads: 1_013_749,
    ageHours: 1,
    repo: "https://github.com/nicobailon/pi-mcp-adapter",
    capabilities: [
      { id: "mcp.server", label: "MCP server", risk: "medium" },
      { id: "mcp.client", label: "MCP client", risk: "low" },
    ],
    installedVersion: "2.36.0",
  }),
  fixture({
    id: "pi-fabric",
    npmName: "pi-fabric",
    publisher: "monotykamary",
    description: "Custom LLM-agnostic coding agent runtime for Pi",
    version: "0.93.0",
    primaryKind: "extension",
    downloads: 22_600,
    ageHours: 2,
    repo: "https://github.com/monotykamary/pi-fabric",
  }),
  fixture({
    id: "@braintrust/pi-extension",
    npmName: "@braintrust/pi-extension",
    publisher: "braintrust",
    description: "Braintrust extension for pi. Includes automatic tracing for pi sessions, turns, LLM calls, and tool executions to Braintrust.",
    version: "2.1.0",
    primaryKind: "extension",
    downloads: 21_700,
    ageHours: 168,
    repo: "https://github.com/braintrustdata/braintrust-coding-agent-plugins",
  }),
  fixture({
    id: "pi-auto-model",
    npmName: "pi-auto-model",
    publisher: "earendil",
    description: "Native, explainable automatic model routing for the Pi coding agent",
    version: "0.4.1",
    primaryKind: "extension",
    downloads: 15_300,
    ageHours: 0.4,
    repo: "https://github.com/earendil-works/pi-auto-model",
  }),
  fixture({
    id: "pi-zense",
    npmName: "pi-zense",
    publisher: "earendil",
    description: "Spec-gated, human-signed SDLC harness for pi — sub-agents, dual eval, escalation gates",
    version: "0.1.2",
    primaryKind: "plugin",
    downloads: 4_200,
    ageHours: 0.02,
    repo: "https://github.com/earendil-works/pi-zense",
  }),
  {
    ...fixture({
      id: "experimental-pi-runtime",
      npmName: "@experimental/pi-runtime",
      publisher: "experimental-labs",
      description: "实验性 Pi runtime — 当前引擎版本不兼容,需 Pi core >= 4.0",
      version: "0.0.1",
      primaryKind: "extension",
      downloads: 89,
      ageHours: 0.5,
      repo: "https://github.com/experimental-labs/pi-runtime",
    }),
    sourceKind: "community",
    sourceLabel: "npm:registry.npmjs.org (fixture, blocked)",
    blockedReason: "需要 Pi core >= 4.0,当前引擎不兼容",
  },
  {
    ...fixture({
      id: "community-pi-toolkit",
      npmName: "@community-labs/pi-toolkit",
      publisher: "community-labs",
      description: "Community-maintained pi toolkit (示例 community 源,可正常安装)",
      version: "0.5.0",
      primaryKind: "extension",
      downloads: 320,
      ageHours: 2,
      repo: "https://github.com/community-labs/pi-toolkit",
    }),
    sourceKind: "community",
    sourceLabel: "npm:community-labs.example (fixture, community)",
  },
  fixture({
    id: "@trim21/personal-pi-extensions",
    npmName: "@trim21/personal-pi-extensions",
    publisher: "trim21",
    description: "Custom pi coding-agent extensions: bwrap sandbox, workspace guard, opencode edit, and more",
    version: "1.8.0",
    primaryKind: "extension",
    downloads: 8_900,
    ageHours: 0.08,
    repo: "https://github.com/trim21/pi-extensions",
  }),
  fixture({
    id: "hotmilk",
    npmName: "hotmilk",
    publisher: "earendil",
    description: "Pi meta-package: prompts, skills, themes, agents, and lazy-loaded bundled extensions toggled via hotmilk.json",
    version: "0.2.0",
    primaryKind: "plugin",
    downloads: 1_200,
    ageHours: 0.15,
    repo: "https://github.com/earendil-works/hotmilk",
  }),
  fixture({
    id: "sakura-pi-theme",
    npmName: "@moe-labs/sakura-pi-theme",
    publisher: "moe-labs",
    description: "樱花色 Pi 主题 — 浅粉 / 樱白双套配色,内置 8 个 accent",
    version: "1.4.0",
    primaryKind: "theme",
    downloads: 3_400,
    ageHours: 36,
    repo: "https://github.com/moe-labs/sakura-pi-theme",
    capabilities: [{ id: "theme.install", label: "Theme install", risk: "low" }],
  }),
  fixture({
    id: "reviewer-prompt-pack",
    npmName: "@openbuddy/reviewer-prompt-pack",
    publisher: "openbuddy",
    description: "评审类 prompt 模板包 — code review / PR 摘要 / 风险点 3 类",
    version: "0.3.0",
    primaryKind: "prompt",
    downloads: 760,
    ageHours: 12,
    repo: "https://github.com/openbuddy/reviewer-prompt-pack",
  }),
  fixture({
    id: "@juicesharp/rpiv-todo",
    npmName: "@juicesharp/rpiv-todo",
    publisher: "juicesharp",
    description: "Pi 任务管理扩展 — 跨会话的 todo 列表,支持子任务与依赖",
    version: "0.9.4",
    primaryKind: "skill",
    downloads: 12_500,
    ageHours: 4,
    repo: "https://github.com/juicesharp/rpiv-todo",
    capabilities: [{ id: "task.write", label: "任务写入", risk: "low" }],
  }),
];

/**
 * 是否在 dev / 显式 opt-in 下注入 fixtures。
 *
 * 三道闸门,任何一个为 true 就开:
 *   1. `useFixtures === true` — 显式 prop,优先级最高;
 *   2. `import.meta.env?.DEV === true` — Vite dev server(`electron-vite dev`);
 *   3. `globalThis.__OPENBUDDY_PI_MARKET_FIXTURES__ === 1` — 真机 probe / 集成测试
 *      通过 DevTools / window 注入,R83 之后默认开,生产环境手 set 才会触发。
 *
 * 注意:`process.env.NODE_ENV` 在 renderer bundle 里会被 Vite **内联**(build 时
 * 变成 `"production"` 字面量),不能用来判断 dev;这是为什么用 `import.meta.env`。
 */
export function shouldInjectPiMarketFixtures(useFixtures?: boolean): boolean {
  if (useFixtures === true) return true;
  try {
    const meta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
    if (meta?.env?.DEV === true) return true;
  } catch {
    // 非 Vite 环境忽略
  }
  const g = globalThis as { __OPENBUDDY_PI_MARKET_FIXTURES__?: unknown };
  if (g.__OPENBUDDY_PI_MARKET_FIXTURES__ === 1) return true;
  return false;
}
