/**
 * PiMarketSection — R83 起的**唯一**插件市场 section。
 *
 * R83 之前 MarketplacePanel 里有两条并列布局(老 MarketplaceTab + 新的
 * pi.dev 风格 PiMarketTab)。
 * R84 把两条合并为这一条:**只保留 pi.dev 风格**,老路径删掉,理由:
 *   1. 用户目标就是"复刻 pi.dev/packages",两条路径增加维护成本却没有
 *      第二个视觉/信息架构来源;
 *   2. 老路径的 capabilities / installState / 多源合并 UI 在新路径里
 *      通过 CapabilityVersionBadge / sourceLabel / extraKinds 已经覆盖,
 *      没有丢失语义;
 *   3. 单路径让 fixture / probe / a11y 测试面更小。
 *
 * 视觉/信息架构:
 *   - 顶部 hero + 一句简介 + 安装命令
 *   - "Recently published" 区(7 条)
 *   - 主列表(50/页,带 downloads / recent / A-Z 排序,带类型徽章)
 *   - 每张卡:`$ pi install npm:<name>` + Copy + npm/repo/report 链接
 *
 * 数据源:复用 R18 pi-market-client 的 IPC(`listPiMarket` / `auditPiMarket` /
 * `installPiMarket` 等),由 `toPiPackageEntries` 桥接成 ui-modules 的
 * `MarketplaceEntry`。
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { readPiMarketUrlState } from "@openbuddy/ui-modules/components/pi-market";
import {
  PiMarketTab,
  type MarketplaceEntry,
} from "@openbuddy/ui-modules/components";
import {
  auditPiMarket,
  installPiMarket,
  listPiMarket,
  piMarketErrorInfo,
  refreshPiMarket,
  uninstallPiMarket,
  upgradePiMarket,
  type PiMarketAuditEntry,
  type PiMarketEntryView,
  type PiMarketLockfile,
  type PiMarketRegistrySource,
} from "@/lib/pi-market/pi-market-client";
import { describePiMarketError } from "./pi-extensions-model";
import { toPiPackageEntries } from "./pi-package-bridge";
import { PI_MARKET_FIXTURES, shouldInjectPiMarketFixtures } from "./pi-market-fixtures";

interface PiMarketSectionProps {
  onToast?: (message: string) => void;
  /**
   * 显式 opt-in 注入 fixtures(优先级最高);未传时由 `import.meta.env.DEV`
   * (Vite dev)或 `globalThis.__OPENBUDDY_PI_MARKET_FIXTURES__`(真机 probe)推断。
   * 注意:`process.env.NODE_ENV` 在 renderer bundle 里会被 Vite 内联,不能用。
   */
  useFixtures?: boolean;
  /** 每页大小;默认 50。压测 / 演示时可以调小。 */
  pageSize?: number;
  /** 复制安装命令后的回调(显示 toast);缺省走 onToast。 */
  onCopied?: (entry: { name: string }, command: string) => void;
}

interface PendingAction {
  entry: PiMarketEntryView;
  mode: "install" | "upgrade";
}

/** R85-FIX: describePiMarketError 返回 {title,hint,retryable},不能直接拼字符串。 */
function describeError(e: unknown): string {
  return describePiMarketError(piMarketErrorInfo(String(e))).hint;
}

