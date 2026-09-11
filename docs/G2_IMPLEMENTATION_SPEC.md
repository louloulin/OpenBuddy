# G2 实现规格：settings-store.ts 切换到 pi SettingsManager

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase C + backlog G2
>
> 本文档是 **Phase C 入口**，把 `packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts`
> 的自实现 settings 校验切到 pi 上游 `SettingsManager` 的**详细迁移规格**。
>
> **状态**：规格已落地（2026-09-11 Round 7）。代码改动需 dev-env + pi 0.85.x 安装后才可执行。
> **关联 audit**：`scripts/audit/extensions-inventory.sh`（Round 6 第 5 个 audit，hotspots.settingsStore=196）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件 | `packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts`（196 LOC）|
| 当前 LOC | 196（GA gate: `<= 50`，差距 -146）|
| 涉及 pi API | `SettingsManager.create() / RetrySettings / ImageSettings / settings-diagnostics` |
| 替代自实现 | `electron/main/agent/host-modules/models-config.ts` (~300 LOC) + `packages/capability/openbuddy-folder-trust/src/settings-backend.ts`（typed facade）|
| Owner | runtime team |
| 估时 | 2 周 |
| 阻塞 | G2 不依赖其它 G-gap；可独立启动 |
| 风险等级 | 高（settings schema 是 typed facade 全调用方共享）|

---

## 1. 当前实现盘点（settings-store.ts）

来源：`grep -nE "^(export|function|class|interface|type)" settings-store.ts`

```
45  export type SettingsValidator = (value: unknown) => string | undefined;
47  export interface SettingsNamespaceStats
53  export interface SettingsStoreOptions
73  export class SettingsStore           // ~120 LOC，封装 sqlite + 自定义 schema 校验
```

**自实现的部分**（约 196 LOC 拆分）：
1. SQLite 后端读写（~40 LOC）
2. 自定义 schema 校验器（~50 LOC）
3. Namespace 注册逻辑（~30 LOC）
4. 默认值 + 迁移（~40 LOC）
5. 类型导出 + 工具方法（~36 LOC）

**调用的下游**（grep 依赖）：
- `packages/capability/openbuddy-folder-trust/src/settings-backend.ts` — typed facade（推荐保留）
- `electron/main/agent/host-modules/models-config.ts` — 自实现 retry/image 校验
- 其它约 8 个 setting consumer 文件

## 2. 目标实现

**核心策略**：**保留 `SettingsStore` 作为 typed facade**（OpenBuddy 业务调用方零修改），内部实现切到 pi `SettingsManager`。

```typescript
// packages/runtime/openbuddy-storage/src/sqlite/settings-store.ts (重写内部)
import { SettingsManager } from "@earendil-works/pi-coding-agent";

export class SettingsStore {
  private readonly manager: SettingsManager;

  constructor(options: SettingsStoreOptions) {
    // 1. 用 pi 的 SettingsManager 做 schema 校验 + 默认值
    this.manager = SettingsManager.create({
      schemas: options.schemas,  // 复用现有 typed schemas
      namespace: options.namespace,
    });

    // 2. SQLite 仍保留作 backing store（pi 不强制用哪个 backend）
    this.sqlite = options.sqlite;
  }

  // 3. 公开 API 不变（typed facade 模式）
  async get<T>(key: string): Promise<T | undefined> { ... }
  async set<T>(key: string, value: T): Promise<void> { ... }
  async validate(value: unknown): Promise<string | undefined> { ... }
  // ...
}
```

**目标 LOC 估算**：typed facade 保留 ≤ 50 LOC（GA gate 满足）。

**额外清理**：
- `models-config.ts` (~300 LOC) 中 retry/image 校验代码全删，改为引用 `SettingsStore.validate()`
- 自定义 schema 校验器（~50 LOC）全删

## 3. 迁移步骤（按 PR 拆分）

### PR 1 — SettingsManager schema 适配（接口对齐）
1. 把 `SettingsStoreOptions.schemas` 转换为 pi 的 schema 格式（field-by-field 映射表）
2. 内部保留 SQLite 读写，但 schema 校验走 pi `SettingsManager.validate()`
3. `SettingsStore.validate()` 改为 delegate 给 `SettingsManager.validate()`
4. 跑 audit：`hotspots.settingsStore` 暂时仍是 196（LOC 没变），但功能已切到 pi
5. 跑 vitest：所有现有 settings 测试通过

### PR 2 — 删除自实现校验（瘦身）
1. 删除 `SettingsStore` 类内 `validate()` 自实现（约 50 LOC）
2. 删除 `SettingsValidator` 类型（用 pi 的）
3. 删除 models-config.ts 中 retry/image 校验代码（约 100 LOC）
4. 跑 audit：`hotspots.settingsStore` 必须 ≤ 50（GA gate）✅
5. 跑 vitest：所有现有 settings 测试通过；run workspace:typecheck 0 error

