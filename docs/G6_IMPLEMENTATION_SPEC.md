# G6 实现规格：initTheme / getMarkdownTheme 替换 ui-theme 自实现

> 📅 2026-09-11 · 父任务 LUM-785 · 对应 plan4.1.md §3 Phase D + backlog G6
>
> **状态**：**PR 1 已落地（2026-09-11 Round 11）**：`theme-pi.ts` facade + 5 个 vitest 通过。
>
> **规格校对（重要发现，与 G11 同病）**：spec §2 假设 `initTheme({ baseTokens })` config 对象，但 pi 实际是 positional args；spec §2 假设 `getSettingsListTheme` 存在，但 pi 上游是 `getEditorTheme`；spec §1 假设 ui-theme 200 LOC 自实现 tokens + dark/light CSS，但实际只有 56 LOC 类型 + 130 LOC state mgmt（**没有** token 系统也没有 CSS 切换）。实现策略是**新增 facade** 而非替换：保留现有 ThemeService + client.tsx，新增 `theme-pi.ts` 作为 pi 接入入口。

---

## 0. 一页摘要

| 项 | 值 |
|---|---|
| 当前目录 | `packages/ui/openbuddy-ui-theme/` |
| 自实现规模 | ~200 LOC（theme tokens + dark/light 切换）|
| 涉及 pi API | `initTheme / getMarkdownTheme / getSelectListTheme / getSettingsListTheme` |
| Owner | ui team |
| 估时 | 1 周 |
| 阻塞 | —（独立任务）|
| 风险等级 | 中（视觉一致性是 brand 关键）|

---

## 1. 当前实现盘点

```
packages/ui/openbuddy-ui-theme/
- 自定义 wb-* token system（~80 LOC）
- 自定义 dark/light 切换（~40 LOC）
- 自定义 markdown 渲染颜色（~50 LOC）
- 自定义 select list / settings list 颜色（~30 LOC）
```

## 2. 目标实现

```typescript
// packages/ui/openbuddy-ui-theme/src/index.ts (重写)
import { initTheme, getMarkdownTheme, getSelectListTheme, getSettingsListTheme } from "@earendil-works/pi-coding-agent";

// 1. 用 pi 的 initTheme 替代自实现 token system；保留 --wb-* 作为 base layer
export const theme = initTheme({
  baseTokens: openBuddyWbTokens,  // 保留 OpenBuddy 品牌 token 作为 base
});

// 2. 用 pi 的 getMarkdownTheme 替代自实现 markdown 颜色
export const markdownTheme = getMarkdownTheme(theme);

// 3. 用 pi 的 getSelectListTheme / getSettingsListTheme 替代自实现
export const selectListTheme = getSelectListTheme(theme);
export const settingsListTheme = getSettingsListTheme(theme);
```

**目标 LOC 估算**：~200 LOC → ~80 LOC（保留 wb-* token base layer + 4 个 pi theme 调用）。

## 3. 迁移步骤（2 PR）

### PR 1 — initTheme + token 适配
1. 改 `packages/ui/openbuddy-ui-theme/src/index.ts` 用 pi `initTheme`
2. 自实现 token system ~80 LOC 删除
3. 自实现 dark/light ~40 LOC 删除
4. 跑 vitest + 视觉回归测试

### PR 2 — Markdown / SelectList / SettingsList theme 接管
1. 改 markdown / select list / settings list 渲染用 pi theme
2. 自实现 markdown 颜色 ~50 LOC 删除
3. 自实现 select/settings list ~30 LOC 删除
4. 跑视觉回归：暗/亮模式对比截图

## 4. 测试策略

- 单元：`openbuddy-ui-theme.test.ts`（existing）
- 视觉回归：手工对比 dark/light 截图 + 自动 snapshot test

## 5. 风险评估

| 风险 | 影响 | 触发 | 缓解 |
|---|---|---|---|
| R1 视觉一致性破坏 | brand 损伤 | pi 默认颜色与 wb-* 不同 | wb-* 作为 base layer 保留 |
| R2 dark/light 切换闪烁 | UX 退步 | pi 切换逻辑差异 | 测试 + 双轨 1 周 |
| R3 markdown 渲染颜色差异 | 可读性下降 | pi 默认 markdown 颜色 | 视觉回归测试 |

## 6. 验收命令

```bash
pnpm workspace:test -- openbuddy-ui-theme  # 全过
pnpm test:electron:chat-ui-streaming      # 视觉回归
```

## 7. 与其他 G-gap 关系

- 独立任务；与 G1/G2/G3 无依赖
- 解锁 renderer 端 G4（pi-bridge 渲染走主题）

## 8. 进度更新

`plan4.1.md §3 Phase D` / `docs/PI_INTEGRATION_BACKLOG.md §2 G6` 状态联动。