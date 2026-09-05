# Testing Strategy

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

This guide explains **how we test OpenBuddy** — every test type, when to run it, and how to add new tests. If you want to know *what* to test, see [`ARCHITECTURE.md`](ARCHITECTURE.md). If you want to know *how to debug* a failing test, see [`../SUPPORT.md`](../SUPPORT.md).

---

<a id="english"></a>
## 🇬🇧 English

### Test pyramid

```
                         ╱  Closed-loop capability eval ╲
                        ╱   Real-UI smoke (Playwright)   ╲
                       ╱      Electron smoke               ╲
                      ╱    Integration (Vitest + IPC)        ╲
                     ╱   Component (Testing Library)            ╲
                    ╱  Unit (Vitest, 309+ test files)                  ╲
                   ╱      Static (TypeScript, storage boundaries)     ╲
```

We run **309+ test files** at the bottom of the pyramid on every PR. Above that sit integration, smoke, and end-to-end eval suites that run on merge to master and release.

### Test types

| Type | What | Tool | Where | Speed |
|---|---|---|---|---|
| **Static** | Type safety, dead code, unused exports | `tsc --noEmit` | every PR | ~30 s |
| **Unit** | Pure functions, services, hooks | Vitest | every PR | ~2 min |
| **Component** | React components in isolation | Testing Library + Vitest | every PR | ~2 min |
| **Integration** | Multiple units together | Vitest | every PR | ~3 min |
| **IPC surface** | Every preload channel is exercised | custom smoke | every PR | ~30 s |
| **Storage boundaries** | Architecture enforcement | custom script | every PR | ~5 s |
| **Electron smoke** | Full app launches, no crash | Playwright + CDP | merge to master | ~5 min |
| **Real-UI smoke** | Real renderer, real interactions | Playwright | merge to master | ~10 min |
| **Closed-loop eval** | Agent runs against fixtures | custom harness | release | ~30 min |
| **External eval** | GAIA-style, AgentBench, etc. | custom adapters | release | hours |

### Commands

| Test type | Command |
|---|---|
| All unit + component + integration | `pnpm workspace:test` |
| Just renderer | `pnpm test` |
| Just one package | `cd packages/<group>/<name> && pnpm test` |
| Type-check all 32 projects | `pnpm workspace:typecheck` |
| Storage boundaries | `pnpm storage:boundaries` |
| IPC surface regression | `pnpm test:electron:surface` |
| Electron smoke | `pnpm test:electron` |
| Real-UI smoke | `pnpm test:electron:real-ui` |
| Closed-loop capability eval | `pnpm test:closed-loop` |
| External eval suite | `pnpm eval:*` |
| Coverage report | `pnpm test:coverage` |

### Where to put new tests

| You're testing… | Put it in… |
|---|---|
| A renderer component | `src/components/<Component>/__tests__/<Component>.test.tsx` |
| A renderer hook | `src/lib/__tests__/<hook>.test.ts` |
| A renderer store (Zustand) | `src/stores/__tests__/<store>.test.ts` |
| Electron main IPC handler | `electron/main/__tests__/<file>.test.ts` |
| An `@openbuddy/*` capability | `packages/<group>/<name>/src/__tests__/<file>.test.ts` |
| The whole app via UI | `scripts/electron/real-ui-smoke.mjs` |
| The agent end-to-end | `scripts/electron/closed-loop-capability-eval.mjs` |

### Conventions

#### File naming

- Specs: `*.test.ts` or `*.test.tsx`
- Co-locate with source: `src/foo.ts` → `src/__tests__/foo.test.ts` or `src/foo.test.ts`
- One spec per source file (preferred; split if both grow > 500 lines)

#### Test structure

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyComponent } from "../MyComponent";

