# OpenBuddy Plugin Marketplace

> Marketplace UI layer on top of the [`PLUGIN_SYSTEM`](./PLUGIN_SYSTEM.md)
> 6-surface architecture. This document is the canonical reference for the
> marketplace tab, install dialog, capability badges, and the Pi-Extension
> bridge.

---

## 1. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Renderer                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐       │
│  │ Marketplace  │  │  Install     │  │ Capability       │       │
│  │     Tab      │──│   Dialog     │──│ Version Badge    │       │
│  └──────────────┘  └──────────────┘  └──────────────────┘       │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ marketplace-model  (zustand)                               │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
                              │  IPC: market:list / market:install /
                              │       market:upgrade / market:rollback
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Main  (electron)                                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ MarketService (Cordis)                                     │ │
│  │   • catalog  (from registry JSON + filesystem cache)        │ │
│  │   • install  (verify signature → unpack → register)         │ │
│  │   • upgrade  (semver diff → migration hooks)                │ │
│  │   • rollback (snapshot before install → revert on failure)  │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
                              │
                              │  Pi Extension bridge
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  Pi Registry  (npm-compatible, signature-verified)             │
│  • openbuddy-plugin-*   (1st-party)                            │
│  • pi-extension-*       (3rd-party, signature-checked)         │
└────────────────────────────────────────────────────────────────┘
```

## 2. Install lifecycle

A plugin goes through five states — `absent → downloading → installing →
ready → upgrading|rolling-back`:

| State     | UI behaviour                       | IPC trigger        |
|-----------|-------------------------------------|--------------------|
| absent    | Card shows "Install" button         | `market:install`   |
| downloading | Card shows progress bar           | (server-sent)      |
| installing | InstallDialog opens, capability list | (modal)          |
| ready     | Card shows version + "Upgrade" btn  | —                  |
| upgrading | Card shows migration summary        | `market:upgrade`   |
| rolling-back | Card greys out, "Rollback" btn   | `market:rollback`  |

## 3. Capabilities

`openbuddy.plugin.v1` manifest declares a typed capability list. The
marketplace reads the manifest, then `CapabilityVersionBadge` renders the
resolved version. Examples:

```yaml
# openbuddy.plugin.v1 manifest
name: openbuddy-plugin-git
version: 1.4.2
capabilities:
  - id: tools.git-status
    surface: pi
    provides: [git.status, git.diff]
  - id: ui.git-tree
    surface: renderer
    slot: files.tree
```

The MarketplaceCard surfaces these in a "Capabilities" tab so users see
exactly what they get before installing.

## 4. Pi-Extension bridge

Pi extensions (shipped as npm packages with a `pi-extension.v1` manifest)
can be installed through the marketplace without writing a 1st-party
adapter. The bridge:

1. Reads `pi-extension.v1` from the candidate package.
2. Wraps each capability into a synthetic `openbuddy.plugin.v1` surface
   (`pi` for tools/skills, `renderer` for UI contributions).
3. Registers them through the normal Cordis / SlotProvider pipeline.

This is the main path WorkBuddy cannot replicate (WorkBuddy is
proprietary and does not accept 3rd-party agent extensions).

## 5. Source of truth

- UI: `packages/ui/openbuddy-ui-modules/src/components/{MarketplaceCard,InstallDialog,CapabilityVersionBadge,MarketplaceTab}.tsx`
- Model: `packages/ui/openbuddy-ui-modules/src/components/marketplace-model.ts`
- Main service: `packages/main/modules-marketplace/` (referenced from
  `electron/main/ipc/index.ts`)
- Manifest schema: `packages/ui/openbuddy-ui-modules/src/__tests__/manifest.schema.test.ts`
- Test coverage: 5 / 5 unit tests passing
  (`MarketplaceCard`, `InstallDialog`, `CapabilityVersionBadge`,
  `MarketplaceTab`, `marketplace-model`)

## 6. Roadmap

- **Plugin SDK v1 docs site** (separate VitePress site at
  `/docs/sdk`): the `openbuddy.plugin.v1` schema, capability cookbook,
  starter templates.
- **Expert Marketplace Bridge** (concrete end-to-end install Pi
  Extension → restart agent → call new tool).
- **Audit Trail integration**: every `market:install` /
  `market:upgrade` / `market:rollback` records to the audit log.

## 7. Expert Marketplace Bridge — production 接线状态(R18)

> R18 把 `pi-market-bridge.ts` 从「模块存在 + 单测覆盖」推进到「生产 IPC 接线 + 真机端到端验证」。

###接线点

**Main 进程**(`electron/main/ipc/index.ts`):
```ts
import { createPiMarketBridge, registerPiMarketBridgeIpc } from "../agent/pi-market-bridge";
import { app } from "electron";

