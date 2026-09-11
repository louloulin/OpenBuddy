# G3 实现规格：profile-manager.ts 切换到 pi DefaultPackageManager

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase C + backlog G3
>
> 本文档是 **Phase C 主项**，把 `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts`
> 的自实现 `ProfilePackageManager` 切到 pi 上游 `DefaultPackageManager` 的**详细迁移规格**。
>
> **状态**：规格已落地（2026-09-11 Round 7）。代码改动需 dev-env + pi 0.85.x 安装后才可执行。
> **关联 audit**：`scripts/audit/extensions-inventory.sh`（Round 6，hotspots.profileManager=806）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件 | `packages/runtime/openbuddy-plugin-host/src/profile-manager.ts`（806 LOC）|
| 当前 LOC | 806（GA gate: `<= 200`，差距 -606）|
| 涉及 pi API | `DefaultPackageManager / PackageManager / loadProjectContextFiles` |
| 替代自实现 | `packages/runtime/openbuddy-plugin-host/src/include.ts` (350 LOC) — G9 入口 |
| Owner | runtime team |
| 估时 | 2 周 |
| 阻塞 | **强依赖 G2**（SettingsManager 先落地，package 配置项才能注入）|
| 风险等级 | 高（plugin marketplace 是核心功能，破坏后不可用）|

---

## 1. 当前实现盘点（profile-manager.ts）

来源：`grep -nE "^(export|function|class|interface|type)" profile-manager.ts`

```
19  export interface ProfilePackageInfo
40  export type ProfileDependencyHealth = "ok" | "missing" | "version-mismatch" | "invalid"
42  export interface ProfileDependencyDiagnostic
51  export interface ProfilePackageOptions extends OpenBuddyProfileOptions
56  export interface ProfilePackageManager        ← 自定义接口
104 function packageName(value)                   ← 工具函数
111 function packageTarget(profile, name)
116 async function profileFor(options)
120 function packageManagerFor(options)            ← 自实现 PM 工厂
124 function directProfileDependencyNames(manifest)
131 async function localDirectorySource(source)
138 function packageNameFromSpecifier(source)
147 async function readOptionalFile(path)
155 async function restoreOptionalFile(path, content)
163 function dependencySource(name, requested)
169 async function readManifest(path)
175 async function managedDependencyFor(...)
206 type PackageDependencyManifest
213 interface ResolvedDependency
217 interface DependencyDeclaration
224 async function copyPackageTree(source, target)
232 async function resolveDependencyPackage(...)
265 function isPackageSpecifier(value)
269 function dependencyNames(manifest)
293 function dependencyKind(dependency)
... (~30 个内部函数 / 800 LOC)
```

**自实现覆盖**：
1. **npm install**（~150 LOC）：specifier 解析、版本约束、registry 调用、依赖树解析
2. **git install**（~100 LOC）：clone、ref checkout、签名验证（OpenBuddy 用 GPG）
3. **tarball install**（~80 LOC）：URL fetch、sha256 校验、解压
4. **local directory**（~80 LOC）：file:// path resolve、symbolic link 处理
5. **dependency health diagnostics**（~200 LOC）：manifest diff、版本冲突、missing detection
6. **signature verification**（~100 LOC）：GPG 公钥校验、SHA256 fallback
7. **migration hooks**（~100 LOC）：pre/post install scripts、state backup

**全部加起来 ~810 LOC**——这就是为什么 GA gate 目标 ≤ 200。

## 2. 目标实现（DefaultPackageManager 接管）

**核心策略**：**保留 `ProfilePackageManager` typed facade**，内部 delegate 给 pi `DefaultPackageManager`。

