# Accessibility (a11y)

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

OpenBuddy aims to be usable by everyone, including people who use assistive technologies. This document describes our accessibility standards, what we test, and how to design new features a11y-first.

---

<a id="english"></a>
## 🇬🇧 English

### Standards

We follow **[WCAG 2.2 Level AA](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)** as our baseline. We also adopt:

- **[WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)** for complex widget patterns.
- **[axe-core](https://github.com/dequelabs/axe-core)** rules for automated checks.
- **Inclusive Components](https://inclusive-components.design/) patterns for custom widgets.

### Conformance

| Criterion | Level | Where we comply |
|---|---|---|
| 1.1 Non-text content | A | All icons have `aria-label` or visible text |
| 1.3 Adaptable | A | Semantic HTML, no tables for layout |
| 1.4 Distinguishable | AA | Color contrast ≥ 4.5:1; `prefers-reduced-motion` respected |
| 2.1 Keyboard accessible | A | Full keyboard support; visible focus rings |
| 2.4 Navigable | AA | Skip links, focus order, descriptive titles |
| 2.5 Input modalities | AA | `pointer-events: none` on decorative elements |
| 3.1 Readable | AA | `lang` attribute on every translatable element |
| 3.2 Predictable | AA | No context-changing focus; consistent navigation |
| 3.3 Input assistance | AA | Error identification; suggestions; prevention |
| 4.1 Compatible | AA | Valid ARIA; programmatic names |

### Built-in features

#### Keyboard

Every action in OpenBuddy is reachable by keyboard:

| Action | Shortcut |
|---|---|
| Open command palette | `⌘K` / `Ctrl+K` |
| New chat | `⌘N` / `Ctrl+N` |
| Search sessions | `⌘/` / `Ctrl+/` |
| Toggle sidebar | `⌘B` / `Ctrl+B` |
| Settings | `⌘,` / `Ctrl+,` |
| Focus next panel | `F6` |
| Submit form | `Enter` |
| Cancel / close | `Esc` |

#### Focus management

- Visible focus ring (2px, `--wb-accent`, 2px offset).
- Logical focus order matches visual order.
- Modal dialogs trap focus and restore on close.
- Skip links on every top-level view.

#### Screen reader

- All interactive elements have accessible names.
- Live regions announce streaming message deltas (with debouncing).
- Tables use `<th scope>` properly.
- Forms have labels for every input.

#### Motion

- `prefers-reduced-motion: reduce` disables non-essential animation.
- No flashing content > 3 Hz.
- All transition durations ≤ 200 ms.

#### Color & contrast

- Default theme: WCAG AA contrast on all text.
- Dark mode: WCAG AA contrast on all text.
- Status colors (`--wb-success`, `--wb-warning`, `--wb-error`) are distinguishable in grayscale.
- No information conveyed by color alone.

### Designing new features

#### Checklist

When designing a new UI feature, ask:

- [ ] Can a screen reader user understand the purpose and state?
- [ ] Can a keyboard-only user complete every action?
- [ ] Does the focus order make sense?
- [ ] Is the contrast ≥ 4.5:1 for text, ≥ 3:1 for large text?
- [ ] Are status changes announced (live regions)?
- [ ] Does motion respect `prefers-reduced-motion`?
- [ ] Is the touch target ≥ 44 × 44 px?
- [ ] Are error messages clear and actionable?

#### Pattern library

We maintain a set of accessible React primitives in `packages/ui/openbuddy-ui-primitives`:

- `<Dialog>` — modal dialog with focus trap
- `<Menu>` — accessible menu with keyboard navigation
- `<Tooltip>` — accessible tooltip with delay
- `<Tabs>` — ARIA tabs pattern
- `<Combobox>` — autocomplete with keyboard
- `<Toast>` — live region announcements
- `<VisuallyHidden>` — for SR-only labels

Use these instead of building your own.

#### Form fields

- Always use `<label htmlFor>` or `aria-labelledby`.
- Errors go in `aria-describedby` with `aria-invalid="true"`.
- Required fields marked with `aria-required="true"` and a visible `*`.
- Help text in `aria-describedby`.

#### Custom widgets

For anything beyond native HTML, follow the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) exactly. Don't reinvent.

### Testing

#### Automated

- **axe-core** runs on every component test.
- **jest-axe** in `@openbuddy/ui-primitives` test suite.
- **Lighthouse** a11y score ≥ 95 required on every PR.

```bash
# Run axe on the rendered app
pnpm test:a11y
```

#### Manual

- **Keyboard-only** walkthrough of every new feature before merge.
- **VoiceOver** (macOS) + **NVDA** (Windows) smoke on every release.
- **High-contrast mode** smoke on Windows.
- **Zoom 200%** layout check.

#### Assisted