// ...
const dataDir = app.getPath("userData");
// R32 — 源清单在启动时定下来(显式配置 > 环境变量 > sources.json)。
const piMarketSources = await resolvePiMarketSources({ dataDir });
const piMarketBridge = createPiMarketBridge({
  dataDir,
  hostVersion: "0.15.0",
  sources: piMarketSources,
});
registerPiMarketBridgeIpc(piMarketBridge, ipcMain);
```

> ⚠️ R32 起 `resolvePiMarketSources()` 这一步是必需的 —— 不传 `sources` 时
> `sources.json` 与 `OPENBUDDY_PI_MARKET_SOURCES` 都不会被读到(见第 8 节)。

**Preload allowlist**(`electron/preload/index.ts`):
```
"agent:pi-market-list", "agent:pi-market-refresh",
"agent:pi-market-install", "agent:pi-market-upgrade",
"agent:pi-market-rollback", "agent:pi-market-lockfile",
"agent:pi-market-audit",
```

**Renderer wrapper**(`src/lib/pi-market/pi-market-client.ts`):
```ts
import { listPiMarket, installPiMarket, upgradePiMarket,
         rollbackPiMarket, lockfilePiMarket, auditPiMarket } from "@/lib/pi-market/pi-market-client";
```

###端到端实测(`_probe-pi-market-install.mjs`)

| 步骤 | 真实结果 |
|---|---|
| list(空 registry) | `{ extensions: [] }` |
| list(1 条 demo.pi-sample) | 返回完整 manifest + tracks + capabilities |
| install("demo.pi-sample", "1.0.0") | `{ changed: true, path, installedAt, capabilities }` |
| lockfile | `{ version: 1, extensions: { ...integrity: "<sha256>" } }` |
| 重装同 ID 同版本 | `{ changed: false }`(幂等) |
| rollback(无历史) | 抛错 `no recorded previous version` + audit 记 failure |
| audit | 3 条记录(install success × 2 + rollback failure) |

###文件系统落盘结构

```
<dataDir>/pi-extensions/
  registry.json               # 本地索引
  installed.json              # lockfile:版本 + integrity + history
  audit.jsonl                 # 追加式审计(本地优先,无外发)
  <id>/current                # 指针文件(单行纯文本)
  <id>/<version>/             # 载荷目录
    openbuddy.plugin.json
    ...