```typescript
// packages/runtime/openbuddy-plugin-host/src/profile-manager.ts (重写内部)
import { DefaultPackageManager, type PackageManager, loadProjectContextFiles } from "@earendil-works/pi-coding-agent";

export interface ProfilePackageManager {  // typed facade，API 不变
  install(spec: string, options?: InstallOptions): Promise<ProfilePackageInfo>;
  uninstall(name: string): Promise<void>;
  resolve(name: string): Promise<ProfilePackageInfo>;
  health(name: string): Promise<ProfileDependencyHealth>;
  diagnostics(name: string): Promise<ProfileDependencyDiagnostic[]>;
}

export function createProfilePackageManager(opts: ProfilePackageOptions): ProfilePackageManager {
  // 1. 创建 pi 的 DefaultPackageManager
  const piPM = DefaultPackageManager.create({
    registry: opts.registry,
    signatureKeys: opts.signatureKeys,  // GPG 公钥列表
    storagePath: opts.storagePath,
    settings: opts.settings,             // 来自 G2 的 SettingsManager
  });

  // 2. typed facade 模式：每个方法 delegate
  return {
    install: (spec, options) => piPM.install(spec, options).then(toProfilePackageInfo),
    uninstall: (name) => piPM.uninstall(name),
    resolve: (name) => piPM.resolve(name).then(toProfilePackageInfo),
    health: (name) => piPM.health(name),
    diagnostics: (name) => piPM.diagnostics(name).then(toDiagnostics),
  };
}
```

**目标 LOC 估算**：typed facade ≤ 80 LOC + 适配层 ≤ 120 LOC（npm/git/tarball/dir/health mapping）= 总计 ≤ 200 LOC（GA gate 满足）。

**额外清理**：
- 自实现 npm install ~150 LOC 全删
- 自实现 git install ~100 LOC 全删（GPG 校验通过 pi 适配层）
- 自实现 tarball/local-dir ~160 LOC 全删
- 自实现 health diagnostics ~200 LOC 全删
- 自实现 signature verification ~100 LOC 全删（除非 pi 不支持 GPG → 保留 ≤ 30 LOC）
- 自实现 migration hooks ~100 LOC 全删
- **净删除 ~810 LOC**，typed facade + 适配层 ~200 LOC，**实际缩减 -606 LOC**

## 3. 迁移步骤（按 PR 拆分）

### PR 1 — typed facade 保留 + 内部隔离
1. 不改 `ProfilePackageManager` 接口；不改任何业务调用方
2. 把 `createProfilePackageManager` 拆成两层：
   - 上层：typed facade（业务调用方看到）
   - 下层：现有自实现 ~810 LOC（保持不动）
3. 加 `// TODO(G3): replace with DefaultPackageManager` 注释
4. 跑 audit：`hotspots.profileManager` 仍是 806（暂时）
5. 跑 vitest：所有现有 plugin 安装/卸载/健康测试通过

### PR 2 — DefaultPackageManager 适配层
1. 引入 pi `DefaultPackageManager`（npm install pi-coding-agent 已含）
2. 新建适配层文件 `default-package-manager-adapter.ts`（≤ 120 LOC）：npm/git/tarball/dir mapping
3. 新建 GPG 签名校验适配层（≤ 30 LOC）— 如果 pi 不支持 GPG
4. `createProfilePackageManager` 内部 delegate 给 adapter
5. 跑 vitest：所有现有测试通过

### PR 3 — 删自实现
1. 删除自实现 npm install / git install / tarball / local-dir 共约 490 LOC
2. 删除自实现 health diagnostics ~200 LOC
3. 删除自实现 signature verification ~100 LOC
4. 删除自实现 migration hooks ~100 LOC
5. 跑 audit：`hotspots.profileManager <= 200` ✅
6. 跑 `pnpm typecheck` 0 error

### PR 4 — 端到端验证 + GA gate
1. 跑 `pnpm test:electron:marketplace-install-e2e` — 真实安装第三方 pi 包
2. 跑 `pnpm test:electron:plugin-hot-reload-e2e` — 热重载不破
3. 跑 `bash scripts/audit/extensions-inventory.sh --json | jq '.hotspots.profileManager <= 200'` ✅
4. 跑 `bash scripts/audit/pi-upstream-coverage.sh --json | jq '.unusedByDomain.resource'` — 从 3 降到 1（仅 include.ts 的 loadProjectContextFiles）

## 4. 测试策略