describe("MyComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the heading", () => {
    render(<MyComponent title="Hello" />);
    expect(screen.getByRole("heading")).toHaveTextContent("Hello");
  });

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn();
    render(<MyComponent title="Hello" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("disables the button when loading", () => {
    render(<MyComponent title="Hello" loading />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
```

#### Style

- **Describe behavior**, not implementation. `it("calls the API")` over `it("calls fetch with url X")`.
- **One assertion focus per `it`** — multiple `expect`s are fine if they all assert the same behavior.
- **No sleeps**. Use `waitFor`, `findBy`, or fake timers.
- **No `any`**. Match the source's types.
- **Snapshot tests only for visual regression**. Never for behavior.

### Mocks & fixtures

- **MSW** for HTTP. Handlers live in `src/__tests__/msw/handlers.ts`.
- **Vitest mocks** for Electron (`vi.mock("electron")`).
- **Fixtures** in `src/__tests__/fixtures/` (JSON, factories).
- **Cordis context** for service tests — use the real `Context` class, not a mock.

### Coverage targets

| Layer | Target | Measured |
|---|---|---|
| Capability packages | 80% lines, 70% branches | per-package |
| Renderer components | 70% lines | per-package |
| Electron main IPC | 90% lines | per-package |
| Eval harness | 60% lines | per-package |

Coverage is reported nightly in [`evidence/coverage-report/`](../../evidence/coverage-report/). Drops > 5% block the release.

### Flaky tests

A flaky test is a **bug**. To fix it:

1. Identify the race condition (usually a missing `await` or time-dependence).
2. Add `it.skip` with a TODO + linked issue ONLY if you can't reproduce the race.
3. File an issue with the `tests` and `priority: high` labels.
4. Don't disable-and-forget.

### CI integration

GitHub Actions runs:

| Job | Trigger | Required? |
|---|---|---|
| `typecheck` | every PR | ✅ |
| `test` | every PR | ✅ |
| `storage-boundaries` | every PR | ✅ |
| `ipc-surface` | every PR | ✅ |
| `audit` | weekly | recommended |
| `docs-link-check` | every PR | ✅ |
| `codeql` | weekly + every PR | recommended |
| `electron-smoke` | merge to master | ✅ |
| `real-ui-smoke` | merge to master | ✅ |
| `closed-loop` | release tag | ✅ |

See [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) for the full matrix.

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 测试金字塔

```
                         ╱  闭环能力评测 ╲
                        ╱   真机 UI smoke (Playwright)   ╲
                       ╱      Electron smoke               ╲
                      ╱    集成 (Vitest + IPC)                ╲
                     ╱   组件 (Testing Library)                  ╲
                    ╱  单元 (Vitest, 309+ 测试文件)                  ╲
                   ╱      静态 (TypeScript、存储边界)                 ╲
```

我们在每个 PR 上跑金字塔底部的 **309+ 个测试文件**。其上方的集成、smoke、端到端评测在合并到 master 与发布时跑。

### 测试类型

(同英文表格)

### 命令

(同英文表格)

### 新测试放哪

(同英文表格)

### 约定

#### 文件命名

- 规格:`*.test.ts` 或 `*.test.tsx`
- 与源码同位置:`src/foo.ts` → `src/__tests__/foo.test.ts` 或 `src/foo.test.ts`
- 一个源码文件一个规格(优先;若都 > 500 行再拆)

#### 测试结构

(代码示例同英文版)

#### 风格

- **描述行为**,非实现。用 `it("调用 API")` 而非 `it("用 url X 调 fetch")`
- **每个 `it` 一个断言焦点** —— 多 `expect` 可,只要都断言同一行为
- **无 sleep**。用 `waitFor`、`findBy` 或假定时器
- **无 `any`**。与源文件类型匹配
- **快照测试仅用于视觉回归**。永不用于行为

### Mock 与 fixture

- **HTTP** 用 MSW。处理器在 `src/__tests__/msw/handlers.ts`
- **Electron mock** 用 Vitest(`vi.mock("electron")`)
- **Fixture** 在 `src/__tests__/fixtures/`(JSON、工厂)
- **Cordis context** 用于服务测试 —— 用真实的 `Context` 类,不用 mock

### 覆盖率目标

| 层 | 目标 | 度量 |
|---|---|---|
| capability 包 | 80% 行,70% 分支 | 每包 |
| 渲染端组件 | 70% 行 | 每包 |
| Electron 主进程 IPC | 90% 行 | 每包 |
| 评测 harness | 60% 行 | 每包 |

每晚在 [`evidence/coverage-report/`](../../evidence/coverage-report/) 报告覆盖率。跌幅 > 5% 阻塞发布。

### Flaky 测试

Flaky 测试是 **bug**。修复:

1. 识别竞态条件(通常缺 `await` 或时间依赖)
2. 加 `it.skip` 加 TODO + 关联 Issue —— 仅当你无法复现竞态
3. 开 Issue 带 `tests` 与 `priority: high` 标签
4. 不要禁用后遗忘

### CI 集成

(同英文表格)

---

<div align="center">

**Tests are documentation. / 测试即文档。**

<sub>Found a test gap? Open an issue labeled `tests`. / 发现测试缺口?开 Issue 带 `tests` 标签。</sub>

</div>