export function PiMarketSection({
  onToast,
  useFixtures,
  pageSize,
  onCopied,
}: PiMarketSectionProps) {
  const [entries, setEntries] = useState<PiMarketEntryView[]>([]);
  const [sources, setSources] = useState<PiMarketRegistrySource[]>([]);
  const [_lockfile, setLockfile] = useState<PiMarketLockfile | null>(null);
  const [_audit, setAudit] = useState<PiMarketAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingIds, setInstallingIds] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await listPiMarket();
      setEntries(resp.entries);
      setSources(resp.sources ?? []);
      setLockfile(resp.lockfile ?? null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // R85: 把 window.location.search 翻译成 usePiMarketPage 的初值,
  // 让 search/type/sort/page 可分享 / 书签化(由 PiMarketTab 的 urlSync 镜像回去)。
  const urlHookOptions = useMemo(() => readPiMarketUrlState(
    typeof window !== "undefined" ? window.location.search : "",
  ), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ipcEntries = useMemo<MarketplaceEntry[]>(
    () => toPiPackageEntries(entries, sources),
    [entries, sources],
  );
  const fixturesActive = shouldInjectPiMarketFixtures(useFixtures);
  const marketplaceEntries = useMemo<MarketplaceEntry[]>(() => {
    if (ipcEntries.length === 0 && fixturesActive) return [...PI_MARKET_FIXTURES];
    return ipcEntries;
  }, [ipcEntries, fixturesActive]);
  /**
   * id → IPC view 的 O(1) 查表,避免 onOpenItem / onInstall 每次 render 都 O(N) 扫一遍。
   * IPC 来源的 entry 取自 IPC 返回的 `entries`(PiMarketEntryView[]);
   * 走 fixture fallback 的 entry 用 entry 自身最小字段构造伪 view,让 install / upgrade
   * 至少能走到 PendingDialog,IPC 真发了再走 reject / resolve。
   */
  const viewById = useMemo(() => {
    const map = new Map<string, PiMarketEntryView>();
    for (const view of entries) map.set(view.id, view);
    return map;
  }, [entries]);
  const fallbackViewById = useMemo(() => {
    const map = new Map<string, PiMarketEntryView>();
    for (const entry of marketplaceEntries) {
      if (viewById.has(entry.id)) continue;
      map.set(entry.id, {
        id: entry.id,
        name: entry.name,
        npmName: entry.npmName,
        recommendedVersion: entry.version,
        versions: [entry.version],
        versionCount: 1,
        alsoOfferedBy: [],
        capabilities: entry.capabilities ?? [],
        installedVersion: entry.installedVersion,
        sourceId: "fixture",
        sourceName: entry.sourceLabel ?? "fixture",
      } satisfies PiMarketEntryView);
    }
    return map;
  }, [marketplaceEntries, viewById]);
  const lookupView = useCallback(
    (entry: MarketplaceEntry): PiMarketEntryView | undefined =>
      viewById.get(entry.id) ?? fallbackViewById.get(entry.id),
    [viewById, fallbackViewById],
  );

  const sourceHint = useMemo(() => {
    if (sources.length === 0) return undefined;
    const primary = sources.find((s) => s.priority === 0) ?? sources[0];
    return primary?.name;
  }, [sources]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await refreshPiMarket();
      await reload();
      onToast?.("已刷新索引");
    } catch (e) {
      const hint = describeError(e);
      onToast?.(`刷新失败:${hint}`);
    } finally {
      setLoading(false);
    }
  }, [reload, onToast]);

  const triggerAction = useCallback(
    async (entry: PiMarketEntryView, mode: "install" | "upgrade") => {
      setInstallingIds((prev) => [...prev, entry.id]);
      setError(null);
      try {
        if (mode === "install") {
          await installPiMarket({ id: entry.id });
        } else {
          await upgradePiMarket({ id: entry.id });
        }
        await reload();
        onToast?.(mode === "install" ? "已安装" : "已升级");
      } catch (e) {
        const hint = describeError(e);
        setError(hint);
        onToast?.(`${mode === "install" ? "安装" : "升级"}失败:${hint}`);
      } finally {
        setInstallingIds((prev) => prev.filter((id) => id !== entry.id));
        setPending(null);
      }
    },
    [reload, onToast],
  );

  const openDialog = useCallback(
    (entry: PiMarketEntryView, mode: "install" | "upgrade") => {
      setPending({ entry, mode });
    },
    [],
  );

  const handleUninstall = useCallback(
    async (entry: PiMarketEntryView) => {
      setInstallingIds((prev) => [...prev, entry.id]);
      try {
        await uninstallPiMarket({ id: entry.id });
        await reload();
        onToast?.("已卸载");
      } catch (e) {
        onToast?.(`卸载失败:${describeError(e)}`);
      } finally {
        setInstallingIds((prev) => prev.filter((id) => id !== entry.id));
      }
    },
    [reload, onToast],
  );

  const handleRefreshAudit = useCallback(async () => {
    try {
      const resp = await auditPiMarket({ limit: 50 });
      setAudit(resp.entries ?? []);
    } catch {
      // 不打扰用户;audit 是辅助能力。
    }
  }, []);

  useEffect(() => {
    void handleRefreshAudit();
  }, [handleRefreshAudit]);

  return (
    <section
      className="pi-market-section"
      data-testid="pi-market-section"
      data-layout="pi-dev"
      role="region"
      aria-label="Pi 扩展市场 (R83 pi.dev 风格)"
      data-fixtures={fixturesActive ? "on" : "off"}
    >
      <header className="pi-market-section__header">
        <h2>Pi 市场(pi.dev 风格)</h2>
        <p>
          借鉴 pi.dev/packages 的目录式布局,数据走 OpenBuddy 的多源 IPC。 类型徽章 + 下载量排序 + <code>$ pi install npm:&lt;name&gt;</code> + Copy。
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-busy={loading}
          aria-label="刷新 Pi 扩展索引"
          data-testid="pi-market-section-refresh"
        >
          {loading ? "刷新中…" : "刷新索引"}
        </button>
      </header>

      <PiMarketTab
        entries={marketplaceEntries}
        loading={loading}
        error={error}
        urlSync
        onOpenItem={(entry) => {
          const view = lookupView(entry);
          if (view) openDialog(view, entry.installedVersion ? "upgrade" : "install");
        }}
        onInstall={(entry) => {
          const view = lookupView(entry);
          if (view) void triggerAction(view, "install");
        }}
        onRetry={() => void reload()}
        {...(sourceHint ? { sourceHint } : {})}
        hookOptions={{
          ...urlHookOptions,
          ...(pageSize ? { pageSize } : {}),
        }}
        onCopied={(entry, command) => {
          if (onCopied) onCopied(entry, command);
          else onToast?.(`已复制:${command}`);
        }}
        installingIds={installingIds}
      />

      {pending ? (
        <PendingDialog
          pending={pending}
          busy={installingIds.includes(pending.entry.id)}
          onConfirm={() => void triggerAction(pending.entry, pending.mode)}
          onCancel={() => setPending(null)}
          onUninstall={pending.mode === "upgrade" && pending.entry.installedVersion
            ? () => void handleUninstall(pending.entry)
            : undefined}
        />
      ) : null}
    </section>
  );
}

function PendingDialog({
  pending,
  busy,
  onConfirm,
  onCancel,
  onUninstall,
}: {
  pending: PendingAction;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUninstall?: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const title = pending.mode === "upgrade" ? "升级扩展" : "安装扩展";
  // Escape 关闭对话框(a11y 习惯);busy 时不允许(避免操作进行中误关)。
  useEffect(() => {
    if (busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="pi-market-pending-dialog"
    >
      <h3 id={titleId}>{title}</h3>
      <p id={bodyId}>
        {pending.entry.name}
        {pending.entry.recommendedVersion ? ` ${pending.entry.recommendedVersion}` : ""}
      </p>
      <button type="button" onClick={onCancel} disabled={busy} data-testid="pi-market-pending-cancel">
        取消
      </button>
      <button type="button" onClick={onConfirm} disabled={busy} data-testid="pi-market-pending-confirm">
        {busy ? "处理中…" : pending.mode === "upgrade" ? "升级" : "安装"}
      </button>
      {onUninstall ? (
        <button type="button" onClick={onUninstall} disabled={busy} data-testid="pi-market-pending-uninstall">卸载</button>
      ) : null}
    </div>
  );
}
