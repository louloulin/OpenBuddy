# Pi 扩展市场桥接(PI Extension Bridge)

> OpenBuddy 相对 WorkBuddy 的开源差异化核心 — 任何 Pi 扩展都能从市场装进来,
> 带版本化、原子提交、回滚与审计。

`@openbuddy/pi-market-client` 是 renderer 侧的 IPC 包装,内部走 Electron 的
`invoke()` 调到 main 侧的 `electron/main/agent/pi-market-bridge.ts`。所有类型
都从 `@openbuddy/shared-types/pi-market` 单点导出,renderer 与 main 共用一份
线契约,漂移直接变成编译错误。

## 公共 API(`src/lib/pi-market/pi-market-client.ts`)

| 函数 | 返回 | 说明 |
|---|---|---|
| `listPiMarket()` | `PiMarketListResult` | 列当前所有源的全部 entry(含本地安装版本与远端可用版本) |
| `refreshPiMarket()` | `PiMarketRefreshReport` | 按配置源重新拉远端索引,产物回到只读快照 |
| `installPiMarket({ id, version?, options? })` | `PiMarketInstallResult` | 装一个 entry;`options.riskAck` 用于高风险能力的显式同意 |
| `upgradePiMarket({ id, version? })` | `PiMarketInstallResult` | 升级到指定版本(或最新) |
| `uninstallPiMarket({ id })` | `PiMarketUninstallResult` | 卸载 |
| `rollbackPiMarket({ id })` | `PiMarketInstallResult` | 回滚到上一个锁定的版本 |
| `lockfilePiMarket()` | `PiMarketLockfile` | 当前锁文件全量(锁定 = 已装的真值表) |
| `auditPiMarket({ limit? })` | `PiMarketAuditResult` | 最近 N 条审计事件(install / upgrade / rollback / source-change) |

错误语义:`invoke()` 在失败时 **reject**(bridge 抛 `PiMarketBridgeError`),错误
码编码在 message 里,用 `piMarketErrorInfo(message)` / `parsePiMarketError(message)` 取回。

## 消费方速记

`MarketplaceTab`(ui-modules 的 prop-driven 组件)只渲染,数据由调用方注入。

```tsx
import { useState } from "react";
import { listPiMarket, installPiMarket, auditPiMarket } from "@/lib/pi-market/pi-market-client";
import { MarketplaceTab, InstallDialog } from "@openbuddy/ui-modules/components";
import { toMarketplaceEntry } from "@/lib/pi-market/pi-extensions-bridge"; // 自定义 shim

const [entries, setEntries] = useState<MarketplaceEntry[]>([]);
useEffect(() => {
  void listPiMarket().then((r) => setEntries(r.entries.map(toMarketplaceEntry)));
}, []);

<MarketplaceTab entries={entries} onInstall={(id) => installPiMarket({ id })} />
```

> 真实实现参考 `packages/ui/openbuddy-ui-mcp/src/PiExtensionsSection.tsx` —
> 它把 `pi-market-client` 的 `PiMarketEntryView` 通过 `toMarketplaceEntry` 适配到
> ui-modules 的 `MarketplaceEntry`,并把 7 个 IPC 调用原样汇回 `InstallDialog`。

## 内置 vs 第三方桥接

| 数据源 | 入口 | 谁负责 IPC |
|---|---|---|
| Pi 官方 marketplace(`x.ai/marketplace/*`) | `marketplaceAction / marketplaceList`(src/lib/agent/pi-client.ts) | ui-mcp / `MarketplacePanel` |
| 任意索引源(可配置多源) | `listPiMarket / installPiMarket / ...` | ui-mcp / `PiExtensionsSection` + pi-market-client |
| 第三方插件市场 | 插件作者自行写 IPC,接到 `modules.marketplace` slot(ui-modules 的预留扩展) | 插件作者 |

OpenBuddy 的桥接协议公开透明,任何外部索引源只要遵循
`PiMarketRegistrySource`(`@openbuddy/shared-types/pi-market`)的字段约定
(name / url / priority / kind),就能被 `listPiMarket()` 一并拉到。

## 校验状态

- **R18**:初次实现 `pi-market-client.ts` 与 `pi-market-bridge.ts`。
- **R32**:类型与 main 端漂移修复(`ok: true, lock` → `PiMarketInstallResult`)。
- **R52**:`scripts/electron/_probe-r52-pi-market-and-themes.{mjs,test.mjs}` —
  端到端真机验证 + 19 主题可见,exit 0 才算通过。
- **R74(本次)**:本文件 = 文档化公开契约,降低第三方插件作者的接入门槛。

## 进一步阅读

- `packages/runtime/openbuddy-plugin-host/src/remote-manifest.ts` —
  远端 manifest 的解析、缓存、签名校验
- `packages/runtime/openbuddy-plugin-host/src/plugin-manifest.ts` —
  manifest schema 的**单一真值表**(`openbuddy.plugin.v1`)
- `docs/EXTENSION_POINTS.md` — 微内核 SlotCore + 渲染端贡献总线 总表
