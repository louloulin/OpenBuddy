/**
 * 统一标签页系统 —— 对齐 WorkBuddy `agent-sidebar-ui/hooks/use-unified-tabs`。
 *
 * 核心思想：右侧栏跨视图共享一组「标签」。每当某个视图的 selection 变化
 * （选中产物 / 文件 / 网址 / 变更），就派生出一个「本应激活的标签」并自动
 * 打开（去重）。标签可关闭、可拖拽排序，并按会话(resetKey)在内存缓存中
 * 持久化，切回该会话时恢复。
 *
 * 与 WorkBuddy 的差异：openbuddy 本期只支持 4 个 kind ——
 *   artifact | file | preview | changes
 * （去掉 mcpApp / expert / fileChange，其中 fileChange 合并到 changes）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionArtifact } from "@/lib/agent/session-artifacts";
import type { FileChange } from "@/lib/files/file-changes";

/** 右侧栏支持的视图。 */
export type WorkspaceView =
  | "artifacts"
  | "fileTree"
  | "preview"
  | "changes";

/** 标签种类（决定图标 + 激活时切到哪个视图）。 */
export type TabKind = "artifact" | "file" | "preview" | "changes";

/** 一个统一标签页的描述符。 */
export interface UnifiedTab {
  /** 稳定 id（kind:opaqueId 形式）。 */
  id: string;
  kind: TabKind;
  /** 显示名（basename / 标题 / hostname）。 */
  label: string;
  /** 二级说明（完整路径 / URL），tooltip 用。 */
  subtitle?: string;
  /** 关联的产物 id（artifact / changes）。 */
  artifactId?: string;
  /** 关联的文件绝对路径（file）。 */
  filePath?: string;
  /** 关联的浏览器 URL（preview）。 */
  browserUrl?: string;
  /** 激活该标签时应切到的视图。 */
  viewWhenActive: WorkspaceView;
  /** 会话烙印：跨会话隔离用，避免缓存串台。 */
  ownerKey?: string;
}

/** 传入 useUnifiedTabs 的全部外部依赖。 */
export interface UseUnifiedTabsOptions {
  /** 会话级隔离键（通常是 sessionId）；变化时清空并恢复该会话的标签。 */
  resetKey?: string;
  /** 是否启用自动开标签（面板关闭时可禁用）。 */
  enabled: boolean;
  /** 当前激活的视图。 */
  currentView: WorkspaceView;
  // ---- 各视图的当前 selection ----
  selectedArtifactId?: string;
  selectedFilePath?: string;
  browserUrl?: string;
  // ---- 数据源（用于校验标签是否仍有效 + 派生 label） ----
  artifacts: SessionArtifact[];
  changes: FileChange[];
  // ---- 回调：标签激活 / 关闭时把 selection 应用到对应视图 ----
  onViewChange: (view: WorkspaceView) => void;
  onArtifactSelect: (id?: string) => void;
  onFileSelect?: (path?: string) => void;
  onBrowserUrlChange?: (url?: string) => void;
  /** 所有标签关闭时的钩子（面板可借此收起）。 */
  onAllTabsClosed?: () => void;
}

// ---------- 工具函数（纯函数，便于单测） ----------

/** 取路径最后一段作为显示名。 */
export function lastSegment(filePath?: string): string {
  if (!filePath) return filePath ?? "";
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/** 从 browserUrl 推导易读的 tab 标题：优先文件名，否则 host。 */
export function deriveBrowserLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    const last = path.length > 1 ? lastSegment(path) : "";
    if (last) {
      try {
        return decodeURIComponent(last);
      } catch {
        return last;
      }
    }
    return parsed.host || url;
  } catch {
    const seg = lastSegment(url) || url;
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  }
}