```

###单测

`electron/main/agent/pi-market-bridge.test.ts`:**42/42 tests passing**

###设计约束(已在 bridge 注释里锁定)

1. **additive** — 不修改任何既有 IPC channel / 既有 marketplace 模块
2. **可注入** — registry 来源、载荷来源、时钟、宿主版本全部可注入
3. **原子** — 先 staging 再 rename 提交;lockfile 用 temp + rename 写入
4. **不重造 manifest 校验** — 复用 `validateOpenBuddyPluginManifest`

---

## 8. R32 — 多源 registry、线契约单一定义、错误码穿 IPC

R18 把桥接层接进了生产,但市场只有一个索引源,而且**渲染端的类型是自己手写的一份**。
R32 把这两件事一起收口,顺带查出三个一直在代码里活着的真 bug。

### 8.1 线契约单一定义(`packages/shared/openbuddy-types/src/pi-market.ts`)

同一套形状此前被手写了三遍:main 生产者 `pi-market-bridge.ts`、渲染端 wrapper
`src/lib/pi-market/pi-market-client.ts`、UI 消费方。三份已经漂移:

| 漂移点 | wrapper 写的 | bridge 实际返回 | 后果 |
|---|---|---|---|
| install / upgrade / rollback | `{ ok: true, lock }` | `PiMarketInstallResult` | UI 读 `result.ok` 永远是 `undefined` → **每次安装都被当成失败** |
| audit | `{ events }` | `{ entries }` | 审计列表永远空 |
| 条目类型 | `PiMarketRegistryEntry`(缺 `manifest` / `installedVersion` / `updateAvailable`) | `PiMarketEntry` | 卡片读不到已安装状态 |
| audit action 联合 | 含 `uninstall` / `scan` | `install` / `upgrade` / `rollback` / `refresh` | 穷举 switch 漏分支 |

为什么类型检查抓不到:这些 wrapper **R18 之后一直没有 UI 消费**,只有内部互相引用。
R32 接 UI 时先修类型,再让 wrapper 直接对着**真实 bridge handler** 跑一遍
(`src/lib/pi-market/__tests__/pi-market-client.test.ts`),任何一侧再漂移都会红。

现在两边的类型都从 `@openbuddy/shared-types` re-export,`PiMarketEntryView` 是渲染端
唯一该读的条目形状。

### 8.2 多源:`sources.json` + 权重 + 合并规则

配置优先级(同 id 时**先出现的赢**):

```
显式 options.sources  >  registryUrl / OPENBUDDY_PI_MARKET_REGISTRY_URL
                      >  OPENBUDDY_PI_MARKET_SOURCES            (JSON 数组或单个 URL)
                      >  <dataDir>/pi-extensions/sources.json
```

`sources.json` 形状(数组,或 `{ "sources": [...] }`):

```json
[
  { "id": "official", "url": "https://registry.example/index.json",
    "label": "官方", "weight": 10, "trusted": true, "timeoutMs": 5000 },
  { "id": "corp-mirror", "url": "https://mirror.corp/index.json", "weight": 0 }
]
```

坏条目**跳过而不是抛错**(源是用户手写的配置,写错一行不该让整个市场打不开);
同 id 只保留第一条;缺 id 时从 URL 的 **host + path** 派生一个稳定 id(写缓存文件名要用)。

> R35 之前这里只取 host。同一个 host 上放多个索引是常态
> (`https://mirror.corp/pi/stable.json` 与 `.../nightly.json`),只按 host 派生会让
> 它们撞成一个 id —— 读路径的去重(同 id 只保留第一条)于是**静默丢掉第二个源**:
> 用户写了两个源,只有一个生效,而且没有任何提示。现在 path 也进 id
> (`mirror.corp-pi-stable` / `mirror.corp-pi-nightly`)。

合并规则刻意做得很窄,因为"聪明的字段级合并"不可预测:

1. 权重从大到小处理,同权重保持**声明顺序**;
2. 同一个 id **只有第一个源赢**,winner 的字段原样保留 —— 不做字段合并
   (两个源对同一插件给出不同载荷时,混合出来的东西没人能复现);
3. 低权重源里**独有的 id** 照常收录(镜像可以补充官方源没有的插件),
   只在 winner 上记 `alsoOfferedBy`(UI 标注「亦有镜像」)。

> 「官方源掉线时镜像接管」不需要额外规则:官方源没返回条目,镜像自然成为 winner。

### 8.3 离线兜底

- 每个源一次 `<dataDir>/pi-extensions/sources/<sourceId>.json` **独立缓存**。
  不挤进 `registry.json`:后者是"刷新后的合并视图"(可能被内网直接拷进来),
  缓存是"某个源上次成功返回的原始内容" —— 混在一起就分不清数据来自哪个源、什么时候。
