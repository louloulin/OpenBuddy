# Plugin Development Guide

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

This guide teaches you how to build your first Cordis capability package for OpenBuddy. By the end you'll have a working "Counter" capability, full test coverage, and a published internal package.

---

<a id="english"></a>
## 🇬🇧 English

### What is a Cordis capability?

In OpenBuddy, every feature is a **Cordis service** declared in an `@openbuddy/*` workspace package. A capability:

- Declares a typed config
- Implements a `Service` class with methods
- Exports an `apply(ctx: Context)` entry that mounts the service on the Cordis context
- Persists state via `@openbuddy/storage`
- Exposes IPC handlers that the renderer can call
- Ships with Vitest unit tests

### Prerequisites

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`GETTING_STARTED.md`](GETTING_STARTED.md) first. Make sure you can run `pnpm electron:dev` and see the OpenBuddy window.

### Step 1 — Pick a name

Pick a name that follows `@openbuddy-<group>-<name>`. The existing groups are:

| Group | When to use |
|---|---|
| `runtime/` | Cross-cutting runtime helpers (rare; discuss first) |
| `renderer/` | Renderer-only glue |
| `bundle/` | Umbrella packages |
| `auth/` | Authentication-related |
| `team/` | Multi-agent |
| `capability/` | User-facing capabilities (most common) |
| `core/` | Foundational lifecycle |
| `fs/` | Filesystem adapters |
| `shared/` | Cross-package types |
| `collaboration/` | Cross-agent protocols |
| `payment/` | Payment adapters |
| `saml/` / `scim/` / `webhook-outbox/` | Enterprise primitives |
| `ui/` | UI primitives |

For this tutorial, we'll build `capability/openbuddy-counter` — a silly demo that increments a number on a button press.

### Step 2 — Create the package skeleton

```bash
mkdir -p packages/capability/openbuddy-counter/src/__tests__
cat > packages/capability/openbuddy-counter/package.json << 'EOF'
{
  "name": "@openbuddy/capability-counter",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@openbuddy/cordis": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
EOF
```

### Step 3 — Write the service

```typescript
// packages/capability/openbuddy-counter/src/index.ts
import { Context, OpenBuddyService } from "@openbuddy/cordis";

export interface CounterConfig {
  initialValue: number;
}

export class CounterService extends OpenBuddyService {
  static config: Required<CounterConfig> = {
    initialValue: 0,
  };

  private count: number;

  constructor(ctx: Context, config: CounterConfig) {
    super(ctx, "openbuddy.capability.counter", config);
    this.count = config.initialValue;
  }

  /** Current value. */
  get value(): number {
    return this.count;
  }

  /** Increment by 1 (or `by`). */
  increment(by = 1): number {
    this.count += by;
    this.ctx.emit("counter:changed", { value: this.count });
    return this.count;
  }

  /** Reset to a specific value. */
  reset(value?: number): number {
    this.count = value ?? CounterService.config.initialValue;
    this.ctx.emit("counter:reset", { value: this.count });
    return this.count;
  }
}

export default function apply(ctx: Context) {
  ctx.plugin(CounterService, ctx.config);
}

export { CounterService };
```

### Step 4 — Write a test

```typescript
// packages/capability/openbuddy-counter/src/__tests__/index.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Context } from "@openbuddy/cordis";
import { CounterService } from "../index.js";

describe("CounterService", () => {
  let ctx: Context;

  beforeEach(() => {
    ctx = new Context();
  });

  it("starts at initialValue", () => {
    const counter = ctx.plugin(CounterService, { initialValue: 5 });
    expect(counter.value).toBe(5);
  });

  it("increments by 1 by default", () => {
    const counter = ctx.plugin(CounterService, { initialValue: 0 });
    expect(counter.increment()).toBe(1);
    expect(counter.increment()).toBe(2);
  });

  it("increments by N when given", () => {
    const counter = ctx.plugin(CounterService, { initialValue: 10 });
    expect(counter.increment(5)).toBe(15);
  });

  it("emits counter:changed events", () => {
    const counter = ctx.plugin(CounterService, { initialValue: 0 });
    const events: number[] = [];
    ctx.on("counter:changed", (e) => events.push(e.data.value));
    counter.increment();
    counter.increment(5);
    expect(events).toEqual([1, 6]);
  });

  it("resets to initial value when no arg", () => {
    const counter = ctx.plugin(CounterService, { initialValue: 100 });
    counter.increment(50);
    counter.reset();
    expect(counter.value).toBe(100);
  });
});
```