/** 生成代表 Tab 内容本身的签名，避免 preview:current 稳定 id 误拦不同 URL。 */
function getTabSignature(tab: UnifiedTab): string {
  switch (tab.kind) {
    case "artifact":
    case "changes":
      return `${tab.kind}:${tab.artifactId ?? ""}`;
    case "file":
      return `file:${tab.filePath ?? ""}`;
    case "preview":
      return `preview:${tab.browserUrl ?? ""}`;
    default:
      return tab.id;
  }
}

const RECENTLY_CLOSED_SUPPRESSION_MS = 1000;

function pruneRecentlyClosedSignatures(
  signatures: Map<string, number>,
  now = Date.now(),
): void {
  signatures.forEach((closedAt, signature) => {
    if (now - closedAt > RECENTLY_CLOSED_SUPPRESSION_MS)
      signatures.delete(signature);
  });
}

function rememberRecentlyClosedTabs(
  signatures: Map<string, number>,
  tabs: UnifiedTab[],
): void {
  const now = Date.now();
  pruneRecentlyClosedSignatures(signatures, now);
  tabs.forEach((tab) => signatures.set(getTabSignature(tab), now));
}

function shouldSuppressRecentlyClosedAutoOpen(
  signatures: Map<string, number>,
  candidate: UnifiedTab,
): boolean {
  pruneRecentlyClosedSignatures(signatures);
  if (signatures.size === 0) return false;
  if (signatures.has(getTabSignature(candidate))) return true;
  signatures.clear();
  return false;
}

/** 根据当前视图 + selection 派生「本应激活」的 tab 描述符。 */
export function deriveActiveTab(options: UseUnifiedTabsOptions): UnifiedTab | null {
  const { currentView } = options;
  if (currentView === "artifacts") {
    const id = options.selectedArtifactId;
    if (!id) return null;
    const artifact = options.artifacts.find((a) => a.id === id);
    if (!artifact) return null;
    return {
      id: `artifact:${artifact.id}`,
      kind: "artifact",
      label: artifact.title || artifact.path || artifact.id,
      subtitle: artifact.path,
      artifactId: artifact.id,
      viewWhenActive: "artifacts",
    };
  }
  if (currentView === "changes") {
    const id = options.selectedArtifactId;
    if (!id) return null;
    const change = options.changes.find((c) => c.path === id);
    if (!change) return null;
    return {
      id: `changes:${change.path}`,
      kind: "changes",
      label: change.name,
      subtitle: change.path,
      artifactId: change.path,
      viewWhenActive: "changes",
    };
  }
  if (currentView === "fileTree") {
    const path = options.selectedFilePath;
    if (!path) return null;
    return {
      id: `file:${path}`,
      kind: "file",
      label: lastSegment(path),
      subtitle: path,
      filePath: path,
      viewWhenActive: "fileTree",
    };
  }
  if (currentView === "preview") {
    const url = options.browserUrl;
    if (!url) return null;
    return {
      id: "preview:current",
      kind: "preview",
      label: deriveBrowserLabel(url),
      subtitle: url,
      browserUrl: url,
      viewWhenActive: "preview",
    };
  }
  return null;
}

/** 判断某个已有 tab 在当前数据下是否仍然有效（数据未被删除）。 */
function isTabStillValid(
  tab: UnifiedTab,
  options: UseUnifiedTabsOptions,
): boolean {
  switch (tab.kind) {
    case "artifact":
      return (
        !!tab.artifactId &&
        options.artifacts.some((a) => a.id === tab.artifactId)
      );
    case "changes":
      return (
        !!tab.artifactId &&
        options.changes.some((c) => c.path === tab.artifactId)
      );
    case "file":
    case "preview":
      return true;
    default:
      return true;
  }
}

/** 应用某个 tab 的 selection 到对应视图（切 view + 设 selection）。 */
function activateTab(tab: UnifiedTab, options: UseUnifiedTabsOptions): void {
  if (options.currentView !== tab.viewWhenActive)
    options.onViewChange(tab.viewWhenActive);
  switch (tab.kind) {
    case "artifact":
    case "changes":
      options.onArtifactSelect(tab.artifactId);
      return;
    case "file":
      options.onFileSelect?.(tab.filePath);
      return;
    case "preview":
      options.onBrowserUrlChange?.(tab.browserUrl);
      return;
  }
}