- 单源默认超时 8000ms(`timeoutMs` 可覆盖)。**多源下超时是必需品** ——
  否则一个卡死的源会拖住整次刷新。
- 拉取失败 → 退回该源上次成功的缓存(`state: "cached"`),其它源照常新鲜;
  全部失败且都没有缓存 → 才抛 `invalid-registry`。
- **读路径也回写缓存**:用户打开过一次市场就有兜底。
- 本地 `registry.json` 存在时优先,配置的远端源标 `skipped` 且**不触网**。

**产品立场:默认不内置任何远端源 —— 没配置 = 不联网**(本地优先 / 数据自决)。

### 8.4 错误码穿过 IPC

`ipcRenderer.invoke` 只透传错误的 **message**,挂在 Error 上的 `code` 属性到不了渲染端。
而 UI 需要区分三种补救动作完全不同的失败:

| 码 | UI 补救动作 |
|---|---|
| `consent-required` | 回安装对话框,让用户勾选「同意高风险能力」 |
| `incompatible` | 提示宿主版本区间不匹配,换版本或升级宿主 |
| `corrupt-install` | 提示载荷被外部改写,勾选「强制重新物化」 |
| `not-found` / `version-not-found` | 提示刷新索引 / 换版本(可重试) |
| `payload-unavailable` / `unsafe-target` / `no-previous-version` | 需要人工处理,重试无意义 |

做法:`PiMarketBridgeError` 的 message 统一由 `formatPiMarketError(code, detail)` 生成
(`pi-market[<code>]: <detail>`),渲染端 `parsePiMarketError()` 取回;UI 里**只有
`describePiMarketError()` 一处**读错误码,新增码只需要在表里补一行。
单测穷举 `PI_MARKET_ERROR_CODES`,保证每个码都有专门分支(不会静默落进兜底)。

### 8.5 UI 落点:市场面板顶部的「Pi 扩展」区块

`packages/ui/openbuddy-ui-mcp/src/PiExtensionsSection.tsx`,挂在 `MarketplacePanel` 之上。

- **为什么分区块而不是合表**:MarketplacePanel 走 pi 官方 marketplace
  (`x.ai/marketplace/*`),数据模型、安装语义、失败模式都不同;两者共享的只有排版约定。
- 表现层**复用** ui-modules 的 `MarketplaceTab` / `InstallDialog` /
  `CapabilityVersionBadge`(`modules.marketplace` 槽本来就是给这个用途留的),
  纯逻辑在 `pi-extensions-model.ts`(不 import React / IPC,可直接单测)。
- 状态自持:加载 / 刷新 / 安装对话框 / 错误码 → 补救动作;宿主只提供 `onToast`。
- 没配源时给「源该写在哪里」的空态,而不是渲染一个坏掉的空列表。
- 顶部来源 chips 优先用刷新报告里的**权威**每源状态(`fresh` / `cached` / `failed` /
  `skipped`),没刷新过就从条目的 `sourceId` 反推计数 —— 不为画几个 chip 强制联网。

### 8.6 R32 测试

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `electron/main/agent/pi-market-multi-source.test.ts` | 22 | 权重 / 去重 / provenance / 缓存落盘 / 单源掉线 / 全掉线 / 超时 / 本地优先 / 单源兼容 |
| `electron/main/agent/pi-market-bridge.test.ts` | 42 | bridge 原有行为(未回归) |
| `src/lib/pi-market/__tests__/pi-market-client.test.ts` | 11 | wrapper 接**真 handler**:返回值形状 / 错误码穿透 / channel 表一致 |
| `packages/ui/openbuddy-ui-mcp/__tests__/pi-extensions-model.test.ts` | 17 | 投影 / 安装状态 / 分组 / 来源 chips / 错误码表穷举 |
| `packages/ui/openbuddy-ui-mcp/__tests__/pi-extensions-section.test.tsx` | 6 | 空态 / 来源展示 / 刷新 / 安装对话框 / 高风险拒绝留在对话框 |
| `scripts/electron/_probe-r32-pi-market-ui.mjs` | 真机 | 走真实用户路径:两个真 HTTP 源 + 一个死源 → 权重合并 → UI 来源 chips → 点安装 → lockfile 落盘 |
| `scripts/electron/_probe-r32-pi-market-ui.test.mjs` | 6 | 上面那条探针的 CI wrapper |

