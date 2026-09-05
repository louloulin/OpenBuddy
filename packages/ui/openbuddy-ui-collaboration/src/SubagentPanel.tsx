/**
 * 子 agent / 团队运行时面板 —— 对齐 WorkBuddy `team-runtime` /
 * `session:getSubagentList`。
 *
 * 主数据源: `subagent-store`(实时 `pi://subagent` 事件——turns/tokens/duration/进度)。
 * 回退: 从会话消息派生 spawn_subagent 活动(无实时进度,仅状态)。
 * 两者合并去重(实时数据优先)。空时不渲染。
 */
import { useEffect, useMemo, useState } from "react";
import { useSubagentStore } from "@/stores/subagent-store";
import { useSessionStore } from "@/stores/session-store";
import { deriveSubagents } from "@/lib/agent/subagents";
import { getRendererPluginRuntime } from "@/lib/runtime/renderer-plugin-runtime";
import { piListSessions } from "@/lib/agent/pi-client";
import type {
  DeepSeekSessionListSnapshot,
  DeepSeekSessionRecord,
  DeepSeekSubagentAddress,
  DeepSeekSubagentEntry,
  DeepSeekSubagentOpenOptions,
} from "@openbuddy/renderer-host";

interface SubagentPanelProps {
  /** Pass-through messages for transcript-derived fallback. */
  messages?: import("@/stores/session-store").ChatMessage[];
  /** Keep the legacy WorkBuddy transcript focused with the Harness route. */
  onOpenSession?: (sessionId: string, cwd?: string) => void | Promise<void>;
  cwd?: string;
}

const STATUS_LABEL: Record<string, string> = {
  running: "运行中",
  in_progress: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const EMPTY_SESSION_SNAPSHOT: DeepSeekSessionListSnapshot = {
  items: [],
  byId: {},
  current: undefined,
  state: "idle",
  phase: "pending",
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
  subagentBreadcrumb: [],
  error: undefined,
};

interface RendererSessionsService {
  list: {
    getSnapshot: () => DeepSeekSessionListSnapshot;
    subscribe: (listener: () => void) => () => void;
  };
  refresh?: (cwd?: string) => Promise<unknown>;
  open: (sessionId: string, options?: DeepSeekSubagentOpenOptions) => void;
  openSubagent: (address: DeepSeekSubagentAddress, options?: DeepSeekSubagentOpenOptions) => void;
}

function getRendererSessions(): RendererSessionsService | undefined {
  return getRendererPluginRuntime().context.get("sessions") as RendererSessionsService | undefined;
}

function formatDuration(ms?: number): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `${m}m${rs}s` : `${m}m`;
}

