# Brand Guidelines

[English](BRAND.md) · **简体中文**

### Logo

OpenBuddy logo 是 **"Buddy the Whale" 标志**:一只提莫风格的萌系鲸鱼,沿用英雄联盟角色化设计语言。圆胖身、超大表情眼、迷你尾鳍与胸鳍、标志性船长帽、动感的暖琥珀水柱。品牌三组配色 —— 天蓝/奶油 `#A8DCF0 → #FFE5C2 → #FFD09A`、海洋/火花 `#6FC0E8 → #2E78C8 → #F59E0B → #FFD78A`、珊瑚 `#FF6B6B → #FF9A8B` —— `#1E2640` 仅作小面积海军蓝装饰,无纯黑色,16 px favicon 到 1024 px app icon 任何尺寸都清晰。

| 资产 | 文件 | 格式 | 推荐尺寸 |
|---|---|---|---|
| 矢量主文件 | `src/assets/logo-mark.svg` | SVG | 任意 |
| 矢量 logo | `openbuddy-logo.svg` | SVG | 任意 |
| App 图标(位图主) | `app-icon.png` | PNG | 1024×1024 |
| 单色版 | `openbuddy-logo-mono.svg` | SVG | ≥ 48 px |
| 字标 | `openbuddy-wordmark.svg` | SVG | 宽 ≥ 240 px |
| 顶栏图标(浅色) | `src/assets/header-icon.svg` | SVG | 16–32 px |
| 顶栏图标(深色) | `src/assets/header-icon-dark.svg` | SVG | 16–32 px |
| 吉祥物位图 | `src/assets/mascot-new.png` | PNG | ≥ 256 px |
| 欢迎页(浅色) | `src/assets/claw-welcome-light.svg` | SVG | 240 px |
| 欢迎页(深色) | `src/assets/claw-welcome-dark.svg` | SVG | 240 px |
| 网站图标 | `public/favicon.ico` | ICO | 16 / 32 / 48 |
| macOS 应用 | `build/icon.icns` | ICNS | 脚本生成 |
| Windows 应用 | `build/icon.ico` | ICO | 脚本生成 |
| Linux 应用 | `build/icon.png` | PNG | 脚本生成 |

`src/assets/logo-mark.svg` 是唯一source of truth。所有位图都由它派生 ——
不要手改 PNG/ICO/ICNS:

```bash
pnpm brand:icons
```

`build/` 在 .gitignore 里,所以全新 clone 打包前必须先跑一次。
依赖 `librsvg` 与 `imagemagick`(`brew install librsvg imagemagick`)。

### Logo 用法

#### ✅ 应该

- 四周保留 **等同于一个 "B" 高度** 的清晰空间
- 优先用 **矢量** 版本
- favicon、Dock 图标、磁贴用 **App 图标**
- 当字母组合不易辨识时用 **字标**

#### ❌ 不要

- 不要改颜色
- 不要倾斜、旋转、扭曲
- 不要加投影、发光等效果
- 不要放在杂乱背景上,除非底下垫纯色面板
- 不要用来代表不相关产品
- 不要把鲸鱼吉祥物改成别的形象(未经允许)

### 清晰空间

(同英文图示)

### 最小尺寸

(同英文表格)

### 配色

OpenBuddy 用 **双色** 系统:强调色 + 中性色。

#### 强调色

(同英文表格)

#### 中性色

(同英文表格)

#### 状态色

(同英文表格)

### 字体

#### 标题

标题、PPT 标题、字标:

- **Inter**(首选)—— `font-family: 'Inter', system-ui, sans-serif`
- **SF Pro Display**(macOS)—— fallback
- **Segoe UI**(Windows)—— fallback

#### 正文

段落与 UI 文本,用系统字体栈:

- macOS:`SF Pro Text`
- Windows:`Segoe UI`
- Linux:`Ubuntu`、`Cantarell`、`DejaVu Sans`

#### 等宽字体

代码、路径、标识符:

- **JetBrains Mono**(首选)
- **SF Mono**(macOS)
- **Cascadia Code**(Windows)

### 语气

OpenBuddy 有三种沟通模式。根据场景选对。

| 模式 | 何时 | 示例 |
|---|---|---|
| **市场** | 网站、博客、演讲 | "真正可读、可 fork、可拥有的开源桌面 AI 工作台。" |
| **技术** | 文档、代码、Issue | "渲染端 ↔ IPC 表面在 `electron/preload/index.ts` 中白名单化。" |
| **支持** | 社区、错误 | "抱歉!能分享下 `pnpm workspace:test` 的输出吗?" |

#### 声音原则

- **友好但专业** —— 假定读者知道 API key 是什么
- **默认开源** —— 不要声称仓库无法证明的特性
- **平实英语** —— 避免市场行话("协同"、"革命性")
- **包容** —— 用 "you" 而非 "the user";第三人称用 "they" 或 "the contributor"

### 命名

#### 产品

- ✅ **"OpenBuddy"** —— 一个词,首字母 "O" + "B" 大写
- ✅ **"OpenBuddy Pi"** —— 完整产品名(带 agent 运行时归属)
- ❌ "openbuddy"(全小写,除非句首)
- ❌ "OpenBuddy™"(无商标符号;我们是 MIT)
- ❌ "OB"(除非空间受限)

#### 代码标识符

- ✅ `@openbuddy/*` —— npm scope
- ✅ `openbuddy:*` —— IPC 通道前缀
- ✅ `openbuddy.capability.*` —— Cordis 插件 ID
- ❌ `OB-*`(字母组合不作代码前缀)

### Tagline 选项

根据场景选择。

| 受众 | Tagline |
|---|---|
| 通用 | "开源桌面 AI 工作台" |
| WorkBuddy 用户 | "WorkBuddy 的开源版本" |
| 开发者 | "100% 开源。100% 可审计。100% 属于你。" |
| 企业 | "内核开源的企业 AI 工作台" |
| 英文 | "The open desktop AI workspace." |
| 日文(计划中) | "オープンソースのデスクトップ AI ワークスペース" |

### 社交媒体

(同英文列表)

### 媒体工具包

(同英文)

### 商标政策

OpenBuddy 的 **代码** 是 MIT 许可。**名称与 logo** 不在 MIT 授权范围内。

你可以:

- ✅ 用名称与 logo 指代 OpenBuddy 项目
- ✅ 在扩展 OpenBuddy 的插件中使用名称与 logo
- ✅ 在教育/博客/演讲场景使用名称与 logo

你不可以:

- ❌ 在刻意误导为官方的 fork 中使用名称与 logo
- ❌ 未经书面许可在商业产品名中使用名称与 logo

商业使用咨询:`trademark@openbuddy.dev`。

---

<div align="center">

**Brand consistency builds trust. / 品牌一致,信任自来。**

</div>