/** 关闭所有 tab 后清空所有 selection，避免跨 view 留下旧高亮。 */
function clearAllSelections(options: UseUnifiedTabsOptions): void {
  options.onArtifactSelect(undefined);
  options.onFileSelect?.(undefined);
  options.onBrowserUrlChange?.(undefined);
}

function applyTabOrder(
  tabs: UnifiedTab[],
  orderedIds: string[],
): UnifiedTab[] {
  if (orderedIds.length === 0) return tabs;
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const next: UnifiedTab[] = [];
  orderedIds.forEach((id) => {
    const tab = byId.get(id);
    if (tab && !next.includes(tab)) next.push(tab);
  });
  tabs.forEach((tab) => {
    if (!next.includes(tab)) next.push(tab);
  });
  if (
    next.length === tabs.length &&
    next.every((tab, index) => tab.id === tabs[index]?.id)
  )
    return tabs;
  return next;
}

// ---------- 会话级内存缓存（跨切会话保留标签，但非持久化到磁盘） ----------

const SESSION_TABS_CACHE_LIMIT = 50;
const sessionTabsCache = new Map<string, UnifiedTab[]>();

function cloneTabs(tabs: UnifiedTab[]): UnifiedTab[] {
  return tabs.map((tab) => ({ ...tab }));
}

function restoreSessionTabs(resetKey?: string): UnifiedTab[] {
  if (resetKey === undefined) return [];
  const cached = sessionTabsCache.get(resetKey);
  if (!cached) return [];
  // refresh LRU position
  sessionTabsCache.delete(resetKey);
  sessionTabsCache.set(resetKey, cached);
  return filterTabsByOwner(cloneTabs(cached), resetKey);
}

function saveSessionTabs(resetKey: string | undefined, tabs: UnifiedTab[]): void {
  if (resetKey === undefined) return;
  sessionTabsCache.delete(resetKey);
  sessionTabsCache.set(resetKey, cloneTabs(tabs));
  while (sessionTabsCache.size > SESSION_TABS_CACHE_LIMIT) {
    const oldest = sessionTabsCache.keys().next().value;
    if (!oldest) return;
    sessionTabsCache.delete(oldest);
  }
}

function collectArtifactTabIds(tabs: UnifiedTab[]): Set<string> {
  const ids = new Set<string>();
  tabs.forEach((tab) => {
    if (
      (tab.kind === "artifact" || tab.kind === "changes") &&
      tab.artifactId
    )
      ids.add(tab.artifactId);
  });
  return ids;
}

function findMissingArtifactIds(
  expectedIds: Set<string>,
  options: UseUnifiedTabsOptions,
): string[] {
  if (expectedIds.size === 0) return [];
  const availableIds = new Set<string>([
    ...options.artifacts.map((a) => a.id),
    ...options.changes.map((c) => c.path),
  ]);
  return Array.from(expectedIds).filter((id) => !availableIds.has(id));
}

/**
 * 按「会话烙印」过滤 tab：只保留 ownerKey === resetKey 的 tab。
 * 这是跨会话隔离的最终防线，与保存/恢复时机无关。
 */
function filterTabsByOwner(
  tabs: UnifiedTab[],
  resetKey: string | undefined,
): UnifiedTab[] {
  if (resetKey === undefined) return tabs;
  return tabs.filter(
    (tab) => tab.ownerKey === undefined || tab.ownerKey === resetKey,
  );
}

// ---------- 主 hook ----------

export interface UseUnifiedTabsResult {
  /** 当前可见的标签（已按 owner 过滤 + 数据有效性过滤）。 */
  tabs: UnifiedTab[];
  /** 当前激活的标签 id（可能为空）。 */
  activeTabId?: string;
  /** 切到指定标签（应用其 selection）。 */
  setActiveTab: (id: string) => void;
  /** 关闭指定标签。 */
  closeTab: (id: string) => void;
  /** 按给定顺序重排标签。 */
  reorderTabs: (orderedIds: string[]) => void;
}