### 8.7 R32 顺带查出的两个真 bug

1. **`normalizeRegistryFile` 重复定义**:同一作用域里被声明了两次(前一轮编辑留下的),
   运行时靠函数提升"碰巧"还能工作。已删除重复定义。
2. **本地索引条目不写 `sourceId`**:文档写的契约是「本地 `registry.json` 提供时是
   `local`」,实现里只有多源合并路径才写 —— 渲染端两条读路径拿到的东西不一致。
   现在 `toMarketEntry()` 统一回落 `"local"`。
3. **两条 Pi 市场探针在第 7 步假失败**:`_probe-pi-market-install.mjs` 与
   `_probe-pi-market-r18-runtime.mjs` 在 `page.evaluate` 里 `import("node:fs/promises")`
   —— 渲染进程开不了 `node:fs`(sandbox + contextIsolation),整条探针在那里崩掉,
   于是 R18 以来"文件系统落盘结构"这一节其实**从来没被真机验证过**。现在改成 node
   侧读盘,两条探针 7 步全绿。

---

## 9. R33 — 卸载

R32 之后市场具备了「装 / 升级 / 回滚」,但**没有卸载**:用户装了一个 Pi 扩展之后
只能去手删 `<dataDir>/pi-extensions/<id>/`,而且审计里查不出「装过又删了」。

### 9.1 语义

```
uninstallPiExtension(id, { keepPayload?: false })
  ├─ 默认:摘掉 lockfile 记录 + 删掉 <id>/ 整个扩展目录
  └─ keepPayload: 只摘 lockfile 记录,载荷目录原样保留(停用,但随时能装回来)
```

加载器是跟着 lockfile 走的(`init-pi-user-extensions` 读 `installed.json`,再跟
`<id>/current` 指针),所以**只摘记录**就已经等于「停用」—— 这也是 `keepPayload`
之所以成立的原因。

### 9.2 为什么先 rename 再 rm

直接 `rm -rf <id>` 删到一半失败,会留下一个「看起来还在」的半残安装(指针文件还在、
版本目录缺文件),加载器照样会去读它。所以:

1. `rename(<id>, .trash-<uuid>)` —— 原子。一旦成功,扩展立刻从加载器视角消失;
2. `rm(.trash-<uuid>)` —— 只是清理磁盘;失败最多留一个 `.trash-*` 目录;
3. `sweepTrash()` —— 每次卸载顺手清掉历史遗留的 `.trash-*`。

`lstat`(而不是 `stat`)是刻意的:`<id>` 本身是符号链接时,要删的是这个链接,
而不是顺着链接把外面某个目录删掉。

### 9.3 四种磁盘 / lockfile 组合都要收敛

| lockfile | 目录 | 行为 |
|---|---|---|
| 有 | 有 | 正常卸载:`removedVersions` = 目录里的版本 |
| 有 | 无(被外部删了) | 摘记录,`removedVersions` 为空 |
| 无 | 有(手工拷进来的) | 删目录,`version` 为 `undefined` |
| 无 | 无 | 抛 `not-found`,审计记 failure |

### 9.4 UI

市场面板的 Pi 扩展区块里,已安装的条目会在卡片的 `⋯` 菜单出现两项:

- **强制重装(修复被改写的载荷)** —— 对应 `corrupt-install` 的自救路径,
  等价于安装时勾选「强制重新物化」;沿用上一轮已同意的能力,不再二次询问。
