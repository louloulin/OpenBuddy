# Round 10 Implementation Report — G11 首次代码落地 (parsePluginManifestFromString)

> 📅 2026-09-11 · 父任务 LUM-785 · Round 10 — **首次按 G*_IMPLEMENTATION_SPEC.md 实际修改业务代码**

---

## 0. 一句话结论

**G11（plugin manifest 切 pi parseFrontmatter）PR 1 已落地**：

- ✅ 新增 `parsePluginManifestFromString(content, options?)` 函数（用 pi `parseFrontmatter`）
- ✅ Re-export `parseFrontmatter` + `stripFrontmatter`（plugin-sdk 层首次 runtime 接 pi）
- ✅ 8 个新 vitest 用例全过（manifest.test.ts 11 → 19 tests）
- ✅ plugin-sdk 全 4 个 test files 全过（manifest 19 + serializer 8 + fixtures 2 + index 3 = **32 tests**）
- ✅ TypeScript: plugin-sdk + electron 双 0 error
- ⚠️ G11 spec 的 LOC 估算反向（277 → 347，**+70**）——spec 假设错了代码现状（实际无 YAML 解析代码）

---

## 1. 改动清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/runtime/openbuddy-plugin-sdk/src/manifest.ts` | 修改 | +3 import (pi parseFrontmatter/stripFrontmatter) + 2 re-export + `ParsePluginManifestFromStringOptions` 类型 + `parsePluginManifestFromString()` 函数 |
| `packages/runtime/openbuddy-plugin-sdk/src/index.ts` | 修改 | barrel 新增 `parsePluginManifestFromString` + `parseFrontmatter` + `stripFrontmatter` + `ParsePluginManifestFromStringOptions` 导出 |
| `packages/runtime/openbuddy-plugin-sdk/src/__tests__/manifest.test.ts` | 修改 | 新增 8 个 vitest 用例（markdown frontmatter 解析全场景）|
| `plan4.1.md` | 修改 | v3.6 → **v3.7** + G11 PR1 落地状态 + GA gate 变化 |
| `docs/G11_IMPLEMENTATION_SPEC.md` | 修改 | 顶部状态更新（规格已落地 → **PR 1 已落地**）+ spec 反向说明 |
| `docs/PI_INTEGRATION_BACKLOG.md` | 修改 | G11 状态 `⬜` → `🟢 PR1` + 落地详情 |
| `docs/ROUND10_IMPLEMENTATION_REPORT.md` | 新增 | 本报告 |

---

## 2. 真实运行结果

### TypeScript 编译

```bash
$ node_modules/.bin/tsc -p packages/runtime/openbuddy-plugin-sdk/tsconfig.json --noEmit
TSC plugin-sdk exit code: 0     ✅

$ node_modules/.bin/tsc -p electron/tsconfig.json --noEmit
TSC electron exit code: 0     ✅
```

### Vitest (plugin-sdk 全 4 test files)

```bash
$ node_modules/.bin/vitest run packages/runtime/openbuddy-plugin-sdk/src/__tests__/

 RUN  v2.1.9

 ✓ packages/runtime/openbuddy-plugin-sdk/src/__tests__/manifest.test.ts  (19 tests) 27ms
 ✓ packages/runtime/openbuddy-plugin-sdk/src/__tests__/serializer.test.ts  (8 tests) 12ms
 ✓ packages/runtime/openbuddy-plugin-sdk/src/__tests__/fixtures.test.ts    (2 tests) 10ms
 ✓ packages/runtime/openbuddy-plugin-sdk/src/__tests__/index.test.ts      (3 tests)  6ms

 Test Files  4 passed (4)
      Tests  32 passed (32)
   Duration  7.77s
```

**对比 Round 9 baseline**：plugin-sdk test count 24 → **32**（+8 新增，全是 G11 frontmatter path）。

---

## 3. G11 spec 校对（重要发现）

| spec 假设 | 实际 | 应对 |
|---|---|---|
| "替换 80 LOC 自实现 YAML frontmatter" | manifest.ts **从未写过** YAML 解析；只接 JSON 对象 | 实现策略改为**新增能力**而非替换 |
| "PR 1 parsePluginManifest(content: string) 改签名" | 现有签名 `(raw: unknown)` 被 serializer + index 全链路使用，改签名破坏全链路 | 新增 `parsePluginManifestFromString(content)` 函数；旧 `parsePluginManifest(raw)` 签名零变化 | 
| "manifest.ts 277 → 210 LOC" | 实际 277 → 347（**+70**） | spec LOC 表反向：新增 70 LOC（parsePluginManifestFromString ~70 + re-export 2 行）|