### PR 3 — RetrySettings / ImageSettings 接管
1. `models-config.ts` 中 retry/image 配置全切到 pi `RetrySettings` / `ImageSettings`
2. 删除自定义 retry 退避策略（~50 LOC）
3. 删除自定义 image resize 配置（~30 LOC）
4. 跑 audit：`hotspots.settingsStore` 仍是 ≤ 50（不再变化），但 settings 域 unused 从 4 → 1（仅 settings-diagnostics）
5. 跑 `bash scripts/audit/pi-upstream-coverage.sh` 验证 unused settings 减少

### PR 4 — GA gate 收口
1. `bash scripts/audit/extensions-inventory.sh --json | jq '.hotspots.settingsStore <= 50'` ✅
2. `pnpm typecheck` 0 error
3. `pnpm workspace:test` 542 / 5517 全过
4. `pnpm test:electron:model-config-verify` smoke 全过

## 4. 测试策略

| 测试类型 | 文件 | 数量 |
|---|---|---|
| 现有单元（保留） | `settings-store.test.ts`（existing）| ~10 |
| 新增（PR 3）| `retry-settings.test.ts` + `image-settings.test.ts` | ~6（pi API 适配层）|
| 迁移（PR 2）| `models-config.test.ts` 改用 SettingsStore | ~5 |
| 集成（PR 4）| `tests/electron/model-config-verify.spec.ts` | 现有 + retry round-trip |

**测试目标**：所有现有 settings 测试通过；新增 pi API 适配层覆盖率 ≥ 80%。

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 typed facade 调用方修改 | OpenBuddy 启动失败 | PR 2 删除类型导致 type error | PR 1 先保持 facade API；`git grep "SettingsStore\\."` 兜底 |
| R2 SQLite 与 pi SettingsManager 不兼容 | schema 校验失效 | 现有 settings schema 不是 pi 格式 | PR 1 转换层 |
| R3 pi `SettingsManager` 不支持 OpenBuddy 的 namespace 隔离 | 跨域 settings 串扰 | pi 0.85.x 文档无 namespace API | PR 1 用 pi 的 `namespace` 参数；如缺则 PR 4 加 typed facade 适配 |
| R4 pi 0.86.x 升级破坏 SettingsManager schema | G2 回头 | pi 升级 | typed facade 隔离 pi API |
| R5 settings 迁移数据丢失 | 用户配置被覆盖 | pi 默认值 ≠ OpenBuddy 默认 | PR 1 migration script 显式保留 |

## 6. 验收命令（自动）

```bash
# 1. 静态 audit
bash scripts/audit/extensions-inventory.sh --json | jq '.hotspots.settingsStore <= 50'  # true

# 2. 单元测试
pnpm workspace:test -- packages/runtime/openbuddy-storage/src/__tests__/settings-store.test.ts  # 全过

# 3. 类型检查
pnpm typecheck  # 0 error

# 4. 集成 smoke
pnpm test:electron:model-config-verify  # 全过

# 5. pi 复用度
bash scripts/audit/pi-upstream-coverage.sh --json | jq '.unusedByDomain.settings'  # 应该从 4 降到 1
```

## 7. 与其他 G-gap 的关系

- **解锁 G1**（apply-patch → pi-tool-factories）：bash tool 的 sandbox / permission 配置项依赖 SettingsStore 的 typed facade。
- **解锁 G3**（profile-manager → DefaultPackageManager）：package manager 配置项存于 settings，需要 SettingsManager 接管后才能注入 pi DefaultPackageManager。
- **解锁 G15**（AuthStorage PKCE）：deepseek-generic auth 流程的 retry 配置存于 settings。
- **被 G11 弱依赖**：plugin manifest 的 settings schema 解析最终也走 pi。

## 8. 进度更新

实施完成时：
1. `plan4.1.md §3 Phase C` 状态：`⬜ → 🟡 → ✅`
2. `docs/PI_INTEGRATION_BACKLOG.md §1 G2` 状态：`⬜ → 🟡 → ✅`
3. `docs/PI_NATIVE_AUDIT_BASELINE.md §0` GA gate 行：`settings-store LOC ❌ → ✅`
4. `scripts/audit/extensions-inventory.sh` 的 GA gate `hotspots.settingsStore` 字段自动反映
5. `scripts/audit/pi-upstream-coverage.sh` 的 unusedByDomain.settings 从 4 降到 1
6. 本规格 §0 状态：`规格已落地 → 实施完成 → 合并`