- **卸载** —— 走 `GlobalConfirmHost` 的确认框,确认后调 IPC。

菜单项是**宿主注入的整份清单**,而适用性逐条目不同,所以
`MarketplaceCard` 的 `MarketplaceMenuItem` 新增了可选的
`visible?: (entry) => boolean` 谓词:不适用的动作不画出来(否则用户点了才收到
`not-found`),全部被过滤掉时连 `⋯` 按钮都不渲染。

### 9.5 测试

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `electron/main/agent/pi-market-bridge.test.ts` | +9 | 四种组合 / keepPayload / 不留 `.trash-*` / 不误删别的扩展 / IPC handler |
| `src/lib/pi-market/__tests__/pi-market-client.test.ts` | +3 | wrapper 接真 handler:摘记录 / keepPayload / not-found 取回码 |
| `packages/ui/openbuddy-ui-modules/src/__tests__/MarketplaceCard.test.tsx` | +2 | `visible` 谓词过滤 / 全被过滤时不渲染 `⋯` |
| `packages/ui/openbuddy-ui-mcp/__tests__/pi-extensions-section.test.tsx` | +4 | 未安装无菜单 / 卸载确认 / 强制重装 `force:true` / 失败按码给说明 |
| `scripts/electron/_probe-r32-pi-market-ui.mjs` | 真机 +3 步 | 走 UI 的 ⋯ → 卸载 → ConfirmDialog → lockfile 清空 + 审计 `uninstall/success` |

## 10. R35 — 源管理(在 UI 里改源,不重启就生效)

在 R35 之前,配置一个内网镜像源的完整流程是:读文档 → 找数据目录 → 手写
`sources.json` → **重启应用**。两件事都是门槛,而第二件更隐蔽:源清单在
`createPiMarketBridge()` 构造时定死,所以"我明明改了文件"的答案是"你需要重启"。

现在流程是:**源管理 → 加源 → 测试 → 保存并生效 → 刷新索引**。

### 10.1 三份视图,而不是一份合并列表

`agent:pi-market-sources-get` 返回 `PiMarketSourcesView`:

| 字段 | 含义 |
|---|---|
| `file` | `sources.json` 的内容 —— UI 里**可编辑**的那一份 |
| `effective` | 合并去重(同 id 高优先级赢)+ 按权重排序后的最终列表 |
| `readonlySourceIds` | 不是来自文件、因而改不动的源(环境变量 / 宿主注入) |
| `filePath` | `sources.json` 的绝对路径(UI 直接告诉用户"改的是哪个文件") |
| `statuses` | 上一次刷新的每源结果(`fresh` / `cached` / `failed` / `skipped`) |

拆成两份的理由:一个源可能来自四个地方(宿主注入 > registryUrl > 环境变量 >
`sources.json`),只有最后一个是用户能改的。混成一份列表会让 UI 显示一个
**改不动的输入框**;只显示可编辑的那一份又会藏起"其实还有一个源压着你"。
只读源照常显示,只标记为「只读」。

### 10.2 保存即时生效

`agent:pi-market-sources-set` 做三件事,顺序固定:

1. **严格校验**(与读路径刻意相反)。读盘时坏条目静默跳过(手写 JSON 写错一行
   不该让整个市场打不开);写的时候必须报错并**指出第几行的哪个字段**,因为
   用户正在编辑、需要回执才能改对。静默丢弃会让"我明明加了这个源"变成查不出的谜。
2. 原子写回 `sources.json`(temp + rename,`0600`)。
3. **就地替换内存里的源清单** 并清空上一次的每源状态(源变了,旧状态不再对应
   任何东西)。所以紧接着的 `refreshRegistry()` 就是按新源跑 —— 不需要重建
   bridge,更不需要重启。

### 10.3 探活(`agent:pi-market-source-probe`)

- 走同一个 fetcher,但**不落盘**:不写缓存、不改 `statuses`。
  这是"保存前先试一下",不该在用户还没确定的时候改动任何状态。