**结论**：spec 假设错了代码现状。**业务代码之前根本没碰过 YAML**（OpenBuddy plugin manifest 一律走 JSON 对象）。G11 的真实价值是 **让 plugin-sdk 与 pi agent SDK 共享同一 frontmatter 格式**（.md + YAML 块），让 marketplace 可以接受 markdown-style plugin files。

---

## 4. 新增 pi runtime 接入（plugin-sdk 层首次）

之前 plugin-sdk 通过 pi 接入只有 **types-only**：
```typescript
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
```

现在新增 **运行时调用**：
```typescript
import {
  parseFrontmatter as piParseFrontmatter,
  stripFrontmatter as piStripFrontmatter,
} from "@earendil-works/pi-coding-agent";

export const parseFrontmatter = piParseFrontmatter;
export const stripFrontmatter = piStripFrontmatter;

export function parsePluginManifestFromString(content: string, options?): OpenBuddySerializablePlugin {
  const { frontmatter, body } = piParseFrontmatter(content);
  // ... zod 校验 + track 检测 + toSerializable
}
```

**对齐 pi pattern**：`electron/main/agent/pi-bridge/text-utils.ts` 用相同的 `as pi*` 重命名 + re-export 模式（避免下游硬依赖 pi 包）。

---

## 5. GA gate 状态变化

| Gate | v3.6 | v3.7 | 变化 |
|---|---|---|---|
| TypeScript 0 error (plugin-sdk) | ✅ | ✅ | ✅ 不变 |
| TypeScript 0 error (electron) | ✅ | ✅ | ✅ 不变 |
| plugin-sdk vitest count | 24 | **32** | **+8** |
| pi runtime 调用模块数 | 1 (pi-bridge) | **2** (pi-bridge + plugin-sdk) | **+1** |
| manifest.ts LOC | 277 | 347 | +70（spec 反向）|
| pi 复用度 ≥ 70% | 21.9% | 21.9% | ❌ audit 计数方式不变 |
| pi-bridge 利用率 ≥ 80% | 7% | 7% | ❌ |
| apply-patch LOC | 228 | 228 | ❌ |
| profile-manager LOC | 806 | 806 | ❌ |
| 29 canonical e2e | 0/29 | 0/29 | ❌ |
| test/source ratio | 1.023 ✅ | 1.023 ✅ | ✅ 不变 |

**总账**：**5 ✅ + 5 ❌**（v3.6 是 4 ✅ + 5 ❌ + 1 ⏳；plugin-sdk vitest count 从 24 → 32）。

---

## 6. 解锁的下游能力

1. **marketplace 安装链路**可以接受 `PLUGIN.md`（frontmatter + markdown body）作为 manifest source — 不再要求 npm 包有 `plugin.json`
2. **plugin-sdk 消费方**（`electron/main/marketplace/...` 等）可调用 `parsePluginManifestFromString` 替代 JSON 解析路径
3. **OpenBuddy plugin SDK 与 pi agent SDK 共享同一 frontmatter 格式**（.md + YAML 块）— 用户写 plugin 和 agent 用同一套语法

---

## 7. 已知限制

1. G11 spec §0 的 LOC 估算（277 → 210）**反向**：实际 +70。spec 表未修正（v3.8 待办）
2. G11 完整 PR（marketplace-install-e2e 跑通）待 dev-env 实跑
3. 商业应用（marketplace UI 用 `body` 渲染 README）尚未对接 — 仅 SDK 层就位
4. fts5 仍限制 vitest 全集（与本轮无关）

---

## 8. 下一步（v3.8 候选）

- 修正 G11 spec §0 LOC 表（277 → 347）
- 实施 G1（apply-patch 228 → pi tool-factory）— G11 PR 1 已解锁该工作的依赖
- 跑 `marketplace-install-e2e` 真实链路（需 dev-env）
- 全 monorepo vitest（63 packages，待 fts5 修复）