We partner with the [OpenBuddy A11y Working Group](#a11y-working-group) to do quarterly user testing with real assistive-tech users.

### A11y Working Group

A sub-team of `@louloulin/community` that:

- Reviews PRs for a11y impact (`area: ui` + `a11y` labels)
- Maintains the pattern library
- Triages a11y issues
- Runs the quarterly user testing

To join, file a Discussion with the `a11y` prefix.

### Reporting a11y issues

Use the standard bug report template, plus:

- Which assistive technology you used (e.g. NVDA 2024.4, VoiceOver iOS 17)
- Browser + version
- Step-by-step reproduction
- Expected vs actual behavior

We aim to **fix all critical a11y issues within 14 days**.

### Resources

- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [Inclusive Components](https://inclusive-components.design/)
- [axe-core rules](https://dequeuniversity.com/rules/axe/4.8)
- [The A11y Project](https://www.a11yproject.com/)

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 标准

我们以 **[WCAG 2.2 AA 级](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)** 为基线。还采用:

- **[WAI-ARIA 创作实践](https://www.w3.org/WAI/ARIA/apg/)** 处理复杂 widget 模式
- **[axe-core](https://github.com/dequelabs/axe-core)** 规则做自动检查
- **Inclusive Components** 模式做自定义 widget

### 一致性

(同英文表格)

### 内置特性

#### 键盘

OpenBuddy 中每个操作都可通过键盘触达:

| 操作 | 快捷键 |
|---|---|
| 打开命令面板 | `⌘K` / `Ctrl+K` |
| 新建聊天 | `⌘N` / `Ctrl+N` |
| 搜索会话 | `⌘/` / `Ctrl+/` |
| 切换侧边栏 | `⌘B` / `Ctrl+B` |
| 设置 | `⌘,` / `Ctrl+,` |
| 聚焦下一面板 | `F6` |
| 提交表单 | `Enter` |
| 取消 / 关闭 | `Esc` |

#### 焦点管理

- 可见焦点环(2px, `--wb-accent`, 2px 偏移)
- 逻辑焦点顺序与视觉顺序一致
- 模态对话框陷阱焦点,关闭时恢复
- 每个顶层视图都有 skip link

#### 屏幕阅读器

- 所有交互元素都有可访问名
- 流式消息 delta 通过 live region 公告(带去抖)
- 表格正确使用 `<th scope>`
- 表单每个 input 都有 label

#### 动效

- `prefers-reduced-motion: reduce` 禁用非必要动画
- 无 > 3 Hz 的闪烁内容
- 所有过渡时长 ≤ 200 ms

#### 颜色与对比度

- 默认主题:所有文本 WCAG AA 对比度
- 暗黑模式:所有文本 WCAG AA 对比度
- 状态色(`--wb-success`、`--wb-warning`、`--wb-error`)在灰度下也可区分
- 不只用颜色传达信息

### 设计新特性

#### Checklist

设计新 UI 特性时,问:

- [ ] 屏幕阅读器用户能否理解用途与状态?
- [ ] 仅用键盘的用户能否完成每个操作?
- [ ] 焦点顺序是否合理?
- [ ] 文本对比度 ≥ 4.5:1,大文本 ≥ 3:1?
- [ ] 状态变化是否公告(live region)?
- [ ] 动效是否尊重 `prefers-reduced-motion`?
- [ ] 触摸目标 ≥ 44 × 44 px?
- [ ] 错误信息是否清晰可执行?

#### 模式库

我们在 `packages/ui/openbuddy-ui-primitives` 维护一套可访问 React 基元:

(同英文列表)

请使用这些而不是自己造。

#### 表单字段

(同英文)

#### 自定义 widget

(同英文)

### 测试

#### 自动

- 每个组件测试都跑 **axe-core**
- `@openbuddy/ui-primitives` 测试套件用 **jest-axe**
- 每个 PR Lighthouse a11y 分数 ≥ 95

```bash
# 在渲染后的 app 上跑 axe
pnpm test:a11y
```

#### 手动

- 合并前每个新特性都要做**仅键盘**演练
- 每次发布在 **VoiceOver**(macOS)+ **NVDA**(Windows)上做 smoke
- 在 Windows 上做**高对比度模式** smoke
- 200% 缩放布局检查

#### 辅助测试

我们与 [OpenBuddy A11y 工作组](#a11y-工作组) 合作,每季度与真实辅助技术用户做用户测试。

### A11y 工作组

`@louloulin/community` 的子团队:

- 评审 PR 的 a11y 影响(`area: ui` + `a11y` 标签)
- 维护模式库
- 分流 a11y 问题
- 跑季度用户测试

加入方式:开 Discussion 加 `a11y` 前缀。

### 上报 a11y 问题

用标准 bug 报告模板,加:

- 你用的辅助技术(如 NVDA 2024.4、VoiceOver iOS 17)
- 浏览器 + 版本
- 逐步复现
- 预期 vs 实际行为

我们目标 **14 天内修复所有关键 a11y 问题**。

### 资源

(同英文链接列表)

---

<div align="center">

**A11y is not optional. / 可访问性不是可选项。**

</div>