function formatTokens(n?: number): string {
  if (!n) return "";
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

export function SubagentPanel({ messages, onOpenSession, cwd }: SubagentPanelProps) {
  const sessionId = useSessionStore((s) => s.sessionId);
  const rendererRuntime = getRendererPluginRuntime();
  const [piSessionItems, setPiSessionItems] = useState<DeepSeekSessionRecord[]>([]);
  const [sessionSnapshot, setSessionSnapshot] = useState<DeepSeekSessionListSnapshot>(
    () => getRendererSessions()?.list.getSnapshot() ?? EMPTY_SESSION_SNAPSHOT,
  );

  useEffect(() => {
    let disposed = false;
    let currentService: RendererSessionsService | undefined;
    let unsubscribe: () => void = () => undefined;
    const attach = (): void => {
      const sessions = getRendererSessions();
      if (!sessions || sessions === currentService) {
        if (sessions && !disposed) setSessionSnapshot(sessions.list.getSnapshot());
        return;
      }
      unsubscribe();
      currentService = sessions;
      const sync = () => {
        if (!disposed) setSessionSnapshot(sessions.list.getSnapshot());
      };
      sync();
      unsubscribe = sessions.list.subscribe(sync);
      void sessions.refresh?.().catch(() => undefined);
    };
    // Initial sync + re-attach on plugin / profile lifecycle events. The
    // previous implementation also polled every 100ms; the same events that
    // would change `getRendererSessions()` are already emitted on the runtime,
    // so the polling is redundant and wastes CPU on idle.
    attach();
    const refresh = () => {
      const sessions = getRendererSessions();
      if (sessions) setSessionSnapshot(sessions.list.getSnapshot());
    };
    const disposers = [
      rendererRuntime.events.on("plugin/loaded", attach),
      rendererRuntime.events.on("profile/loaded", attach),
      rendererRuntime.events.on("profile/reloaded", attach),
    ];
    return () => {
      disposed = true;
      unsubscribe();
      disposers.forEach((dispose) => dispose());
    };
  }, [rendererRuntime]);

  const liveSubagents = useSubagentStore((s) =>
    sessionId ? s.getForSession(sessionId) : [],
  );

  // Fallback: transcript-derived subagents (for when pi doesn't emit
  // subagent notifications, e.g. older pi versions).
  const fallbackActivities = useMemo(() => {
    if (!messages) return [];
    return deriveSubagents(messages);
  }, [messages]);

  // Merge: live data first, then fallback activities not in live set.
  const liveIds = useMemo(() => new Set(liveSubagents.map((s) => s.id)), [liveSubagents]);
  const extra = useMemo(
    () => fallbackActivities.filter((a) => !liveIds.has(a.id)),
    [fallbackActivities, liveIds],
  );

  // The legacy App session store is the authoritative focus for the WorkBuddy
  // transcript. During the short async Harness transition, prefer it so a
  // stale addressed route cannot keep showing the previous child's catalog.
  const activeSessionId = sessionId ?? sessionSnapshot.current ?? undefined;
  const activeSessionCwd = activeSessionId ? sessionSnapshot.byId[activeSessionId]?.cwd : undefined;
  useEffect(() => {
    if (!activeSessionId) return;
    let disposed = false;
    void piListSessions(cwd ?? activeSessionCwd ?? "").then((items) => {
      if (!disposed) setPiSessionItems(items as DeepSeekSessionRecord[]);
    }).catch(() => {
      if (!disposed) setPiSessionItems([]);
    });
    return () => { disposed = true; };
  }, [activeSessionCwd, activeSessionId, cwd]);
  const effectiveItems = useMemo(() => {
    const byId = new Map(sessionSnapshot.items.map((item) => [item.sessionId, item]));
    for (const item of piSessionItems) byId.set(item.sessionId, { ...byId.get(item.sessionId), ...item });
    return [...byId.values()];
  }, [piSessionItems, sessionSnapshot.items]);
  const effectiveById = useMemo(
    () => Object.fromEntries(effectiveItems.map((item) => [item.sessionId, item])),
    [effectiveItems],
  );
  useEffect(() => {
    const sessions = getRendererSessions();
    if (!sessions?.refresh || !activeSessionId) return;
    void sessions.refresh(activeSessionCwd).catch(() => undefined);
  }, [activeSessionCwd, activeSessionId]);
  const routeAligned = !sessionSnapshot.currentAddress
    || !sessionId
    || sessionSnapshot.currentAddress.childSessionId === sessionId;
  const fallbackAddress = useMemo<DeepSeekSubagentAddress | undefined>(() => {
    if (!sessionId) return undefined;
    const item = effectiveById[sessionId];
    if (!item?.parentSessionId || !item.subagentMode) return undefined;
    return {
      parentSessionId: item.parentSessionId,
      childSessionId: item.sessionId,
      mode: item.subagentMode,
    };
  }, [effectiveById, sessionId]);
  const currentAddress = routeAligned ? (sessionSnapshot.currentAddress ?? fallbackAddress) : fallbackAddress;
  const catalogParentId = currentAddress?.childSessionId ?? activeSessionId;
  const catalog = catalogParentId ? sessionSnapshot.subagentsByParent[catalogParentId] : undefined;
  const catalogChildren = useMemo(
    () => (catalog?.entries ?? []).filter(
      (entry): entry is Extract<DeepSeekSubagentEntry, { kind: "child" }> => entry.kind === "child",
    ),
    [catalog],
  );
  const sessionChildren = useMemo(() => {
    if (!catalogParentId) return [];
    const catalogIds = new Set(catalogChildren.map((entry) => entry.id));
    return effectiveItems
      .filter((item) => item.parentSessionId === catalogParentId && item.subagentMode && !catalogIds.has(item.sessionId))
      .map((item) => ({
        kind: "child" as const,
        id: item.sessionId,
        activity: item.running ? "running" as const : "inactive" as const,
        hasChildren: effectiveItems.some((candidate) => candidate.parentSessionId === item.sessionId),
        mode: item.subagentMode!,
        label: item.title,
      }));
  }, [catalogChildren, catalogParentId, effectiveItems]);
  const allCatalogChildren = useMemo(
    () => [...catalogChildren, ...sessionChildren],
    [catalogChildren, sessionChildren],
  );
  const liveIdsIncludingChildren = useMemo(
    () => new Set(liveSubagents.map((entry) => entry.childSessionId ?? entry.id)),
    [liveSubagents],
  );
  const navigableCatalogChildren = useMemo(
    () => allCatalogChildren.filter((entry) => !liveIdsIncludingChildren.has(entry.id)),
    [allCatalogChildren, liveIdsIncludingChildren],
  );
  const breadcrumb = useMemo(() => {
    if (!currentAddress) return [] as DeepSeekSubagentAddress[];
    if (sessionSnapshot.subagentBreadcrumb.length > 0) return [...sessionSnapshot.subagentBreadcrumb];
    const result: DeepSeekSubagentAddress[] = [];
    const seen = new Set<string>();
    let address: DeepSeekSubagentAddress | undefined = currentAddress;
    while (address && !seen.has(address.childSessionId)) {
      seen.add(address.childSessionId);
      result.unshift(address);
      const parent: typeof effectiveById[string] | undefined = effectiveById[address.parentSessionId];
      address = parent?.parentSessionId && parent.subagentMode
        ? { parentSessionId: parent.parentSessionId, childSessionId: parent.sessionId, mode: parent.subagentMode }
        : undefined;
    }
    return result;
  }, [currentAddress, effectiveById, sessionSnapshot.subagentBreadcrumb]);
  const rootAddress = breadcrumb[0];
  const openSubagent = (address: DeepSeekSubagentAddress) =>
    getRendererSessions()?.openSubagent(address, { loadConversation: false });
  const openSession = (sessionId: string, address?: DeepSeekSubagentAddress) => {
    const sessionCwd = effectiveById[sessionId]?.cwd;
    if (address) openSubagent(address);
    onOpenSession?.(sessionId, sessionCwd ?? "");
  };
  const addressFor = (childSessionId: string, mode: DeepSeekSubagentAddress["mode"]): DeepSeekSubagentAddress | undefined =>
    catalogParentId ? { parentSessionId: catalogParentId, childSessionId, mode } : undefined;
  const labelFor = (entry: Extract<DeepSeekSubagentEntry, { kind: "child" }>) =>
    entry.label || effectiveById[entry.id]?.title || entry.id;

  const allCount = liveSubagents.length + extra.length + navigableCatalogChildren.length;
  const runningCount =
    liveSubagents.filter((s) => s.status === "running").length +
    extra.filter((a) => a.status === "in_progress").length +
    navigableCatalogChildren.filter((entry) => entry.activity === "running").length;
  const completedCount =
    liveSubagents.filter((s) => s.status === "completed").length +
    extra.filter((a) => a.status === "completed").length;
  const failedCount =
    liveSubagents.filter((s) => s.status === "failed" || s.status === "cancelled").length +
    extra.filter((a) => a.status === "failed").length;

  if (allCount === 0 && !currentAddress) return null;

  return (
    <div className="subagent-panel" role="region" aria-label="子代理运行时">
      <div className="subagent-panel__head">
        <span className="subagent-panel__title">子代理</span>
        <span className="subagent-panel__summary">
          {allCount} 个 · 运行中 {runningCount}
          {completedCount > 0 ? ` · 完成 ${completedCount}` : ""}
          {failedCount > 0 ? ` · 失败 ${failedCount}` : ""}
        </span>
      </div>
      {currentAddress && (
        <nav className="subagent-panel__breadcrumb" aria-label="子代理路径">
          <button
            type="button"
            className="subagent-panel__crumb"
            onClick={() => {
              if (!rootAddress) return;
              getRendererSessions()?.open(rootAddress.parentSessionId, { loadConversation: false });
              onOpenSession?.(rootAddress.parentSessionId, effectiveById[rootAddress.parentSessionId]?.cwd);
            }}
          >
            主会话
          </button>
          {breadcrumb.map((address, index) => (
            <span className="subagent-panel__crumb-group" key={address.childSessionId}>
              <span className="subagent-panel__crumb-separator">›</span>
              <button
                type="button"
                className="subagent-panel__crumb"
                aria-current={index === breadcrumb.length - 1 ? "page" : undefined}
                onClick={() => openSession(address.childSessionId, address)}
              >
                {effectiveById[address.childSessionId]?.title || address.childSessionId}
              </button>
            </span>
          ))}
        </nav>
      )}
      <ul className="subagent-panel__list">
        {navigableCatalogChildren.map((entry) => {
          const address = addressFor(entry.id, entry.mode);
          return (
            <li key={entry.id} className="subagent-panel__row subagent-panel__row--catalog">
              <span className="subagent-panel__dot" />
              <div className="subagent-panel__info">
                <div className="subagent-panel__name-line">
                  <button
                    type="button"
                    className="subagent-panel__name subagent-panel__name-button"
                    onClick={() => address && openSession(entry.id, address)}
                    disabled={!address}
                  >
                    {labelFor(entry)}
                  </button>
                  <span className="subagent-panel__type">{entry.mode === "continuable" ? "可继续" : "单次"}</span>
                </div>
                <div className="subagent-panel__progress">
                  <span>{entry.hasChildren ? "含嵌套子代理" : "子代理会话"}</span>
                </div>
              </div>
              <span className="subagent-panel__status">{entry.activity === "running" ? "运行中" : "可查看"}</span>
            </li>
          );
        })}
        {/* Live subagents (rich progress) */}
        {liveSubagents.map((rt) => (
          <li
            key={rt.id}
            className={"subagent-panel__row subagent-panel__row--" + rt.status}
          >
            <span className="subagent-panel__dot" />
            <div className="subagent-panel__info">
              <div className="subagent-panel__name-line">
                <span className="subagent-panel__name">
                  {rt.description || rt.subagentType || "子代理"}
                </span>
                {rt.subagentType && rt.description && (
                  <span className="subagent-panel__type">{rt.subagentType}</span>
                )}
              </div>
              <div className="subagent-panel__progress">
                {rt.status === "running" && (
                  <>
                    {rt.turnCount != null && <span>{rt.turnCount} 轮</span>}
                    {rt.toolCallCount != null && rt.toolCallCount > 0 && (
                      <span>{rt.toolCallCount} 工具</span>
                    )}
                    {formatDuration(rt.durationMs) && (
                      <span>{formatDuration(rt.durationMs)}</span>
                    )}
                    {formatTokens(rt.tokensUsed) && (
                      <span>{formatTokens(rt.tokensUsed)} tok</span>
                    )}
                    {rt.contextUsagePct != null && rt.contextUsagePct > 0 && (
                      <span className="subagent-panel__ctx">{rt.contextUsagePct}% ctx</span>
                    )}
                    {rt.toolsUsed && rt.toolsUsed.length > 0 && (
                      <span className="subagent-panel__tools">
                        {rt.toolsUsed.slice(0, 5).join(", ")}
                        {rt.toolsUsed.length > 5 ? "…" : ""}
                      </span>
                    )}
                  </>
                )}
                {rt.status !== "running" && (
                  <>
                    {rt.turnCount != null && <span>{rt.turnCount} 轮</span>}
                    {rt.toolCallCount != null && rt.toolCallCount > 0 && (
                      <span>{rt.toolCallCount} 工具</span>
                    )}
                    {formatDuration(rt.durationMs) && (
                      <span>{formatDuration(rt.durationMs)}</span>
                    )}
                    {rt.error && <span className="subagent-panel__error">{rt.error}</span>}
                  </>
                )}
              </div>
            </div>
            <span className="subagent-panel__status">
              {STATUS_LABEL[rt.status] ?? rt.status}
            </span>
          </li>
        ))}
        {/* Fallback: transcript-derived (no live progress) */}
        {extra.map((a) => (
          <li
            key={a.id}
            className={"subagent-panel__row subagent-panel__row--" + a.status}
            title={a.id}
          >
            <span className="subagent-panel__dot" />
            <div className="subagent-panel__info">
              <div className="subagent-panel__name-line">
                <span className="subagent-panel__name">{a.name}</span>
              </div>
            </div>
            <span className="subagent-panel__status">{STATUS_LABEL[a.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
