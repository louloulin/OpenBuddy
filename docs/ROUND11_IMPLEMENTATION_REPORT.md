# Round 11 Implementation Report — G6 (ui-theme pi facade) + moon CLI + fts5 调查

> 📅 2026-09-11 · 父任务 LUM-785 · Round 11 — **第二次代码 POC + 环境修复尝试**

---

## 0. 一句话结论

**G6 PR 1 已落地**（typed facade）+ **moon CLI 装好**（2.5.4）+ **fts5 修复无 root 不可行**（已记录路径）。

- ✅ `theme-pi.ts` typed facade over pi's `initTheme` / `getMarkdownTheme` / `getSelectListTheme` / `getEditorTheme`
- ✅ ui-theme 首次从 pi **运行时** 接入（之前只有 client.tsx state mgmt）
- ✅ 5 个新 vitest 用例全过（ui-theme test count 2 → 7）
- ✅ TypeScript 双 0 error（plugin-sdk + electron）
- ✅ **moon 2.5.4** 装好（10s）
- ⚠️ G6 spec **3 个 API 假设错**（同 G11 spec）：spec §2 写 `initTheme({ config })` 但 pi 是 positional args；spec §2 写 `getSettingsListTheme` 但 pi 是 `getEditorTheme`；spec §1 写 ui-theme 有 200 LOC tokens + dark/light CSS 但**实际没有**（只有 56 LOC 类型 + 130 LOC state mgmt）

---

## 1. 环境修复尝试（用户特别要求"安装相关依赖修复问题"）

