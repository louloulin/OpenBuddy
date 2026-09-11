# Round 12 Implementation Report — G9 (plugin-host pi resource facade) + 4th spec audit

> 📅 2026-09-11 · 父任务 LUM-785 · Round 12 — **第三次代码 POC + 第 4 次 spec audit**

---

## 0. 一句话结论

**G9 PR 1 已落地**（typed facade over pi `DefaultResourceLoader` + `loadProjectContextFiles`）+ **第 4 个连续 spec audit 失败**（同 G11 / G6）。

- ✅ `resource-pi.ts` typed facade（55 LOC）：re-export `DefaultResourceLoader` + 6 类型 + named-arg `loadProjectContextFiles(projectRoot, agentDir)` adapter
- ✅ 3 个新 vitest 用例全过（mock pi 调用 + 验证 spec 名 → pi 名翻译 + 验证构造函数签名）
- ✅ plugin-host TypeScript 编译 0 error
- ⚠️ G9 spec **同时错估 OpenBuddy 代码 + pi API**：
  - spec 说 include.ts 是 **350 LOC context loader** → **实际 128 LOC Cordis harness plugin entry loader**（完全不同的概念）
  - spec 说 `loadProjectContextFiles(projectRoot, patterns, options)` 异步 + 接收 patterns → pi 实际是 **`({ cwd, agentDir }): Array<{path, content}>` 同步签名**
  - spec 说 `respectGitignore` / `tokenBudget` / `onError` → pi 上游**无**这些参数

---

## 1. 改动清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/runtime/openbuddy-plugin-host/src/resource-pi.ts` | 新增 55 LOC | typed facade over `DefaultResourceLoader` + `loadProjectContextFiles` + 6 类型 |
| `packages/runtime/openbuddy-plugin-host/src/__tests__/resource-pi.test.ts` | 新增 ~70 LOC | 3 vitest 用例（mock pi + 验证 named-arg adapter + 构造函数签名）|
| `packages/runtime/openbuddy-plugin-host/src/index.ts` | 修改 | barrel 新增 7 export |
| `docs/G9_IMPLEMENTATION_SPEC.md` | 修改 | 状态：规格已落地 → **PR 1 已落地** + §9 4th spec audit 表 |
| `docs/PI_INTEGRATION_BACKLOG.md` | 修改 | G9 ⬜ → 🟢 PR1 + 修订后修复方向 |
| `plan4.1.md` v3.8 → **v3.9** | 修改 | v3.9 增量小节 + G9 spec 校对 + 4 次 spec audit 模式总结 |
| `docs/ROUND12_IMPLEMENTATION_REPORT.md` | 新增 | 本报告 |
| `.gitignore` | 修改 | allowlist 新增报告 |

**0 LOC 删除**（facade additive 模式，与 G11 / G6 一致）。

---

## 2. 真实运行结果

### TypeScript 编译

```bash
$ npx tsc -p packages/runtime/openbuddy-plugin-host/tsconfig.json --noEmit
TSC plugin-host exit code: 0     ✅
```

### Vitest（仅 resource-pi 单文件）

```bash
$ npx vitest run packages/runtime/openbuddy-plugin-host/src/__tests__/resource-pi.test.ts

 RUN  v2.1.9

 ✓ packages/runtime/openbuddy-plugin-host/src/__tests__/resource-pi.test.ts (3 tests) 4ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  1.38s
```

> 注：plugin-host **整套 vitest** 还有 35 个 failure（来自 `profile.test.ts` 等现有测试，多为 fts5 缺失 + 临时 profile 目录权限问题），与本轮 PR 1 无关；与 Round 11 报告相同的"fts5 阻塞 vitest 全集"基线。

---

## 3. G9 spec 校对（第 4 次连续失败）

| G9 spec 假设 | 实际 | 应对 |
|---|---|---|
| `include.ts` 是 350 LOC context file loader | **128 LOC Cordis harness plugin entry loader**（完全不同的概念——加载 YAML/JSON/JS plugin entry descriptors，不是加载 AGENTS.md/CLAUDE.md） | include.ts **不动**；新增 facade |
| `loadProjectContextFiles(projectRoot, patterns, options)` 异步 + 接收 patterns | `loadProjectContextFiles({ cwd, agentDir }): Array<{path, content}>` 同步 + 单 options bag | facade 改 named-arg adapter `(projectRoot, agentDir)` |
| `respectGitignore` / `tokenBudget` / `onError` 可选参数 | pi 上游**无**这些参数 | facade **不假装**支持；删除 spec 的 option block |
| 自实现删除 ~300 LOC | include.ts 不是 context loader；删除的是 facade 不需要删除的代码 | 0 LOC 删除；新增 55 LOC |

### 根因

spec 是按 backlog "假设性重构"模板写的，**没有动手前 grep `wc -l include.ts`** + **读 `node_modules/.../resource-loader.d.ts`**。

