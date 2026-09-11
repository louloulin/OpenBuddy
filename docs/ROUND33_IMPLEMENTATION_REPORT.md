# Round 33 Implementation Report — G3 PR 2 适配层补完, specifier 分类 + 错误聚合 (LUM-785, 2026-09-11)

## Round 33 真实落地的功能

### 1. G3 PR 2 — 适配层补完（specifier 分类 + 错误聚合 + 测试）

**改动**（2 files，profile-manager.ts 仍 199 LOC ≤ 200 GA gate ✅）：

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `packages/runtime/openbuddy-plugin-host/src/default-package-manager-adapter.ts` | 扩展（classifySpecifier + PackageInstallResult + lastInstallResult + AggregateError）| 146 → 223（+77；含 JSDoc 与 typed API）|
| `packages/runtime/openbuddy-plugin-host/src/default-package-manager-adapter.test.ts` | new（21 vitest cases：17 specifier + 4 install 编排）| +128 |

**profile-manager.ts 仍 199 LOC**（GA gate 维持） ✅

### 2. Specifier 分类（classifySpecifier）

```typescript
export type SpecifierKind =
  | "npm" | "git-https" | "git-ssh" | "github"
  | "tarball-https" | "file" | "local-directory" | "unknown";
```

**覆盖 16 类 specifier**（17 个测试 case）：
- `npm:foo@1.0.0` / `@org/foo@1.0.0` / `plain-name` → `npm`
- `git+https://github.com/x/y.git` / `https://example.com/x.git` → `git-https`
- `git+ssh://git@github.com/x/y.git` / `git@github.com:x/y.git` → `git-ssh`
- `github:owner/repo` → `github`
- `tarball-https://example.com/x.tgz` / `tarball+https://...` / `https://example.com/x.tgz` / `...x.tar.gz` → `tarball-https`
- `file:../local-plugin` → `file`
- `./local-plugin` / `../shared-plugin` / `/abs/path/plugin` → `local-directory`
- `""` / `"!!!"` → `unknown`

### 3. PackageInstallResult + lastInstallResult

```typescript
export interface PackageInstallResult {
  ok: boolean;
  channel: "pi" | "pnpm-fallback" | "both-failed";
  specifier: SpecifierKind;
  piError?: string;
  pnpmError?: string;
}

export let lastInstallResult: PackageInstallResult | undefined;
```

**为什么需要 side-channel**：`ProfilePackageManager.install` 的公共签名是 `Promise<void>`（保持 typed facade 稳定）；executor 想看 channel/specier 用 `lastInstallResult`，**0 公共 API 变更**。

### 4. AggregateError 错误聚合

```typescript
function aggregateInstallErrors(specifier, source, piError, pnpmError): AggregateError {
  const summary = `profile-package: install failed for ${source} (${specifier}); pi="${piMessage}"; pnpm="${pnpmMessage}"`;
  return new AggregateError([piError, pnpmError], summary);
}
```

**`fallbackPnpmInstall` 改进**：原 execFile 错误被包成 `profile-package: pnpm add failed for ...` 但 stderr/stdout 会被吞。本 PR 把 `failure.message` 拼进 wrapped message，**保留原始信息 + `cause`**。

**`install` 流程**：
1. classifySpecifier(source)
2. try `pm.install(source, { local: true })` → lastInstallResult = `{ ok: true, channel: "pi", specifier }` + return
3. catch → try `fallbackPnpmInstall(...)` → lastInstallResult = `{ ok: true, channel: "pnpm-fallback", specifier, piError }` + return
4. catch → lastInstallResult = `{ ok: false, channel: "both-failed", specifier, piError, pnpmError }` + throw AggregateError

### 5. 测试覆盖（21 vitest cases）

