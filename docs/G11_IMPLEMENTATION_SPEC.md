# G11 实现规格：plugin manifest 解析切到 pi parseFrontmatter

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase D + backlog G11
>
> 本文档是 **Phase D 子项**，把 `packages/runtime/openbuddy-plugin-sdk/src/manifest.ts`
> 自实现 YAML frontmatter 解析切到 pi `parseFrontmatter`。
>
> **状态**：规格已落地（2026-09-11 Round 8）。代码改动需 dev-env + 真实 plugin 安装链路。
> **关联 audit**：`scripts/audit/pi-bridge-dead-channels.sh`（Round 4，G4.1 是 renderer 入口）。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前文件 | `packages/runtime/openbuddy-plugin-sdk/src/manifest.ts`（277 LOC）|
| 自实现 YAML 解析 | ~80 LOC（frontmatter split + zod schema）|
| 涉及 pi API | `parseFrontmatter`（pi-coding-agent）+ `stripFrontmatter` |
| Owner | runtime team |
| 估时 | 1 周 |
| 阻塞 | **依赖 G4.1**（renderer 端先在 bridge.text.stripFrontmatter 跑通）|
| 风险等级 | 低（typed facade 模式，schema 已 zod 化）|

---

## 1. 当前实现盘点（manifest.ts）

来源：`grep -nE "^(export|function|class|interface|type)" packages/runtime/openbuddy-plugin-sdk/src/manifest.ts`

```
32  export { OPENBUDDY_PLUGIN_PROTOCOL, OPENBUDDY_PLUGIN_SCHEMA };
83  export const manifestCoreSchema = z          // ~30 LOC（zod schema）
113 export const pluginManifestSchema = manifestCoreSchema;
115 export type PluginManifestInput
118 export const packageJsonShapeSchema = z      // ~10 LOC
132 export class PluginManifestError
145 function issuesToStrings(error: z.ZodError)
152 function toSerializable(parsed)
169 export function detectTracks(input)           // track 检测
184 export function parsePluginManifest(...)     // 主入口：split frontmatter + zod parse
206 export function parsePluginPackageJson(...)
277 export function parseSlotContribution(...)
```

**自实现 frontmatter 分割**（约 80 LOC）：
1. 行扫描 `---\n` 边界（~20 LOC）
2. YAML 解析（~30 LOC）
3. body 拆分（~10 LOC）
4. 错误处理 + zod 校验（~20 LOC）

## 2. 目标实现

**核心策略**：用 pi `parseFrontmatter` 替换自实现 YAML 边界扫描；zod schema 保留。

```typescript
// packages/runtime/openbuddy-plugin-sdk/src/manifest.ts (重写内部)
import { parseFrontmatter, stripFrontmatter } from "@earendil-works/pi-coding-agent";

export function parsePluginManifest(content: string, options?: ParseOptions): OpenBuddyPluginManifest {
  // 1. 用 pi 的 parseFrontmatter 替代自实现
  const { frontmatter, body } = parseFrontmatter(content);
  const parsed = manifestCoreSchema.safeParse(frontmatter);
  if (!parsed.success) throw new PluginManifestError(issuesToStrings(parsed.error));
  return toSerializable({ ...parsed.data, body });
}
```

**目标 LOC 估算**：80 LOC → ~30 LOC（删除自实现 YAML 解析）；277 LOC 总数可能微减（核心算法变薄，但 zod schema 保留）。

## 3. 迁移步骤（2 PR）

### PR 1 — parseFrontmatter 接入（保留 facade）
1. 改 `parsePluginManifest` 内部用 pi `parseFrontmatter`
2. 自实现 YAML 解析（~80 LOC）删除
3. 跑 vitest：`packages/runtime/openbuddy-plugin-sdk/src/__tests__/manifest.test.ts` 全过
4. 跑 `pnpm test:electron:marketplace-install-e2e`：插件 manifest 解析路径正常

### PR 2 — stripFrontmatter 工具导出
1. 加 `stripFrontmatter(content)` re-export pi 实现（替换自实现）
2. 在 `slot-contribution.ts` 等下游调用方切到新导出
3. 跑 vitest：plugin slot 贡献解析全过

## 4. 测试策略

| 测试类型 | 文件 | 数量 |
|---|---|---|
| 现有单元（保留） | `manifest.test.ts`（existing）| ~12 |
| 迁移（PR 1）| `parsePluginManifest.test.ts` | +5（frontmatter edge cases）|
| 集成（PR 1）| `marketplace-install-e2e.spec.ts` | 现有 |

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 pi `parseFrontmatter` 与 OpenBuddy 自实现语义差异 | manifest 解析失败 | pi 0.85.x 边界处理 | PR 1 用 vitest 现有 12 case 全过为硬门槛 |
| R2 frontmatter 不存在时报错信息不友好 | UX 退步 | 用户写错 manifest | 保留 zod error 转换 |
| R3 pi YAML 解析 vs js-yaml 默认差异 | 第三方 plugin 解析失败 | pi 用更严格的 YAML | 提供 `legacyYamlCompat: true` 选项 |

## 6. 验收命令（自动）

```bash
# 1. 单元测试
pnpm workspace:test -- packages/runtime/openbuddy-plugin-sdk/src/__tests__/manifest.test.ts  # 全过

# 2. 集成 e2e
pnpm test:electron:marketplace-install-e2e  # 全过

# 3. GA gate（间接）
bash scripts/audit/pi-bridge-dead-channels.sh --json | jq '.covered'   # G4.1 完成后 +1
```

## 7. 与其他 G-gap 关系

- **依赖 G4.1**（renderer 端 `bridge.text.stripFrontmatter`）：renderer 端先在 IPC 跑通 parseFrontmatter，main 端 G11 才能复用相同 pi API。
- **解锁 G3**（profile-manager）：plugin 安装流程的 manifest 解析稳定后，profile-manager 才能接管。
- **解锁 G8**（29 canonical e2e）：每个 canonical pi 包的 manifest 解析都依赖 G11。

## 8. 进度更新

实施完成时：
1. `plan4.1.md §3 Phase D` 状态：`⬜ → 🟡 → ✅`
2. `docs/PI_INTEGRATION_BACKLOG.md §1 G11` 状态：`⬜ → 🟡 → ✅`
3. 本规格 §0 状态：`规格已落地 → 实施完成 → 合并`