| 测试类型 | 文件 | 数量 |
|---|---|---|
| 现有单元（保留） | `profile-manager.test.ts`（existing）| ~15 |
| 新增（PR 2）| `default-package-manager-adapter.test.ts` | ~10（npm/git/tarball/dir 各 2-3 case）|
| 集成（PR 4）| `tests/electron/marketplace-install-e2e.spec.ts` | 现有 + npm/git/tarball 全过 |
| 集成（PR 4）| `tests/electron/plugin-hot-reload-e2e.spec.ts` | 现有 |

**测试目标**：`marketplace-install-e2e` 是 Phase C 的核心 smoke；任何 1 个 case 失败即视为 PR 阻断。

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 pi `DefaultPackageManager` 不支持 GPG 签名 | OpenBuddy 核心安全特性失效 | pi 0.85.x 文档 | PR 2 GPG 适配层（≤ 30 LOC）；如不达预期，G3 改为 P2 评估项 |
| R2 pi 不支持 OpenBuddy 的"profile + plugin 二级模型" | typed facade 跨级联问题 | pi 0.85.x 文档 | typed facade 保留 profile 这一层，plugin 这一层 delegate 给 pi |
| R3 自实现 deletion 影响 niche use case | 边角 install 流程失效 | 用户报告 | PR 1 → PR 2 → PR 3 渐进删除；保留 git bisect 友好的 PR 粒度 |
| R4 依赖 G2 未完成 | settings 配置项无法注入 | G2 阻塞 | 在 PR 1 / PR 2 中用 placeholder settings，G2 完成后切回 |
| R5 marketplace 服务器协议变更 | e2e 测试失败 | pi 升级或 server 改动 | PR 4 跑全 smoke 才能合并 |
| R6 plugin manifest schema 不兼容 | 现有第三方 plugin 失效 | pi manifest schema 严格 | typed facade 提供 schema 转换层 |

## 6. 验收命令（自动）

```bash
# 1. 静态 audit
bash scripts/audit/extensions-inventory.sh --json | jq '.hotspots.profileManager <= 200'  # true

# 2. 单元测试
pnpm workspace:test -- packages/runtime/openbuddy-plugin-host/src/__tests__/profile-manager.test.ts  # 全过

# 3. 集成 e2e
pnpm test:electron:marketplace-install-e2e  # 全过（npm/git/tarball/local-dir 至少各 1 case）
pnpm test:electron:plugin-hot-reload-e2e    # 全过

# 4. 类型检查
pnpm typecheck  # 0 error

# 5. pi 复用度
bash scripts/audit/pi-upstream-coverage.sh --json | jq '.unusedByDomain.resource'  # 应该从 3 降到 1
```

## 7. 与其他 G-gap 的关系

- **强依赖 G2**（SettingsManager 落地）：package manager 的所有配置项（registry / signatureKeys / storagePath / sandbox rules）都需要 typed settings facade。
- **解锁 G9**（loadProjectContextFiles）：profile-manager 完成后，include.ts (350 LOC) 的自实现 context 文件加载可以直接 delegate 给 pi `loadProjectContextFiles`。
- **解锁 G8**（29 canonical e2e）：plugin 安装/卸载逻辑稳定后，29 个第三方 pi 包的 e2e 测试才有可靠基座。
- **弱依赖 G15**（AuthStorage PKCE）：plugin marketplace 的认证流程可能涉及 credential 存储。

## 8. 进度更新

实施完成时：
1. `plan4.1.md §3 Phase C` 状态：`⬜ → 🟡 → ✅`
2. `docs/PI_INTEGRATION_BACKLOG.md §1 G3` 状态：`⬜ → 🟡 → ✅`
3. `docs/PI_NATIVE_AUDIT_BASELINE.md §0` GA gate 行：`profile-manager LOC ❌ → ✅`
4. `scripts/audit/extensions-inventory.sh` 的 GA gate `hotspots.profileManager` 字段自动反映
5. `scripts/audit/pi-upstream-coverage.sh` 的 unusedByDomain.resource 从 3 降到 1
6. 本规格 §0 状态：`规格已落地 → 实施完成 → 合并`