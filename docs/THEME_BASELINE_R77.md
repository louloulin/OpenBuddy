# Theme Baseline R77 — 19 主题 × 4 变体真机视觉基线

> R77 一次性产出 76 张真机截图,作为 OpenBuddy v1.0 主题系统的视觉资产。

## 总览

19 套主题 × 4 种运行变体 = 76 张 PNG:

| 变体目录 | system 配色 | ThemeStore mode | 描述 |
|---|---|---|---|
| `manual/` | light | manual | 主题名决定类型(light/dark 各拍一次) |
| `manual-dark/` | **dark** | manual | 强制系统色暗 + 手动指定主题,验证 light 主题在 dark 系统下 |
| `match-system-light/` | light | **system** | Match-system + pair.light=<name>,pair.dark=openbuddy-dark |
| `match-system-dark/` | **dark** | **system** | Match-system + pair.dark=<name>,pair.light=openbuddy |

## 输出位置

`tests/screenshots/r77-themes/{manual,manual-dark,match-system-light,match-system-dark}/<name>.png`

每张图:1280×800 viewport,`setTimeout=300ms` 等主题字体与变量应用稳定。

## 运行命令

```bash
# 一次性产出 76 张 (~4 分钟,启动 Electron + 19×4 切换)
node scripts/electron/_shot-r77-theme-baseline.mjs

# 守卫(快速,~33ms):验证截图齐全且 md5 两两不同
pnpm exec vitest run scripts/electron/_guard-r77-theme-baseline.test.mjs
```

## 守卫测试覆盖 (11 用例)

- 4 个变体目录各 19 张 PNG 齐全
- 4 个变体目录内 md5 两两不同(防止脚本 bug 让所有主题拍成同一张)
- `midnight-ocean`(dark)在 4 个变体下 md5 ≥3 个不同(说明变体真的生效)
- `openbuddy`(light)在 `manual`/`manual-dark` 字节相同(系统色不影响 light 主题类型)
- `openbuddy-dark` 在 `match-system-light` vs `match-system-dark` 不同

## 实现要点

1. **Google Fonts 预热**:启动时一次性注入 4 套字体 link(Space Grotesk /
   Playfair Display / JetBrains Mono / Cardo),`document.fonts.ready` 兜底
   8s 超时,避免每套主题切换都重新 fetch(单套 30s 量级)。
2. **localStorage 直写**:Mode/Pair 切换不依赖 UI 操作,直接写
   `openbuddy.theme.mode` / `openbuddy.theme.pair.{light,dark}` 后 reload,
   让 ThemeInitializer 防 FOUC 路径走完整链路。
3. **playwright emulateMedia**:`page.emulateMedia({ colorScheme })` 覆盖
   `matchMedia("(prefers-color-scheme: dark)")`,无需真正切换 macOS 系统色。
4. **数据存档格式**:每个变体独立目录,便于按使用场景分发(比如
   `match-system-dark/` 用于 dark-mode-first 用户的截图回归)。

## v1.0 视觉资产用途

- **README hero**:选 `match-system-light/openbuddy.png` + `match-system-dark/openbuddy-dark.png` 做主题对比。
- **官网主题页**:全部 19 张 `manual/` 做主题卡片预览图。
- **ThemePicker UI**:每套主题的"它在 4 种语境下长啥样"参考。
- **回归基线**:任何主题 token / ThemePicker 改动前跑守卫,确保没把某套主题拍坏。