export function useUnifiedTabs(
  options: UseUnifiedTabsOptions,
): UseUnifiedTabsResult {
  const initialOpenTabsRef = useRef<UnifiedTab[] | undefined>(undefined);
  if (initialOpenTabsRef.current === undefined)
    initialOpenTabsRef.current = restoreSessionTabs(options.resetKey);
  const [openTabs, setOpenTabs] = useState<UnifiedTab[]>(
    () => initialOpenTabsRef.current ?? [],
  );

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const prevResetKeyRef = useRef(options.resetKey);
  const skipNextAutoOpenRef = useRef(false);
  const recentlyClosedTabSignaturesRef = useRef(new Map<string, number>());
  const pendingRestoreArtifactIdsRef = useRef(
    collectArtifactTabIds(initialOpenTabsRef.current ?? []),
  );

  // 卸载时保存当前标签（跨严格模式二次挂载也能恢复）。
  useEffect(
    () => () => {
      saveSessionTabs(optionsRef.current.resetKey, openTabsRef.current);
    },
    [],
  );

  // resetKey 不变时，标签变化即持久化。
  useEffect(() => {
    if (prevResetKeyRef.current !== options.resetKey) return;
    saveSessionTabs(options.resetKey, openTabs);
  }, [options.resetKey, openTabs]);

  // resetKey 变化：保存旧会话标签 → 恢复新会话标签。
  useEffect(() => {
    const prevKey = prevResetKeyRef.current;
    const nextKey = options.resetKey;
    if (prevKey === nextKey) return;
    saveSessionTabs(prevKey, openTabsRef.current);
    prevResetKeyRef.current = nextKey;
    const restored = restoreSessionTabs(nextKey);
    setOpenTabs(restored);
    skipNextAutoOpenRef.current = true;
    recentlyClosedTabSignaturesRef.current.clear();
    pendingRestoreArtifactIdsRef.current = collectArtifactTabIds(restored);
  }, [options.resetKey]);

  // 派生当前应激活的标签。
  const activeTabCandidate = useMemo(
    () => deriveActiveTab(options),
    [
      options.currentView,
      options.selectedArtifactId,
      options.selectedFilePath,
      options.browserUrl,
      options.artifacts,
      options.changes,
    ],
  );
  const activeTabId = activeTabCandidate?.id;

  // 自动打开新派生的标签（去重 + 刚关闭抑制）。
  useEffect(() => {
    if (!options.enabled) return;
    if (!activeTabCandidate) {
      skipNextAutoOpenRef.current = false;
      recentlyClosedTabSignaturesRef.current.clear();
      return;
    }
    if (skipNextAutoOpenRef.current) {
      skipNextAutoOpenRef.current = false;
      return;
    }
    if (
      shouldSuppressRecentlyClosedAutoOpen(
        recentlyClosedTabSignaturesRef.current,
        activeTabCandidate,
      )
    )
      return;
    const candidateWithOwner: UnifiedTab = {
      ...activeTabCandidate,
      ownerKey: options.resetKey,
    };
    setOpenTabs((prev) => {
      const existingIdx = prev.findIndex(
        (t) => t.id === candidateWithOwner.id,
      );
      if (existingIdx === -1) return [...prev, candidateWithOwner];
      const existing = prev[existingIdx];
      if (
        existing.label === candidateWithOwner.label &&
        existing.subtitle === candidateWithOwner.subtitle &&
        existing.browserUrl === candidateWithOwner.browserUrl &&
        existing.filePath === candidateWithOwner.filePath &&
        existing.artifactId === candidateWithOwner.artifactId &&
        existing.ownerKey === candidateWithOwner.ownerKey
      )
        return prev;
      const next = [...prev];
      next[existingIdx] = candidateWithOwner;
      return next;
    });
  }, [options.enabled, activeTabCandidate, options.resetKey]);

  // 数据变化时剔除失效标签（等恢复中的 artifact id 全部就位后再过滤，
  // 避免恢复瞬间数据未到导致标签被误删）。
  useEffect(() => {
    if (
      findMissingArtifactIds(
        pendingRestoreArtifactIdsRef.current,
        optionsRef.current,
      ).length > 0
    )
      return;
    if (pendingRestoreArtifactIdsRef.current.size > 0)
      pendingRestoreArtifactIdsRef.current = new Set();
    setOpenTabs((prev) => {
      const filtered = prev.filter((tab) =>
        isTabStillValid(tab, optionsRef.current),
      );
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [options.artifacts, options.changes]);

  const setActiveTab = useCallback(
    (id: string) => {
      const tab = openTabs.find((t) => t.id === id);
      if (!tab) return;
      activateTab(tab, optionsRef.current);
    },
    [openTabs],
  );

  const closeTab = useCallback(
    (id: string) => {
      setOpenTabs((prev) => {
        const index = prev.findIndex((t) => t.id === id);
        if (index === -1) return prev;
        const closingTab = prev[index];
        const isActive = activeTabId === id;
        const opts = optionsRef.current;

        // 关闭 preview 标签时，联动关闭同源的 artifact 标签（对齐 WorkBuddy）。
        const linkedArtifactTabIds: string[] = [];
        if (closingTab.kind === "preview" && opts.selectedArtifactId) {
          for (const t of prev) {
            if (
              t.id !== id &&
              (t.kind === "artifact" || t.kind === "changes") &&
              t.artifactId === opts.selectedArtifactId
            )
              linkedArtifactTabIds.push(t.id);
          }
        }
        const idsToRemove = new Set([id, ...linkedArtifactTabIds]);
        rememberRecentlyClosedTabs(
          recentlyClosedTabSignaturesRef.current,
          prev.filter((t) => idsToRemove.has(t.id)),
        );
        const next = prev.filter((t) => !idsToRemove.has(t.id));
        if (next.length === 0) {
          clearAllSelections(opts);
          opts.onAllTabsClosed?.();
          if (
            closingTab.kind === "preview" &&
            opts.currentView === "preview"
          )
            opts.onViewChange("artifacts");
          return next;
        }
        if (closingTab.kind === "preview") {
          opts.onBrowserUrlChange?.(undefined);
          opts.onArtifactSelect(undefined);
          if (opts.currentView === "preview")
            opts.onViewChange("artifacts");
        }
        if (!isActive) return next;
        activateTab(next[Math.min(index, next.length - 1)], opts);
        return next;
      });
    },
    [activeTabId],
  );

  const reorderTabs = useCallback((orderedIds: string[]) => {
    setOpenTabs((prev) => applyTabOrder(prev, orderedIds));
  }, []);

  // 计算 visible tabs：owner 过滤 + 数据有效性过滤。
  const artifactIdSet = useMemo(
    () => new Set(options.artifacts.map((a) => a.id)),
    [options.artifacts],
  );
  const changesPathSet = useMemo(
    () => new Set(options.changes.map((c) => c.path)),
    [options.changes],
  );
  const visibleTabs = useMemo(
    () =>
      filterTabsByOwner(openTabs, options.resetKey).filter((tab) => {
        if (tab.kind === "preview")
          return !!options.browserUrl && tab.browserUrl === options.browserUrl;
        if (tab.kind === "artifact" && tab.artifactId)
          return artifactIdSet.has(tab.artifactId);
        if (tab.kind === "changes" && tab.artifactId)
          return changesPathSet.has(tab.artifactId);
        return true;
      }),
    [
      openTabs,
      options.resetKey,
      options.browserUrl,
      artifactIdSet,
      changesPathSet,
    ],
  );

  return {
    tabs: visibleTabs,
    activeTabId: visibleTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : undefined,
    setActiveTab,
    closeTab,
    reorderTabs,
  };
}