```bash
$ npx vitest run packages/runtime/openbuddy-plugin-host/src/default-package-manager-adapter.test.ts
 ✓ default-package-manager-adapter.test.ts (21 tests) 18ms
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

**4 个 install 编排测试**：
1. pi 成功 → lastInstallResult = `{ channel: "pi", specifier: "npm" }`
2. pi 拒绝 → fallback pnpm → lastInstallResult = `{ channel: "pnpm-fallback", specifier: "git-https", piError: "..." }`
3. pi + pnpm 都失败 → 抛 `AggregateError`，`.errors[0]` 是 pi 错误，`.errors[1]` 是 pnpm 错误
4. specifier 落到 `lastInstallResult.specifier = "tarball-https"`（验证 tarball-https scheme 分类正确）

### 6. 真实验证结果

- `tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit` → **0 error** ✅
- `vitest run packages/runtime/openbuddy-plugin-host/src/default-package-manager-adapter.test.ts` → **21/21 passed** ✅
- `vitest run packages/runtime/openbuddy-plugin-host/` → **292 passed / 1 skipped / 35 pre-existing fails**（**+21 new, 0 regression**）
- `bash scripts/audit/extensions-inventory.sh --json` → `profileManager: 199` ≤ 200 ✅（**GA gate 维持**）

### 7. 5 维总评变化（v3.29 → v3.30）

| 维度 | v3.29 | v3.30 |
|---|---|---|
| Pi-native utilization | 🟢 | 🟢 |
| Performance | 🟡 | 🟡 |
| Code quality | 🟡 | 🟢（错误聚合 + 测试覆盖 + 显式 SpecifierKind 枚举） |
| Settings plumbed | 🟡 | 🟡 |
| GA gate | 🟢 | 🟢 |

### 8. 进度贡献

| 项 | v3.29 | v3.30 |
|---|---|---|
| G1 / G4 / G5 / G8 / G10 / G11 | 100% | 100% |
| **G3** | **PR 1 完成（typed facade）** | **PR 1 + PR 2（specifier 分类 + 错误聚合 + 21 测试）** |
| G2 | 67% | 67% |

P1 完成度：44.75 → **47.75**（G3 PR 2 +3）
G 项落地总进度：~84% → **~85%**（+1 pp）

### 9. Round 33 真实改动清单

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `packages/runtime/openbuddy-plugin-host/src/default-package-manager-adapter.ts` | 扩展（+77）| 146 → 223 |
| `packages/runtime/openbuddy-plugin-host/src/default-package-manager-adapter.test.ts` | new（21 tests）| +128 |
| `plan4.1.md` | v3.29 → v3.30 + §9.23 | +150 |
| `docs/ROUND33_IMPLEMENTATION_REPORT.md` | new | +250（本文件）|
| `.gitignore` | allowlist | +1 |
| **总计** | | **5 files, +606** |

### 10. 已知限制

1. **adapter 223 LOC 超 180 LOC 目标**：本 PR 把 typed SpecifierKind + 测试 + JSDoc 全加了；如要 ≤ 180 可把 specifier regex 抽到 `specifier-kinds.ts`（下一轮可做）
2. **`tarball-` scheme 仅匹配前缀**：`tarball://` / `tarball+https://` 都识别，但内部 `realpath`/`sha256` 校验未实现（依赖 pi 的 install 实现）
3. **`AggregateError` 是 ES2021**：Node 18+ 完全支持；如果 openbuddy 还要支持 Node 16，需要 polyfill
4. **35 个 vitest fail 仍是 pre-existing**：与本 PR 无关

### 11. Round 34+ 计划

| Round | 目标 | 关键指标 |
|---|---|---|
| 34 | G3 PR 3 — 端到端 e2e（marketplace install + pi adapter 双轨）| marketplace-install-e2e.spec.ts 新增 pi 路径 |
| 35 | G3 GA gate 收口（real-pi install 路径覆盖） | pi-upstream-coverage ≥ 95% |
| 36 | G2 PR 3（retry/image typed API 全切）| settings 域 unused 4 → 1 |
| 37 | G2 PR 4（GA gate 收口：settings-store ≤ 50）| 195 → ≤ 50 |

**G3 PR 2 完成**（typed facade + DefaultPackageManager + 适配层补完 + 21 测试）。剩余 GA gate：G2 / G3 PR 3。