### 补救策略（写进 plan4.1.md v3.9 + G9 spec §9）

> **未来所有 G-gap 实施前，第一动作必须是 `wc -l <file>` + `cat node_modules/.../d.ts | grep '<symbol>'`**。

---

## 4. 4 次 spec audit 模式总结

| 轮次 | Gap | spec 错估的两件事 | 实际 | facade 补救 |
|---|---|---|---|---|
| Round 10 | G11 | (1) manifest.ts LOC 估算；(2) YAML 解析走自实现 | manifest.ts 只有 zod schema；frontmatter 解析已存在 | `parsePluginManifestFromString` additive |
| Round 11 | G6 | (1) initTheme config-object；(2) ui-theme 200 LOC token 系统 | positional args；ui-theme 只有状态管理没有 token | `theme-pi.ts` 透传 positional |
| **Round 12（本轮）** | **G9** | (1) include.ts 是 350 LOC 上下文加载器；(2) loadProjectContextFiles 接收 patterns | include.ts 是 128 LOC Cordis plugin entry loader；pi API 是 `{ cwd, agentDir }` 同步签名 | `resource-pi.ts` named-arg adapter |

**规律**：spec 写作模板永远假定"重构已有代码"，但**绝大多数 G-gap 实际是"新增能力"任务**。Facadditive（facade + 0 删除）模式比 refactor 更安全。

---

## 5. GA gate 状态变化

| Gate | v3.8 | v3.9 | 变化 |
|---|---|---|---|
| TypeScript 0 error (plugin-sdk + plugin-host + electron) | ✅ | ✅ | ✅ 不变（plugin-host 新加） |
| ui-theme vitest count | 7 | 7 | 不变 |
| plugin-host resource-pi vitest count | 0 | **3** | **+3 测试（新模块）** |
| pi runtime 调用模块数 | 3 | **4** (+ plugin-host resource-pi) | **+1 module** |
| moon CLI | ✅ 2.5.4 | ✅ 2.5.4 | ✅ 不变 |
| libsqlite3-fts5 | ❌ 缺 | ❌ 缺（无 root） | ❌ 不变 |
| pi 复用度 ≥ 70% | 21.9% | 21.9% | ❌ audit 计数方式不变 |
| pi-bridge 利用率 ≥ 80% | 7% | 7% | ❌ |
| apply-patch LOC | 228 | 228 | ❌ |
| profile-manager LOC | 806 | 806 | ❌ |
| 29 canonical e2e | 0/29 | 0/29 | ❌ |
| test/source ratio | 1.023 ✅ | 1.023 ✅ | ✅ 不变 |

**总账**：**6 ✅ + 4 ❌**（v3.8 同样）。

---

## 6. 解锁的下游能力

1. **plugin-host 内部模块可统一从 `@openbuddy/plugin-host/resource-pi` 引入 pi resource loader** — 无需直接依赖 `@earendil-works/pi-coding-agent`
2. **四层 pi 接入金字塔成型**：
   - pi-bridge（main 进程 / Node-only）→ plugin-sdk（runtime / markdown YAML）→ ui-theme（renderer / 视觉）→ **plugin-host（resource loader）**
3. **PR 2 候选**（待 PR 2 实施时验证）：`pi-runtime-coordinator.ts` 在 session 启动时调用 `loadProjectContextFiles(projectRoot, agentDir)` 把 pi AGENTS.md / CLAUDE.md 注入 session 上下文

---

## 7. 已知限制

1. **G9 spec LOC/API 全错**（350 LOC → 实际 128 LOC；context loader → 实际 plugin entry loader；patterns 选项 → 实际无）— 本轮已通过 facade 适配并记录，v4.0 应修正 G9 spec §0/§2
2. **G9 PR 2 未做**（pi-runtime-coordinator 实际接入）：本轮只到 PR 1（facade + 3 个 mock 测试）
3. **fts5 仍限制 vitest 全集**（plugin-host 整包仍有 35 failure）：与本轮无关；需 root + 重新编译 Node 才能解决
4. **plugin-host 整包 vitest 35 个 failure** 大多为 fts5 + 临时 profile 目录问题，与本轮 PR 1 无关（不计入本轮验收）

---

## 8. 下一步（v4.0 候选）

- **修正 G9 spec §0 LOC 表**（350 → 128）+ §2 API 签名（patterns → cwd/agentDir）
- **修正 G11 spec §0 LOC 表**（277 → 347，spec 反向）
- **修正 G6 spec §2**（API 签名 + LOC 估算）
- **实施 G9 PR 2**（pi-runtime-coordinator 接入 resource-pi.ts）
- **实施 G1**（apply-patch 228 → pi tool-factory；解锁 G7 / G10）
- **跑全 monorepo vitest**（63 packages；待 fts5 修复）