### Step 5 — Wire it into the Electron host

Open `electron/main/capability-mounter.ts` (or wherever the Cordis context is constructed) and add your plugin:

```typescript
import { apply as applyCounter } from "@openbuddy/capability-counter";

// inside the ctx construction
applyCounter(ctx);
```

Add a config to `electron/main/openbuddy-core-plugin.ts`:

```typescript
export const config = {
  "openbuddy.capability.counter": {
    initialValue: 0,
  },
};
```

### Step 6 — Expose IPC handlers

```typescript
// electron/main/ipc/index.ts (add inside the register() function)
import { counter } from "./context.js"; // helper that resolves the service

ipcMain.handle("counter:get", () => counter.value);
ipcMain.handle("counter:increment", (_e, by?: number) => counter.increment(by));
ipcMain.handle("counter:reset", (_e, to?: number) => counter.reset(to));
```

Add the channels to the allowlist:

```typescript
// electron/preload/index.ts
const allowedInvokeChannels = new Set([
  // … existing
  "counter:get",
  "counter:increment",
  "counter:reset",
]);
```

Add the typed wrapper:

```typescript
// src/lib/electron-api.ts
export const counter = {
  get: () => window.api.invoke<number>("counter:get"),
  increment: (by?: number) => window.api.invoke<number>("counter:increment", by),
  reset: (to?: number) => window.api.invoke<number>("counter:reset", to),
};
```

Run `pnpm test:electron:ipc-surface` to update the auto-generated surface matrix.

### Step 7 — Add a UI control

```tsx
// src/components/Counter.tsx
import { useEffect, useState } from "react";
import { counter } from "@/lib/electron-api";

export function Counter() {
  const [value, setValue] = useState(0);

  const refresh = async () => setValue(await counter.get());

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="counter">
      <span>{value}</span>
      <button onClick={async () => setValue(await counter.increment())}>+</button>
      <button onClick={async () => setValue(await counter.reset())}>reset</button>
    </div>
  );
}
```

### Step 8 — Run the full test suite

```bash
pnpm workspace:test
pnpm workspace:typecheck
pnpm electron:dev
```

You should see:

- New tests for `CounterService` pass.
- Type-check passes for the whole monorepo.
- A "Counter" button in the dev window that increments on click.

### Step 9 — Open a PR

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the workflow. Be sure to:

- Update [`openbuddy-capability-matrix.md`](openbuddy-capability-matrix.md) with a new row.
- Add a new entry to `CHANGELOG.md` under the next version.
- Reference the GitHub issue that motivated the capability.

### Advanced topics

#### Persistence

If your capability needs to survive restarts, use `@openbuddy/storage`:

```typescript
import { openStorageSync } from "@openbuddy/storage";

constructor(ctx: Context, config: CounterConfig) {
  super(ctx, "openbuddy.capability.counter", config);
  this.storage = openStorageSync({ filename: "counter.db" });
  this.count = this.storage.get<number>("counter.value") ?? config.initialValue;
}

increment(by = 1): number {
  this.count += by;
  this.storage.set("counter.value", this.count);
  this.ctx.emit("counter:changed", { value: this.count });
  return this.count;
}
```

#### Permissions

If your capability accesses the filesystem or makes network calls, declare required permissions:

```typescript
export class CounterService extends OpenBuddyService {
  static permissions = ["counter.read", "counter.write"];
}
```

The renderer must request these via `permission:request` before your service can be called.

#### Plugin discovery

If you want your capability to be **hot-loadable** at runtime (no rebuild), use `@openbuddy/plugin-host`:

```typescript
import { HarnessPluginLoader } from "@openbuddy/plugin-host";

const loader = new HarnessPluginLoader({
  context,
  importer: (specifier) => import(specifier),
});
await loader.loadCordisPatch(`
  - id: openbuddy.capability.counter
    entry: "./dist/index.js"
`);
```

Plugins are loaded from `~/.config/openbuddy/plugins/`. See [`openbuddy-plugin-catalog.md`](openbuddy-plugin-catalog.md) for the public catalog format.

#### Background tasks

If your capability runs a recurring job, use `@openbuddy/capability-automation`:

