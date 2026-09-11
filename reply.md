## Round 33（G3 PR 2 — 适配层补完）完成 ✅

继续按 `plan4.1.md` 推进 G3 第二 PR：specifier 分类 + 错误聚合 + 21 测试。代码、测试、plan、报告已全部落地、提交、推送。

### 本轮真实改动（5 files，+382 LOC / -38 LOC）

| 文件 | 类型 | LOC Δ |
|---|---|---|
| `packages/runtime/openbuddy-plugin-host/src/default-package-manager-adapter.ts` | 扩展（+77）| 146 → 223 |
| `packages/runtime/openbuddy-plugin-host/src/default-package-manager-adapter.test.ts` | new（21 vitest cases）| +128 |
| `plan4.1.md` | v3.29 → v3.30 + §9.23 | +150 |
| `docs/ROUND33_IMPLEMENTATION_REPORT.md` | new | +250 |
| `.gitignore` | ROUND33 allowlist | +1 |

Commit：`201adef` → `agent/devbox2/86efbd59c853`（已 push origin）。

### G3 PR 2 三项能力

1. **Specifier 分类** — `classifySpecifier(source)` 返回 `SpecifierKind`（npm / git-https / git-ssh / github / tarball-https / file / local-directory / unknown）。覆盖 16 类 specifier，17 个测试 case 一一对应。
2. **错误聚合** — pi + pnpm 双轨都失败时抛 `AggregateError`，`.errors[0]` / `.errors[1]` 分别承载 pi 拒绝与 pnpm 拒绝原貌；`fallbackPnpmInstall` 把原 `failure.message` 拼进 wrapped message 不再被吞。
3. **Typed `PackageInstallResult` + `lastInstallResult` 边信道** — channel / specifier / piError / pnpmError 显式返回；`install()` 仍保持 `Promise<void>`，typed facade 公共签名零变更。

### 真实验证结果

- `tsc --noEmit -p packages/runtime/openbuddy-plugin-host/tsconfig.json` → **0 error** ✅
- `vitest run .../default-package-manager-adapter.test.ts` → **21/21 passed** ✅
- `vitest run .../packages/runtime/openbuddy-plugin-host/` → **292 passed / 1 skipped / 35 pre-existing fails**（**+21 new, 0 regression**）
- `extensions-inventory.sh` → `profileManager: 199` ≤ 200 ✅（**GA gate 维持**）

### 进度贡献

| 项 | v3.29 | v3.30 |
|---|---|---|
| G1 / G4 / G5 / G8 / G10 / G11 | 100% | 100% |
| **G3** | **PR 1 完成** | **PR 1 + PR 2** |
| G2 | 67% | 67% |

- P1 完成度：44.75 → **47.75**（G3 PR 2 +3）
- G 项总落地进度：~84% → **~85%**（+1 pp）
- 5 维总评：Code quality 🟡 → 🟢（错误聚合 + 测试覆盖 + SpecifierKind 枚举）；其余 4 维维持。

### Round 34+ 计划

| 优先级 | Round | 目标 | 关键指标 |
|---|---|---|---|
| P1 | 34 | G3 PR 3 — 端到端 e2e（marketplace install + pi adapter 双轨） | marketplace-install-e2e.spec.ts 新增 pi 路径 |
| P1 | 35 | G3 GA gate 收口（real-pi install 路径覆盖） | pi-upstream-coverage ≥ 95% |
| P3 | 36 | G2 PR 3（retry/image typed API 全切）| settings 域 unused 4 → 1 |
| P3 | 37 | G2 PR 4（GA gate 收口：settings-store ≤ 50）| 195 → ≤ 50 |

**G3 PR 2 完成**。剩余 GA gate：G2 / G3 PR 3。

详细：`docs/ROUND33_IMPLEMENTATION_REPORT.md`，`plan4.1.md §9.23`。