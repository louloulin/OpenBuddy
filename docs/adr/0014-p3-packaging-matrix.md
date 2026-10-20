# ADR-0014: P3 打包发布 — host-core binary 注入 + 跨平台构建矩阵 / S5

- **Status**: Accepted (R97/S5, 2026-09-24)
- **Deciders**: OpenBuddy maintainers
- **Related**:
  - ADR-0011 (插件页面简化) — R97 历史决策的同期产出
  - ADR-0013 (Rust 8-triple CI 矩阵) — Rust 编译/lint 验证
  - `electron-builder.yml` — 主打包配置
  - `scripts/build-host-core-matrix.sh` — 跨平台构建脚本(新增)
  - `packages/runtime/openbuddy-host-runtime/src/resolve-binary.ts` — 二进制解析

## Context / 背景

Phase 0-3 已把 Rust host-core sidecar(`crates/openbuddy-host-core`)通过
stdio JSON-RIPC 接到 Electron Main,但「打包发布」环节还差三件事:

1. **未注入 binary**: `electron-builder.yml` 的 `extraResources` 之前没有
   `bin/openbuddy-host-core` 条目,意味着任何 packaged build 启动后,
   `resolveHostBinary()` 走到第 3-4 个候选(monorepo target/)时找不到,
   throw "binary not found",整个 app 启动失败。这是**部署即崩溃**级别
   的 P0 缺陷。

2. **解析逻辑 bug**: `resolve-binary.ts` 第 59 行用
   `process.env["process.resourcesPath"]` 取 packaged 路径。`resourcesPath`
   是 Electron 注入到 `process` 对象上的属性,**不是环境变量**。`process.env`
   里没这个 key,运行时永远是 undefined,packaged 路径永远不会被命中。
   `process-vite dev` 模式下 fallback 到 monorepo target/ 能掩盖这个 bug,
   所以单测覆盖率 0 时一直没被发现。

3. **8-triple 构建矩阵无统一入口**: Rust CI 工作流(`.github/workflows/rust-host-core.yml`)
   覆盖 8 个 triple,但开发者本地构建需要逐个 `cargo build --target <triple>`。
   没有「一键全矩阵」脚本,新人容易漏平台。

## Decision / 决策

### 1. `electron-builder.yml` 注入 host-core binary

```yaml
extraResources:
  # Rust host-core sidecar binary (P3 打包发布)
  - from: "crates/target/release/openbuddy-host-core${exe}"
    to: "bin/openbuddy-host-core${exe}"
    filter:
      - "openbuddy-host-core*"
```

electron-builder 在三平台上的产物路径:
- macOS: `OpenBuddy.app/Contents/Resources/bin/openbuddy-host-core`
- Linux: `resources/bin/openbuddy-host-core`
- Windows: `resources/bin/openbuddy-host-core.exe`

### 2. 修 `resolve-binary.ts` bug

```ts
// Before:
const resources = process.env["process.resourcesPath"] ?? "";  // ← BUG
// After:
const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? "";
```

并新增 6 个契约测试守住该路径(其中 1 个专门是 bug fix 回归测试,
设 `process.resourcesPath` 时必须解析到 packaged 路径,否则视为退化)。

### 3. 跨平台构建脚本 `scripts/build-host-core-matrix.sh`

8 triple 矩阵(与 ADR-0013 对齐):
| 平台 | triple | 工具链 |
|---|---|---|
| macOS | aarch64-apple-darwin | osxcross |
| macOS | x86_64-apple-darwin | osxcross |
| Linux | x86_64-unknown-linux-gnu | cargo / cross |
| Linux | aarch64-unknown-linux-gnu | cross |
| Linux | x86_64-unknown-linux-musl | cross (alpine) |
| Windows | x86_64-pc-windows-msvc | cross |
| Windows | aarch64-pc-windows-msvc | cross |

脚本支持 3 种用法:
- `./build-host-core-matrix.sh` — 默认本机架构
- `./build-host-core-matrix.sh --all` — 全部可用目标
- `./build-host-core-matrix.sh --target <triple>` — 单个目标
- `./build-host-core-matrix.sh --platform linux|macos|win` — 平台组

优先用 `cross` 跨平台编译(如有安装),否则 fallback 原生 `cargo`。

### 4. 不做(明确范围外)

- **不做 napi-rs 预编译注入**: P2.1 stdio JSON-RPC 路径 P95 < 1ms,
  远低于 10ms 阈值,Phase 3 标记 skipped。
- **不做 auto-update 业务**: electron-builder `publish.provider = github`
  已经配置,自动 publish 触发由发版 release 流程负责;本轮不引入
  `electron-updater` 库或自研 NSIS update 流。
- **不做 asar 重新启用**: 现有 `asar: false` 是 pnpm + Electron 兼容性的
  既定妥协,本轮不动(已在 yaml 中有详细注释)。
- **不做 8 platform linux ARMv7 等冷门目标**: 用户基数与维护成本不匹配。

## Consequences / 影响

### 正面

- ✅ packaged build 不再因找不到 binary 启动失败
- ✅ 解析路径 bug 修复 + 单测守护
- ✅ 8-triple 构建有标准化入口,新人 onboarding 文档化
- ✅ 与 PI-Desktop `apps/desktop/electron/main/host-process.ts:resolveHostBinary`
  行为完全一致

### 风险

- **R1(中)**: 用户升级到本版本后,packaged binary 是 `target/release` 产物。
  若 release profile 与 debug profile 行为有差异(如 panic hook),
  用户可能遇到 dev 模式没暴露的问题。Mitigation:
  CI 已跑 release build 的 smoke test(由 `.github/workflows/rust-host-core.yml`
  的 `rust-cross-release` job 负责)。
- **R2(低)**: 用户已存在 packaged 安装 → 升级时旧 binary 残留。
  Mitigation: 升级流程由 electron-builder `nsis/dmg/AppImage` 自动覆盖,
  无需手动清理。
- **R3(低)**: `cross` 不在 PATH 时脚本静默 fallback 到原生 `cargo`,
  对 Linux x64 OK,对 Windows MSVC 会失败。Mitigation: 脚本输出明确错误,
  README 写明 cross 安装步骤。

## Validation / 验证

- ✅ TS `tsc --noEmit -p packages/runtime/openbuddy-host-runtime/tsconfig.json`
  0 新增错误
- ✅ vitest 6/6 resolve-binary 契约测试全过
- ✅ electron-builder.yml YAML 解析合法 + extraResources 含 host-core 条目
- ⏭️ packaged build 实际启动验证: 需 macOS / Linux / Windows 各自手动跑一次
  `./scripts/electron-builder.sh --mac|linux|win`,本轮**不做**(需要真实 CI runner)

## Migration / 迁移

不需要迁移。改动对用户 0 可见(后台修 bug + 补缺失的 extraResources 条目)。

仅开发者需要在本地重新跑 `./scripts/build-host-core-matrix.sh --all` 来刷新
8 triple 的 release binary,然后跑 `./scripts/electron-builder.sh --mac` 测试 packaged build 启动。