- 返回 `{ ok, entryCount, sampleId, error, elapsedMs }` —— 带上首个条目的 id,
  给「这个源确实有内容」一个具体证据,而不是只有一个计数。
- 输入同样走严格校验(空 URL 直接报错,而不是发一个空请求)。

### 10.4 UI 落点

- 入口:「Pi 扩展」区块头部的**源管理**按钮(默认收起 —— 不点就不读配置)。
- `packages/ui/openbuddy-ui-mcp/src/PiSourcesEditor.tsx` 负责渲染,
  纯逻辑在 `pi-extensions-model.ts`(`sourcesToDrafts` / `validateSourceDrafts` /
  `sourceDraftsDirty` / `moveSourceDraft`),组件不重复实现业务判断。
- 每行:URL / 名称 / 权重 / 超时 + 状态 chip + 「测试」+ 上移 / 下移 / 删除。
  权重相同时**声明顺序**决定优先级,所以顺序本身是可编辑语义(只读行不可移动)。
- 数字字段在编辑态是**字符串**:输入框里敲到一半的 `1.` 或手滑的 `abc`,存成
  number 会在 `onChange` 里被 `Number()` 悄悄变成 0。
- 校验失败时该行标红 + 就地给出原因,「保存」按钮不可点 —— 不写出半坏的配置。

### 10.5 R35 测试

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `electron/main/agent/pi-market-sources.test.ts` | 13 | 三视图拆分 / 只读源永远赢 / 严格校验的行号 / 派生 id 带 path / 保存后不重启即生效 / 清空旧状态 / 校验失败不落盘 / 探活不落盘 |
| `packages/ui/openbuddy-ui-mcp/__tests__/pi-extensions-model.test.ts` | +13 | 草稿投影 / 逐行校验 / 同 host 不同 path 不撞 id / 脏检查 / 排序 / 状态与探活文案 |
| `packages/ui/openbuddy-ui-mcp/__tests__/pi-extensions-section.test.tsx` | +4 | 默认收起不读配置 / 保存写回并重读市场 / 坏输入禁用保存 / 测试不保存 |
| `scripts/electron/_probe-r35-pi-sources-ui.mjs` | 真机 20 步 | 走 UI 加源 → 测试 → 保存 → 刷新 → 权重改动翻转赢家 → 删源 → reload 后仍在 |

### 10.6 R35 顺带查出的真 bug

1. **派生 id 只取 host** → 同 host 上两个索引被读路径去重静默丢掉一个(见 §8.2)。
2. `_probe-r29-market-placeholder.test.mjs` 用「面板全文 `slice(0, 320)` + 正则」找
   统计行 —— 面板上方文案一变长,统计行被挤出窗口就变成假失败。已改成直接读
   `.marketplace-panel__stats`。



## 相关文档

- [`docs/PI_EXTENSION_BRIDGE.md`](./PI_EXTENSION_BRIDGE.md) — R74 公开 IPC
  契约(`listPiMarket / installPiMarket / refreshPiMarket / upgradePiMarket /
  uninstallPiMarket / rollbackPiMarket / lockfilePiMarket / auditPiMarket`),
  含第三方插件作者接入示例。
- [`docs/AUDIT_AND_TELEMETRY.md`](./AUDIT_AND_TELEMETRY.md) — R75 三层本地审计/遥测边界(本地优先差异化卖点)。
- [`docs/EXTENSION_POINTS.md`](./EXTENSION_POINTS.md) — 微内核 SlotCore +
  渲染端贡献总线 总表。
- [`docs/THEMES.md`](./THEMES.md) — 19 主题 / Theme Studio 导出导入。
- [`packages/runtime/openbuddy-plugin-host/src/remote-manifest.ts`](../packages/runtime/openbuddy-plugin-host/src/remote-manifest.ts) — 远端 manifest 解析/缓存/签名校验。