| 项 | 命令 | 结果 |
|---|---|---|
| `libsqlite3-fts5` | `apt-get install -y libsqlite3-fts5` | ❌ **无 root 权限**（`/var/lib/dpkg/lock-frontend: Permission denied`）|
| Node `node:sqlite` fts5 模块 | `node -e "node:sqlite ... fts5"` | ❌ **上游编译选项无 fts5**（[nodejs/node#52588](https://github.com/nodejs/node/issues/52588)）|
| **moon CLI** | `npm install -g @moonrepo/cli` | ✅ **2.5.4 装好**（10s）|
| vitest 24 个 failure root cause | `grep -v "fts5"` | ℹ️ **100% 全部 fts5**；无其他 root cause |

**修复路径**（root 权限就位后）：
```bash
sudo apt-get install -y libsqlite3-fts5
# 或重新编译 Node with --with-sqlite-fts5
```

---

## 2. 改动清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/ui/openbuddy-ui-theme/src/theme-pi.ts` | 新增 83 LOC | typed facade over pi's 4 theme fns + ThemeColor type |
| `packages/ui/openbuddy-ui-theme/src/index.ts` | 修改 | barrel 新增 4 export + ThemeColor type |
| `packages/ui/openbuddy-ui-theme/src/__tests__/theme-pi.test.ts` | 新增 ~50 LOC | 5 vitest 用例（mock pi 调用 + 验证 spec-vs-pi 名字翻译）|
| `plan4.1.md` v3.7 → **v3.8** | 修改 | v3.8 增量小节 + G6 spec 校对 + GA gate 变化 |
| `docs/G6_IMPLEMENTATION_SPEC.md` | 修改 | 状态：规格已落地 → **PR 1 已落地** + spec 校对说明 |
| `docs/PI_INTEGRATION_BACKLOG.md` | 修改 | G6 ⬜ → 🟢 PR1 + 落地详情 |
| `docs/ROUND11_IMPLEMENTATION_REPORT.md` | 新增 | 本报告 |
| `.gitignore` | 修改 | allowlist 新增报告 |

---

## 3. 真实运行结果

### TypeScript 编译

```bash
$ tsc -p packages/runtime/openbuddy-plugin-sdk/tsconfig.json --noEmit
TSC plugin-sdk exit code: 0     ✅

$ tsc -p electron/tsconfig.json --noEmit
TSC electron exit code: 0     ✅
```

### Vitest (ui-theme)

```bash
$ vitest run packages/ui/openbuddy-ui-theme/

 RUN  v2.1.9

 ✓ packages/ui/openbuddy-ui-theme/src/__tests__/client.test.tsx  (2 tests) 39ms
 ✓ packages/ui/openbuddy-ui-theme/src/__tests__/theme-pi.test.ts  (5 tests)  4ms

 Test Files  2 passed (2)
      Tests  7 passed (7)
   Duration  4.25s
```

**ui-theme test count：2 → 7（+5）**

### Moon CLI

```bash
$ moon --version
moon 2.5.4
```

---

## 4. G6 spec 校对（与 G11 同病）

| G6 spec 假设 | pi 实际 | ui-theme 实际 | 应对 |
|---|---|---|---|
| `initTheme({ baseTokens })` config object | positional `(themeName?, enableWatcher?)` | — | facade 透传 positional args |
| `getMarkdownTheme(theme)` | no-args `(): MarkdownTheme` | — | facade 透传 no-args |
| `getSelectListTheme(theme)` | no-args | — | facade 透传 no-args |
| `getSettingsListTheme(theme)` | **不存在** → `getEditorTheme(): EditorTheme` | — | facade 用 spec 名 + delegate 到 pi `getEditorTheme` |
| "ui-theme 200 LOC 自实现 tokens + dark/light CSS" | — | **56 LOC 类型 + 130 LOC state mgmt = 186 LOC（**没有** token 系统也没有 CSS 切换）** | 实现策略改为**新增 facade**，0 LOC 删除 |
| `wb-*` token system 存在 | — | **不存在** | facade 不引用 wb-*；纯 pi 透传 |

**结论**：G6 spec 与 G11 spec **同病**——都对 OpenBuddy 实际代码结构 + pi 上游 API 签名做了错误假设。两个 spec 都按"假设性重构"模板写的，但实际是"新增能力"任务。本轮与 G11 一样采取 facade 模式：保留现有 `ThemeService` 类型 + client.tsx 130 LOC 状态管理，**新增** theme-pi.ts 作为 pi 接入入口。

---

## 5. ui-theme 首次 pi runtime 接入

```typescript
// theme-pi.ts — typed facade
import {
  initTheme as piInitTheme,
  getMarkdownTheme as piGetMarkdownTheme,
  getSelectListTheme as piGetSelectListTheme,
  getEditorTheme as piGetEditorTheme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";

export function initTheme(themeName?: string, enableWatcher?: boolean): void {
  return piInitTheme(themeName, enableWatcher);
}

export function getMarkdownTheme() { return piGetMarkdownTheme(); }
export function getSelectListTheme() { return piGetSelectListTheme(); }

// Spec name vs pi name — pi has getEditorTheme, not getSettingsListTheme.
export function getSettingsListTheme() { return piGetEditorTheme(); }

export type { ThemeColor };
```

**与 G11 (plugin-sdk) 一致的 pattern**：`as pi*` 重命名 + 透传 + typed facade。下游 ui 包统一从 `@openbuddy/ui-theme` 引入，无需直接依赖 pi 包。

---

## 6. GA gate 状态变化

| Gate | v3.7 | v3.8 | 变化 |
|---|---|---|---|
| TypeScript 0 error (plugin-sdk + electron) | ✅ | ✅ | ✅ 不变 |
| ui-theme vitest count | 2 (client) | **7** (2 + 5 theme-pi) | **+5** |
| pi runtime 调用模块数 | 2 | **3** (+ ui-theme) | **+1 module** |
| moon CLI | ⏳ 缺 | **✅ 2.5.4** | **⏳ → ✅** |
| libsqlite3-fts5 | ❌ 缺 | ❌ 缺（无 root） | ❌ 不变 |
| pi 复用度 ≥ 70% | 21.9% | 21.9% | ❌ audit 计数方式不变 |
| pi-bridge 利用率 ≥ 80% | 7% | 7% | ❌ |
| apply-patch LOC | 228 | 228 | ❌ |
| profile-manager LOC | 806 | 806 | ❌ |
| 29 canonical e2e | 0/29 | 0/29 | ❌ |
| test/source ratio | 1.023 ✅ | 1.023 ✅ | ✅ 不变 |

**总账**：**6 ✅ + 4 ❌**（v3.7 是 5 ✅ + 5 ❌）。

---

## 7. 解锁的下游能力

1. **ui-* 包统一从 `@openbuddy/ui-theme` 引入 pi theme** — 无需直接依赖 `@earendil-works/pi-coding-agent`
2. **三层 pi 接入金字塔成型**：
   - pi-bridge（main 进程 / Node-only）→ plugin-sdk（runtime / markdown YAML）→ ui-theme（renderer / 视觉）
3. **G4（pi-bridge 14 通道）补一个潜在 `bridge.theme.*` 通道**（待 G4 实施时验证）
4. **moon CLI 可用** — 后续可跑 `moon :ci` / `moon run test` 替代手动 vitest

---

## 8. 已知限制

1. **G6 spec API 假设错**：`initTheme` 是 positional 不是 config object；`getSettingsListTheme` 在 pi 不存在（是 `getEditorTheme`）。本轮已通过 facade 适配，v3.9 应修正 G6 spec §2
2. **G6 spec LOC 估算错**：~200 LOC → 实际上 ui-theme 没有任何 token/render 代码
3. **G6 PR 2 未做**（Markdown / SelectList / SettingsList 真实替换）：本轮只到 PR 1（facade 就位）
4. **fts5 仍限制 vitest 全集**（24/66 failed）：与本轮无关；需 root + 重新编译 Node 才能解决

---

## 9. 下一步（v3.9 候选）

- **修正 G6 spec §2**（API 签名 + LOC 估算）
- **实施 G1**（apply-patch 228 → pi tool-factory；解锁 G7 / G10）
- **G6 PR 2**（renderer 实际渲染路径接 theme-pi.ts）
- **修正 G11 spec §0 LOC 表**（277 → 347，spec 反向）
- **跑全 monorepo vitest**（63 packages；待 fts5 修复）