/**
 * PiExtensionsSection — 「Pi 扩展」区块。
 *
 * R32 / Phase D — Expert Marketplace Bridge 的表现层。挂在「市场」面板顶部
 * (MarketplacePanel 之上),用 ui-modules 的 `MarketplaceTab` / `InstallDialog`
 * 呈现桥接层的数据 —— OpenBuddy 相对 WorkBuddy 的**开源差异化**在这里落地:
 * 任何 Pi 扩展都能从索引装进来,带版本选择、高风险能力显式同意、原子提交与回滚。
 *
 * 为什么单独一个组件而不是塞进 MarketplacePanel:
 *   - MarketplacePanel 走的是 pi 官方 marketplace(`x.ai/marketplace/*`),
 *     数据模型、安装语义、失败模式都完全不同;
 *   - 这里全部状态自持(加载 / 刷新 / 安装对话框 / 错误码 → 补救动作),宿主只需
 *     提供一个 `onToast`。两者共享的只有 `marketplace-panel` 的排版约定。
 *
 * 产品立场:本地优先 / 数据自决 —— **没配置索引源就不联网**,区块会明确告诉用户
 * 源该写在哪里,而不是显示一个坏掉的列表。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Puzzle } from "lucide-react";
import { InstallDialog } from "@openbuddy/ui-modules/components/InstallDialog";
import { MarketplaceTab } from "@openbuddy/ui-modules/components/MarketplaceTab";
import type { MarketplaceMenuItem } from "@openbuddy/ui-modules/components";
import type { InstallState, MarketplaceKind } from "@openbuddy/ui-modules/components/marketplace-model";
import { confirm } from "@/lib/platform/electron-api";
import {
  auditPiMarket,
  installPiMarket,
  listPiMarket,
  lockfilePiMarket,
  piMarketErrorInfo,
  refreshPiMarket,
  rollbackPiMarket,
  uninstallPiMarket,
  upgradePiMarket,
  type PiMarketAuditEntry,
  type PiMarketEntryView,
  type PiMarketLockfile,
  type PiMarketSourceStatus,
} from "@/lib/pi-market/pi-market-client";
import {
  describePiMarketError,
  groupPiMarketEntries,
  mirrorLabel,
  sourceChips,
  summarizeSources,
  toMarketplaceEntry,
} from "./pi-extensions-model";

interface PiExtensionsSectionProps {
  onToast?: (message: string) => void;
}

interface PendingAction {
  entry: PiMarketEntryView;
  mode: "install" | "upgrade";
}

const SOURCE_STATE_LABELS: Record<string, string> = {
  fresh: "已拉取",
  cached: "用缓存",
  failed: "不可达",
  skipped: "已跳过",
};

export function PiExtensionsSection({ onToast }: PiExtensionsSectionProps) {
  const [entries, setEntries] = useState<readonly PiMarketEntryView[]>([]);
  const [lockfile, setLockfile] = useState<PiMarketLockfile | null>(null);
  const [audit, setAudit] = useState<readonly PiMarketAuditEntry[]>([]);
  const [statuses, setStatuses] = useState<readonly PiMarketSourceStatus[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogConsent, setDialogConsent] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<readonly MarketplaceKind[]>([]);
  const [stateFilter, setStateFilter] = useState<readonly InstallState[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, lock, trail] = await Promise.all([
        listPiMarket(),
        lockfilePiMarket().catch(() => null),
        auditPiMarket({ limit: 20 }).catch(() => ({ entries: [] as const })),
      ]);
      setEntries(list?.entries ?? []);
      setLockfile(lock);
      setAudit(trail?.entries ?? []);
      setLoadError(null);
    } catch (error) {
      setEntries([]);
      setLoadError(describePiMarketError(piMarketErrorInfo(error)).hint);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const report = await refreshPiMarket();
      setStatuses(report?.sources);
      const failed = report?.failed?.length ?? 0;
      onToast?.(
        failed > 0
          ? `索引已刷新：${report?.count ?? 0} 条,${failed} 个源不可达`
          : `索引已刷新：${report?.count ?? 0} 条`,
      );
      await reload();
    } catch (error) {
      const action = describePiMarketError(piMarketErrorInfo(error));
      onToast?.(`刷新失败：${action.title}`);
      setLoadError(action.hint);
    } finally {
      setRefreshing(false);
    }
  }, [onToast, reload]);

  const openDialog = useCallback((entry: PiMarketEntryView, mode: PendingAction["mode"]) => {
    setPending({ entry, mode });
    setDialogError(null);
    setDialogConsent(false);
  }, []);

  const markBusy = (id: string, busy: boolean) => {
    setBusyIds((current) =>
      busy ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    );
  };

  const runAction = useCallback(
    async (
      id: string,
      task: () => Promise<{ version?: string; changed: boolean }>,
      successMessage?: (result: { version?: string; changed: boolean }) => string,
    ) => {
      markBusy(id, true);
      try {
        const result = await task();
        onToast?.(
          successMessage?.(result) ??
            (result.changed ? `已就绪：${id}@${result.version}` : `${id} 已经是 ${result.version}`),
        );
        await reload();
        return null;
      } catch (error) {
        const action = describePiMarketError(piMarketErrorInfo(error));
        return `${action.title} —— ${action.hint}`;
      } finally {
        markBusy(id, false);
      }
    },
    [onToast, reload],
  );

  const handleConfirm = useCallback(
    async (options: { version: string; allowHighRisk: boolean }) => {
      if (!pending) return;
      setDialogBusy(true);
      setDialogError(null);
      const action =
        pending.mode === "upgrade"
          ? () => upgradePiMarket({ id: pending.entry.id, allowHighRisk: options.allowHighRisk })
          : () =>
              installPiMarket({
                id: pending.entry.id,
                version: options.version,
                allowHighRisk: options.allowHighRisk,
              });
      const failure = await runAction(pending.entry.id, action);
      setDialogBusy(false);
      if (failure) {
        setDialogError(failure);
        return;
      }
      setPending(null);
    },
    [pending, runAction],
  );

  const handleRollback = useCallback(
    async (entry: PiMarketEntryView) => {
      const ok = await confirm(`回滚「${entry.name}」到上一个版本？`, {
        tone: "warning",
        description: "当前版本目录会保留,回滚只移动 lockfile 里的激活指针。",
      });
      if (!ok) return;
      const failure = await runAction(entry.id, () => rollbackPiMarket({ id: entry.id }));
      if (failure) onToast?.(`回滚失败：${failure}`);
    },
    [onToast, runAction],
  );

  /**
   * R33 — 卸载。在此之前装了 Pi 扩展没有任何卸载入口(只能去手删目录),
   * 审计里也查不出「装过又删了」。
   */
  const handleUninstall = useCallback(
    async (entry: PiMarketEntryView) => {
      const ok = await confirm(`卸载「${entry.name}」？`, {
        tone: "warning",
        description: "会删除本地版本目录并摘掉 lockfile 记录(加载器跟着 lockfile 走);审计日志保留这次操作。",
      });
      if (!ok) return;
      const failure = await runAction(
        entry.id,
        async () => {
          const result = await uninstallPiMarket({ id: entry.id });
          return { version: result.version, changed: true };
        },
        (result) => `已卸载：${entry.id}${result.version ? `@${result.version}` : ""}`,
      );
      if (failure) onToast?.(`卸载失败：${failure}`);
    },
    [onToast, runAction],
  );

  /** 载荷被外部改写(corrupt-install)时的自救入口,等价于勾选「强制重新物化」。 */
  const handleForceReinstall = useCallback(
    async (entry: PiMarketEntryView) => {
      const target = entry.installedVersion ?? entry.version;
      const failure = await runAction(
        entry.id,
        async () => {
          const result = await installPiMarket({
            id: entry.id,
            version: target,
            force: true,
            allowHighRisk: true,
          });
          return result;
        },
        (result) => `已重装：${entry.id}@${result.version}`,
      );
      if (failure) onToast?.(`重装失败：${failure}`);
    },
    [onToast, runAction],
  );

  const findSource = useCallback(
    (id: string) => entries.find((item) => item.id === id),
    [entries],
  );

  /**
   * 卡片⋯菜单:两条都是**逐条目**适用的动作,所以用 `visible` 谓词而不是
   * 给未安装的条目画一个点了会报错的按钮。
   * 「强制重装」传 `allowHighRisk: true` 是刻意的:用户上一轮安装已经同意过
   * 这些能力,重装同一个版本不该再问一次。
   */
  const menuItems = useMemo<readonly MarketplaceMenuItem[]>(
    () => [
      {
        id: "pi-force-reinstall",
        label: "强制重装(修复被改写的载荷)",
        visible: (entry) => Boolean(entry.installedVersion),
        onSelect: (entry) => {
          const source = findSource(entry.id);
          if (source) void handleForceReinstall(source);
        },
      },
      {
        id: "pi-uninstall",
        label: "卸载",
        danger: true,
        visible: (entry) => Boolean(entry.installedVersion),
        onSelect: (entry) => {
          const source = findSource(entry.id);
          if (source) void handleUninstall(source);
        },
      },
    ],
    [findSource, handleForceReinstall, handleUninstall],
  );

  const marketplaceEntries = useMemo(() => entries.map(toMarketplaceEntry), [entries]);
  const groups = useMemo(() => groupPiMarketEntries(entries), [entries]);
  const chips = useMemo(() => sourceChips(entries, statuses), [entries, statuses]);
  const sourceSummary = useMemo(() => summarizeSources(statuses), [statuses]);
  const mirrorSummary = useMemo(() => mirrorHint(entries), [entries]);
  const lastSuccess = useMemo(() => {
    const success = audit.find((item) => item.outcome === "success");
    return success ? `${success.extensionId}@${success.version ?? "?"} · ${success.action}` : null;
  }, [audit]);

  // 索引源一条都没配(或配了但都拉不到)时,列表本来就该是空的 —— 这时给
  // 「源该写在哪里」的说明,比渲染一个大空列表有用。
  const showEmptyState = !loading && entries.length === 0;

  return (
    <section className="pi-ext" data-testid="pi-extensions-section">
      <header className="pi-ext__header">
        <h3 className="pi-ext__title">
          <Puzzle size={16} aria-hidden /> Pi 扩展
        </h3>
        <div className="pi-ext__actions">
          <span className="pi-ext__stat">
            已装 {Object.keys(lockfile?.extensions ?? {}).length}
            {groups.updatable.length > 0 ? ` · 可升级 ${groups.updatable.length}` : ""}
            {` · 索引 ${entries.length}`}
          </span>
          <button
            type="button"
            className="pi-ext__btn"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            data-testid="pi-ext-refresh"
          >
            {refreshing ? "刷新中…" : "刷新索引"}
          </button>
        </div>
      </header>

      {chips.length > 0 && (
        <div className="pi-ext__sources" data-testid="pi-ext-sources">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className={`pi-ext__source-chip${chip.state ? ` pi-ext__source-chip--${chip.state}` : ""}`}
              title={chip.error ?? undefined}
            >
              {chip.label}
              <span className="pi-ext__source-count">{chip.entryCount}</span>
              {chip.state ? ` · ${SOURCE_STATE_LABELS[chip.state] ?? chip.state}` : ""}
            </span>
          ))}
        </div>
      )}

      {mirrorSummary && <p className="pi-ext__hint">{mirrorSummary}</p>}

      {sourceSummary.warning && (
        <p className="pi-ext__warning" role="status">
          {sourceSummary.warning}
        </p>
      )}

      {loadError && (
        <p className="pi-ext__error" role="alert">
          {loadError}
        </p>
      )}

      {showEmptyState ? (
        <div className="pi-ext__empty" data-testid="pi-ext-empty">
          <p className="pi-ext__empty-title">还没有配置索引源</p>
          <p className="pi-ext__empty-hint">
            OpenBuddy 的市场是<strong>本地优先</strong>的:没配置源就不会联网。要装 Pi
            扩展,把源写进数据目录下的 <code>pi-extensions/sources.json</code>
            (或设环境变量 <code>OPENBUDDY_PI_MARKET_SOURCES</code>),也可以直接把内网导出的{" "}
            <code>pi-extensions/registry.json</code> 拷进来。写好后点「刷新索引」。
          </p>
          <p className="pi-ext__empty-hint">
            同一个扩展被多个源提供时<strong>权重大的赢</strong>,低权重源只做镜像补齐;
            单个源掉线会自动退回它上次成功的缓存,不会拖垮整个市场。
          </p>
          {lastSuccess && <p className="pi-ext__empty-hint">上次成功:{lastSuccess}</p>}
        </div>
      ) : (
        <MarketplaceTab
          entries={marketplaceEntries}
          loading={loading}
          error={null}
          query={query}
          onQueryChange={setQuery}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          capabilityFilter={[]}
          installStateFilter={stateFilter}
          onInstallStateFilterChange={setStateFilter}
          installingIds={busyIds}
          menuItems={menuItems}
          onInstall={(entry) => {
            const source = entries.find((item) => item.id === entry.id);
            if (source) openDialog(source, "install");
          }}
          onUpgrade={(entry) => {
            const source = entries.find((item) => item.id === entry.id);
            if (source) openDialog(source, "upgrade");
          }}
          onRollback={(entry) => {
            const source = entries.find((item) => item.id === entry.id);
            if (source) void handleRollback(source);
          }}
          emptyTitle="索引里还没有扩展"
          emptyHint="点「刷新索引」重新拉取,或检查各源的可达性。"
        />
      )}

      {pending && (
        <InstallDialog
          open
          entry={toMarketplaceEntry(pending.entry)}
          versions={pending.entry.versions}
          progress={dialogBusy ? { phase: pending.mode === "upgrade" ? "升级中" : "安装中" } : null}
          error={dialogError}
          consentChecked={dialogConsent}
          onConsentChange={setDialogConsent}
          busy={dialogBusy}
          confirmLabel={pending.mode === "upgrade" ? "升级" : "安装"}
          onConfirm={(options) => void handleConfirm(options)}
          onCancel={() => {
            setPending(null);
            setDialogError(null);
          }}
        />
      )}

    </section>
  );
}

/** 一行汇总「哪些条目还有镜像源」,省得用户逐张卡片找。 */
function mirrorHint(entries: readonly PiMarketEntryView[]): string | null {
  const mirrored = entries.filter((entry) => (entry.alsoOfferedBy ?? []).length > 0);
  if (mirrored.length === 0) return null;
  return `${mirrored.length} 个扩展同时被其它源提供:${mirrored
    .slice(0, 3)
    .map((entry) => `${entry.name}(${mirrorLabel(entry) ?? ""})`)
    .join("、")}${mirrored.length > 3 ? " 等" : ""}`;
}