```typescript
import { automation } from "@openbuddy/capability-automation";

automation.schedule("@daily", async () => {
  await counter.reset();
});
```

#### Multi-agent

If your capability needs to coordinate with other agents, use the `@openbuddy/collaboration-*` packages:

```typescript
import { protocol } from "@openbuddy/collaboration-protocol";

protocol.on("counter:share", async (envelope) => {
  const { from, value } = envelope.payload;
  await counter.increment(value);
  await protocol.reply(envelope, { ok: true });
});
```

### Reference capability packages

To see real-world capabilities, study:

- `packages/capability/openbuddy-memory` — SQLite-backed memory
- `packages/capability/openbuddy-task` — sub-agent task lifecycle
- `packages/capability/openbuddy-email` — IMAP/SMTP + Gmail API
- `packages/auth/openbuddy-casdoor` — OIDC + admin REST
- `packages/payment/` — 4 payment adapters in one package

Each one follows the same pattern: `apply(ctx)` + `Service` class + tests.

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 什么是 Cordis 能力?

在 OpenBuddy 里,每个特性都是一个 **Cordis 服务**,放在 `@openbuddy/*` 工作区包中。一个能力:

- 声明类型化 config
- 实现一个带方法的 `Service` 类
- 导出一个 `apply(ctx: Context)` 入口把服务挂到 Cordis 上下文
- 通过 `@openbuddy/storage` 持久化状态
- 暴露渲染端可调的 IPC 处理器
- 附带 Vitest 单元测试

### 前置条件

先读 [`ARCHITECTURE.md`](ARCHITECTURE.md) 和 [`GETTING_STARTED.md`](GETTING_STARTED.md)。确保你能跑 `pnpm electron:dev` 看到 OpenBuddy 窗口。

### 第 1 步 — 选名字

命名遵循 `@openbuddy-<group>-<name>`。已有的 group:

| Group | 何时使用 |
|---|---|
| `runtime/` | 跨切面运行时助手(少见,先讨论) |
| `renderer/` | 仅渲染端胶水 |
| `bundle/` | umbrella 包 |
| `auth/` | 鉴权相关 |
| `team/` | 多 Agent |
| `capability/` | 用户可见能力(最常用) |
| `core/` | 基础生命周期 |
| `fs/` | 文件系统适配器 |
| `shared/` | 跨包类型 |
| `collaboration/` | 跨 Agent 协议 |
| `payment/` | 支付适配器 |
| `saml/` / `scim/` / `webhook-outbox/` | 企业原语 |
| `ui/` | UI 基元 |

本教程我们做 `capability/openbuddy-counter` —— 一个点按钮自增的小演示。

### 第 2 步 — 创建包骨架

```bash
mkdir -p packages/capability/openbuddy-counter/src/__tests__
cat > packages/capability/openbuddy-counter/package.json << 'EOF'
{
  "name": "@openbuddy/capability-counter",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run" },
  "dependencies": { "@openbuddy/cordis": "workspace:*" },
  "devDependencies": { "vitest": "^2.1.9" }
}
EOF
```

### 第 3 步 — 写服务

(代码与英文版相同)

### 第 4 步 — 写测试

(代码与英文版相同)

### 第 5 步 — 接到 Electron 宿主

打开 `electron/main/capability-mounter.ts`(或构造 Cordis 上下文的地方),加入插件:

```typescript
import { apply as applyCounter } from "@openbuddy/capability-counter";

applyCounter(ctx);
```

在 `electron/main/openbuddy-core-plugin.ts` 加 config:

```typescript
export const config = {
  "openbuddy.capability.counter": { initialValue: 0 },
};
```

### 第 6 步 — 暴露 IPC 处理器

```typescript
// electron/main/ipc/index.ts(在 register() 中加)
import { counter } from "./context.js";

ipcMain.handle("counter:get", () => counter.value);
ipcMain.handle("counter:increment", (_e, by?: number) => counter.increment(by));
ipcMain.handle("counter:reset", (_e, to?: number) => counter.reset(to));
```

把通道加入白名单:

```typescript
// electron/preload/index.ts
const allowedInvokeChannels = new Set([
  // … 已有
  "counter:get", "counter:increment", "counter:reset",
]);
```

加类型化包装:

```typescript
// src/lib/electron-api.ts
export const counter = {
  get: () => window.api.invoke<number>("counter:get"),
  increment: (by?: number) => window.api.invoke<number>("counter:increment", by),
  reset: (to?: number) => window.api.invoke<number>("counter:reset", to),
};
```

跑 `pnpm test:electron:ipc-surface` 更新自动生成的 surface 矩阵。

### 第 7 步 — 加 UI 控件

```tsx
// src/components/Counter.tsx
import { useEffect, useState } from "react";
import { counter } from "@/lib/electron-api";

export function Counter() {
  const [value, setValue] = useState(0);
  const refresh = async () => setValue(await counter.get());
  useEffect(() => { refresh(); }, []);
  return (
    <div className="counter">
      <span>{value}</span>
      <button onClick={async () => setValue(await counter.increment())}>+</button>
      <button onClick={async () => setValue(await counter.reset())}>reset</button>
    </div>
  );
}
```

### 第 8 步 — 跑完整测试套件

```bash
pnpm workspace:test
pnpm workspace:typecheck
pnpm electron:dev
```

应该看到:

- `CounterService` 新测试通过
- 整个 monorepo 类型检查通过
- 开发窗口里多了一个 "Counter" 按钮,点击自增

### 第 9 步 — 提 PR

见 [`../CONTRIBUTING.md`](../CONTRIBUTING.md) 工作流。记得:

- 在 [`openbuddy-capability-matrix.md`](openbuddy-capability-matrix.md) 加一行
- 在 `CHANGELOG.md` 下一个版本下加条目
- 关联触发本能力的 GitHub Issue

### 进阶主题

#### 持久化

若你的能力需要跨重启存活,用 `@openbuddy/storage`:

```typescript
import { openStorageSync } from "@openbuddy/storage";

constructor(ctx: Context, config: CounterConfig) {
  super(ctx, "openbuddy.capability.counter", config);
  this.storage = openStorageSync({ filename: "counter.db" });
  this.count = this.storage.get<number>("counter.value") ?? config.initialValue;
}

increment(by = 1): number {
  this.count += by;
  this.storage.set("counter.value", this.count);
  this.ctx.emit("counter:changed", { value: this.count });
  return this.count;
}
```

#### 权限

若你的能力访问文件系统或发起网络调用,声明所需权限:

```typescript
export class CounterService extends OpenBuddyService {
  static permissions = ["counter.read", "counter.write"];
}
```

渲染端必须先通过 `permission:request` 请求这些权限,你的服务才会被允许调用。

#### 插件发现

若你想让能力**运行时热加载**(无需重建),用 `@openbuddy/plugin-host`:

```typescript
import { HarnessPluginLoader } from "@openbuddy/plugin-host";

const loader = new HarnessPluginLoader({
  context,
  importer: (specifier) => import(specifier),
});
await loader.loadCordisPatch(`
  - id: openbuddy.capability.counter
    entry: "./dist/index.js"
`);
```

插件从 `~/.config/openbuddy/plugins/` 加载。公开目录格式见 [`openbuddy-plugin-catalog.md`](openbuddy-plugin-catalog.md)。

#### 后台任务

若你的能力跑定时任务,用 `@openbuddy/capability-automation`:

```typescript
import { automation } from "@openbuddy/capability-automation";

automation.schedule("@daily", async () => {
  await counter.reset();
});
```

#### 多 Agent

若你的能力需要与其他 Agent 协调,用 `@openbuddy/collaboration-*` 包:

```typescript
import { protocol } from "@openbuddy/collaboration-protocol";

protocol.on("counter:share", async (envelope) => {
  const { from, value } = envelope.payload;
  await counter.increment(value);
  await protocol.reply(envelope, { ok: true });
});
```

### 参考能力包

真实能力示例:

- `packages/capability/openbuddy-memory` — SQLite 持久化记忆
- `packages/capability/openbuddy-task` — 子 Agent 任务生命周期
- `packages/capability/openbuddy-email` — IMAP/SMTP + Gmail API
- `packages/auth/openbuddy-casdoor` — OIDC + 管理 REST
- `packages/payment/` — 一包里 4 个支付适配器

每个都遵循同样的模式:`apply(ctx)` + `Service` 类 + 测试。

---

<div align="center">

**Ship a plugin. Get featured in the next release notes. / 发布一个插件,下次发布说明见。**

</div>
