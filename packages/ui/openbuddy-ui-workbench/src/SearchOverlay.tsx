import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Search, X, Clock, FileText, CalendarDays, ListTodo, FolderKanban, Inbox } from "lucide-react";
import { useSessionsStore } from "@/stores/sessions-store";
import { calendarList, collaborationSnapshot, emailListThreadsPage, emailListWorkspaceTags, sessionSearch, tasksListForSession } from "@/lib/agent/pi-client";
import { useProjectsStore, type ProjectMeta } from "@/stores/projects-store";
import { searchStoredKnowledge } from "@/lib/files/knowledge-base-runtime";
import type { SearchHit, SessionSummary, RunningTask } from "@openbuddy/shared-types";
import type { CalendarEvent, CollaborationSnapshot, EmailThreadPreview } from "@/lib/agent/pi-client";
import type { KbEntry } from "@openbuddy/files-kb";

const SEARCH_SCOPES = [
  { id: "all", label: "全部" },
  { id: "sessions", label: "会话" },
  { id: "email", label: "邮件" },
  { id: "tasks", label: "任务" },
  { id: "calendar", label: "日程" },
  { id: "knowledge", label: "知识库" },
] as const;

type SearchScope = (typeof SEARCH_SCOPES)[number]["id"];
type SearchResultAction = { id: string; select: () => void };

/**
 * Session search overlay — now powered by pi's FTS5 full-text index.
 *
 * Two modes:
 *  - Empty / short query: filter the current workspace's session list by
 *    title (instant, local).
 *  - Query ≥ 2 chars: fire `x.ai/session/search` against pi's full-text
 *    index (cross-workspace, matches message content + titles). Results show
 *    a snippet of the matched content.
 *
 * Selecting a hit: if it's a local title match we have the sessionId directly;
 * if it's a remote FTS hit we still call onSelect(sessionId) — the parent
 * decides whether to switch workspaces first.
 */
export function SearchOverlay({
  open,
  onClose,
  onSelect,
  onSelectEmail,
  onSelectProject,
  onSelectAssistant,
  onSelectKnowledge,
  currentSessionId,
  onSelectCalendar,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (sessionId: string, cwd?: string) => void;
  onSelectEmail?: (accountId: string, threadId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onSelectAssistant?: () => void;
  onSelectKnowledge?: (entryId: string, url?: string) => void;
  currentSessionId?: string | null;
  onSelectCalendar?: () => void;
}) {
  // Two-section model: there is no single flat list anymore. For local title
  // matching we flatten whatever the sidebar currently holds (independent +
  // any expanded 空间 node caches). Cross-cwd content search still goes via
  // pi FTS below, so unexpanded nodes remain searchable by content/title.
  const independent = useSessionsStore((s) => s.independent);
  const workspaceSessions = useSessionsStore((s) => s.workspaceSessions);
  const sessions = useMemo<SessionSummary[]>(
    () => [...independent, ...Object.values(workspaceSessions).flat()],
    [independent, workspaceSessions],
  );
  const projects = useProjectsStore((s) => s.projects);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [remoteHits, setRemoteHits] = useState<SearchHit[]>([]);
  const [emailHits, setEmailHits] = useState<EmailThreadPreview[]>([]);
  const [taskHits, setTaskHits] = useState<RunningTask[]>([]);
  const [calendarHits, setCalendarHits] = useState<CalendarEvent[]>([]);
  const [projectHits, setProjectHits] = useState<ProjectMeta[]>([]);
  const [inboxHits, setInboxHits] = useState<CollaborationSnapshot["inbox"]>([]);
  const [knowledgeHits, setKnowledgeHits] = useState<KbEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setScope("all");
      setActiveResultIndex(0);
      setRemoteHits([]);
      setEmailHits([]);
      setTaskHits([]);
      setCalendarHits([]);
      setProjectHits([]);
      setInboxHits([]);
      setKnowledgeHits([]);
      setSearching(false);
      requestGenerationRef.current += 1;
      const returnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => {
        clearTimeout(t);
        requestGenerationRef.current += 1;
        returnFocusTarget?.focus();
      };
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const runRemoteSearch = useCallback(async (q: string) => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;

    if (q.trim().length < 2) {
      setRemoteHits([]);
      setEmailHits([]);
      setTaskHits([]);
      setCalendarHits([]);
      setProjectHits([]);
      setInboxHits([]);
      setKnowledgeHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const shouldSearch = (candidate: SearchScope) => scope === "all" || scope === candidate;
      const [sessionResult, emailResult, taskResult, calendarResult, collaborationResult, knowledgeResult, workspaceTagsResult] = await Promise.allSettled([
        shouldSearch("sessions") ? sessionSearch(q.trim(), undefined, 30) : Promise.resolve<SearchHit[]>([]),
        shouldSearch("email") ? emailListThreadsPage({ query: q.trim(), limit: 20 }) : Promise.resolve<{ items: EmailThreadPreview[] }>({ items: [] }),
        // Stage B: todo list moved to pi-native; no IPC binding to query.
        shouldSearch("tasks") && currentSessionId ? tasksListForSession(currentSessionId) : Promise.resolve<RunningTask[]>([]),
        shouldSearch("calendar") ? calendarList() : Promise.resolve<CalendarEvent[]>([]),
        scope === "all" ? collaborationSnapshot() : Promise.resolve<Pick<CollaborationSnapshot, "inbox">>({ inbox: [] }),
        shouldSearch("knowledge") ? searchStoredKnowledge(q.trim()) : Promise.resolve<KbEntry[]>([]),
        shouldSearch("email") ? emailListWorkspaceTags() : Promise.resolve<Awaited<ReturnType<typeof emailListWorkspaceTags>>>([]),
      ]);
      if (requestGenerationRef.current !== generation) return;

      setRemoteHits(sessionResult.status === "fulfilled" ? sessionResult.value : []);
      const directEmailHits = emailResult.status === "fulfilled" ? emailResult.value.items : [];
      const workspaceTags = workspaceTagsResult.status === "fulfilled" ? workspaceTagsResult.value : [];
      const matchedWorkspaceTags = workspaceTags.filter((tag) => searchable(tag.name, q));
      let tagEmailHits: EmailThreadPreview[] = [];
      if (matchedWorkspaceTags.length > 0) {
        try {
          const taggedPage = await emailListThreadsPage({ tags: matchedWorkspaceTags.map((tag) => tag.name), tagMatch: "any", limit: 20 });
          tagEmailHits = taggedPage.items;
        } catch {
          tagEmailHits = [];
        }
      }
      if (requestGenerationRef.current !== generation) return;

      const emailByKey = new Map([...directEmailHits, ...tagEmailHits].map((hit) => [`${hit.accountId}:${hit.id}`, hit]));
      setEmailHits(rankEmailHits([...emailByKey.values()], q));
      setTaskHits(taskResult.status === "fulfilled" ? taskResult.value.filter((task) => searchable(task.description ?? "", q)) : []);
      setCalendarHits(calendarResult.status === "fulfilled" ? calendarResult.value.filter((event) => searchable([event.title, event.description, event.location, ...event.attendees].filter(Boolean).join(" "), q)) : []);
      setProjectHits(scope === "all" ? projects.filter((project) => searchable([
        project.name,
        project.instructions,
        ...(project.tags ?? []),
        ...project.plans.flatMap((plan) => [plan.title, ...(plan.tags ?? [])]),
        ...project.tasks.flatMap((task) => [task.title, ...(task.tags ?? [])]),
        ...project.assets.map((asset) => asset.name),
        ...project.dataSources.map((source) => source.label),
      ].filter(Boolean).join(" "), q)).slice(0, 20) : []);
      setInboxHits(scope === "all" && collaborationResult.status === "fulfilled" ? collaborationResult.value.inbox.filter((item) => searchable(`${item.title} ${item.summary}`, q)).slice(0, 20) : []);
      setKnowledgeHits(knowledgeResult.status === "fulfilled" ? knowledgeResult.value.slice(0, 20) : []);
    } catch {
      if (requestGenerationRef.current !== generation) return;
      // pi FTS not available / index empty — fall back to local-only.
      setRemoteHits([]);
      setEmailHits([]);
      setTaskHits([]);
      setCalendarHits([]);
      setProjectHits([]);
      setInboxHits([]);
      setKnowledgeHits([]);
    } finally {
      if (requestGenerationRef.current === generation) setSearching(false);
    }
  }, [currentSessionId, projects, scope]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runRemoteSearch(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runRemoteSearch]);

  useEffect(() => {
    setActiveResultIndex(0);
  }, [query, scope]);

  useEffect(() => {
    if (!open) return;
    setRemoteHits([]);
    setEmailHits([]);
    setTaskHits([]);
    setCalendarHits([]);
    setProjectHits([]);
    setInboxHits([]);
    setKnowledgeHits([]);
  }, [scope, open]);

  // Local title matches (always computed, instant).
  const localMatches: SessionSummary[] = (() => {
    if (scope !== "all" && scope !== "sessions") return [];
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  })();

  // Dedupe: remote hits whose sessionId already appears in localMatches are
  // shown only once (in the remote section, which has the snippet).
  const localIds = new Set(localMatches.map((s) => s.sessionId));
  const remoteOnly = remoteHits.filter((h) => !localIds.has(h.sessionId));

  const searchResultId = (kind: string, id: string) =>
    `conversation-search-result-${kind}-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const searchResults: SearchResultAction[] = [
    ...localMatches.slice(0, 30).map((session) => ({
      id: searchResultId("local", session.sessionId),
      select: () => onSelect(session.sessionId, session.cwd),
    })),
    ...remoteOnly.map((hit) => ({
      id: searchResultId("remote", hit.sessionId),
      select: () => onSelect(hit.sessionId, hit.cwd),
    })),
    ...emailHits.map((hit) => ({
      id: searchResultId("email", `${hit.accountId}:${hit.id}`),
      select: () => onSelectEmail?.(hit.accountId, hit.id),
    })),
    ...taskHits.map((task) => ({
      id: searchResultId("task", task.id),
      select: () => {
        if (currentSessionId) onSelect(currentSessionId);
      },
    })),
    ...calendarHits.map((event) => ({
      id: searchResultId("calendar", event.id),
      select: () => onSelectCalendar?.(),
    })),
    ...projectHits.map((project) => ({
      id: searchResultId("project", project.id),
      select: () => onSelectProject?.(project.id),
    })),
    ...inboxHits.map((item) => ({
      id: searchResultId("inbox", item.id),
      select: () => {
        if (item.source === "email" && item.emailAccountId && item.emailThreadId) {
          onSelectEmail?.(item.emailAccountId, item.emailThreadId);
        } else {
          onSelectAssistant?.();
        }
      },
    })),
    ...knowledgeHits.map((entry) => ({
      id: searchResultId("knowledge", entry.id),
      select: () => onSelectKnowledge?.(entry.id, entry.url),
    })),
  ];

  const activeResult = searchResults[activeResultIndex];
  const isResultActive = (id: string) => activeResult?.id === id;
  const resultButtonClassName = (id: string) =>
    "conversation-search-modal__item conversation-search-modal__item--remote" +
    (isResultActive(id) ? " conversation-search-modal__item--active" : "");

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;

    let nextIndex = activeResultIndex;
    if (event.key === "ArrowDown") nextIndex = Math.min(activeResultIndex + 1, searchResults.length - 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(activeResultIndex - 1, 0);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = searchResults.length - 1;
    else if (event.key === "Enter") {
      if (!activeResult) return;
      event.preventDefault();
      activeResult.select();
      onClose();
      return;
    } else return;

    if (searchResults.length === 0) return;
    event.preventDefault();
    setActiveResultIndex(nextIndex);
    document.getElementById(searchResults[nextIndex]?.id ?? "")?.scrollIntoView({ block: "nearest" });
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusableElements?.length) return;

    const elements = Array.from(focusableElements).filter((element) => !element.hasAttribute("disabled"));
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (!first || !last) return;

    event.preventDefault();
    const currentIndex = elements.findIndex((element) => element === document.activeElement);
    if (event.shiftKey) {
      const nextElement = currentIndex <= 0 ? last : elements[currentIndex - 1];
      if (nextElement instanceof HTMLElement) nextElement.focus();
    } else {
      const nextElement = currentIndex === -1 || currentIndex === elements.length - 1 ? first : elements[currentIndex + 1];
      if (nextElement instanceof HTMLElement) nextElement.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className="conversation-search-modal__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="全局搜索"
      ref={dialogRef}
      onKeyDown={handleDialogKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="conversation-search-modal"
      >
        <div className="conversation-search-modal__input-wrapper">
          <Search size={16} strokeWidth={1.75} className="conversation-search-modal__icon" />
          <input
            ref={inputRef}
            className="conversation-search-modal__input"
            placeholder="搜索会话标题或内容…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-label="全局搜索"
            aria-expanded={searchResults.length > 0}
            aria-controls="conversation-search-results"
            aria-activedescendant={activeResult?.id}
            aria-autocomplete="list"
            onKeyDown={handleInputKeyDown}
          />
          {searching && (
            <span className="conversation-search-modal__spinner">搜索中…</span>
          )}
          <button
            className="conversation-search-modal__close"
            onClick={onClose}
            aria-label="关闭"
            type="button"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="conversation-search-modal__scopes" role="group" aria-label="搜索范围">
          {SEARCH_SCOPES.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={
                "conversation-search-modal__scope" +
                (scope === candidate.id ? " conversation-search-modal__scope--active" : "")
              }
              aria-pressed={scope === candidate.id}
              onClick={() => setScope(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </div>

        <div id="conversation-search-results" className="conversation-search-modal__body">
          {localMatches.length > 0 && (
            <>
              <div className="conversation-search-modal__count">
                本地会话 ({localMatches.length})
              </div>
              <ul className="conversation-search-modal__list">
                {localMatches.slice(0, 30).map((s) => (
                  <li key={s.sessionId}>
                    <button
                      type="button"
                      className={
                        "conversation-search-modal__item" +
                        (isResultActive(searchResultId("local", s.sessionId))
                          ? " conversation-search-modal__item--active"
                          : "")
                      }
                      id={searchResultId("local", s.sessionId)}
                      onClick={() => {
                        onSelect(s.sessionId, s.cwd);
                        onClose();
                      }}
                      title={s.title}
                    >
                      <Clock
                        size={14}
                        strokeWidth={1.75}
                        className="conversation-search-modal__item-icon"
                      />
                      <span className="conversation-search-modal__item-title">
                        {s.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {remoteOnly.length > 0 && (
            <>
              <div className="conversation-search-modal__count">
                全文检索结果 ({remoteOnly.length})
              </div>
              <ul className="conversation-search-modal__list">
                {remoteOnly.map((h) => (
                  <li key={h.sessionId}>
                    <button
                      type="button"
                      className={resultButtonClassName(searchResultId("remote", h.sessionId))}
                      id={searchResultId("remote", h.sessionId)}
                      onClick={() => {
                        onSelect(h.sessionId, h.cwd);
                        onClose();
                      }}
                      title={h.cwd ?? h.sessionId}
                    >
                      <FileText
                        size={14}
                        strokeWidth={1.75}
                        className="conversation-search-modal__item-icon"
                      />
                      <div className="conversation-search-modal__item-body">
                        <div className="conversation-search-modal__item-title">
                          {h.title || h.sessionId.slice(0, 8)}
                        </div>
                        {h.snippet && (
                          <div
                            className="conversation-search-modal__item-snippet"
                            // pi FTS5 returns plain-text snippets; safe to render.
                            dangerouslySetInnerHTML={{ __html: escapeHtml(h.snippet) }}
                          />
                        )}
                        {h.cwd && (
                          <div className="conversation-search-modal__item-cwd">
                            {h.cwd}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {emailHits.length > 0 && (
            <>
              <div className="conversation-search-modal__count">邮件结果 ({emailHits.length})</div>
              <ul className="conversation-search-modal__list">
                {emailHits.map((hit) => (
                  <li key={`${hit.accountId}:${hit.id}`}>
                    <button
                      type="button"
                      className={resultButtonClassName(searchResultId("email", `${hit.accountId}:${hit.id}`))}
                      id={searchResultId("email", `${hit.accountId}:${hit.id}`)}
                      onClick={() => {
                        onSelectEmail?.(hit.accountId, hit.id);
                        onClose();
                      }}
                      title={`${hit.from.address} · ${hit.accountId}`}
                    >
                      <FileText size={14} strokeWidth={1.75} className="conversation-search-modal__item-icon" />
                      <div className="conversation-search-modal__item-body">
                        <div className="conversation-search-modal__item-title">{hit.subject || "（无主题）"}</div>
                        <div className="conversation-search-modal__item-snippet">{hit.from.name || hit.from.address} · {hit.snippet || "无摘要"}</div>
                        <div className="conversation-search-modal__item-cwd">{hit.accountId}{hit.tags?.length ? ` · ${hit.tags.join(" · ")}` : ""} · {hit.messageCount} 封{hit.unread ? " · 未读" : " · 已读"}{hit.starred ? " · 星标" : ""}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {taskHits.length > 0 && (
            <>
              <div className="conversation-search-modal__count">当前会话任务 ({taskHits.length})</div>
              <ul className="conversation-search-modal__list">
                {taskHits.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className={resultButtonClassName(searchResultId("task", task.id))}
                      id={searchResultId("task", task.id)}
                      onClick={() => {
                        if (currentSessionId) onSelect(currentSessionId);
                        onClose();
                      }}
                      title={task.description ?? ""}
                    >
                      <ListTodo size={14} strokeWidth={1.75} className="conversation-search-modal__item-icon" />
                      <div className="conversation-search-modal__item-body">
                        <div className="conversation-search-modal__item-title">{task.description ?? ""}</div>
                        <div className="conversation-search-modal__item-cwd">任务 · {task.status}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {calendarHits.length > 0 && (
            <>
              <div className="conversation-search-modal__count">日程 ({calendarHits.length})</div>
              <ul className="conversation-search-modal__list">
                {calendarHits.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      className={resultButtonClassName(searchResultId("calendar", event.id))}
                      id={searchResultId("calendar", event.id)}
                      onClick={() => {
                        onSelectCalendar?.();
                        onClose();
                      }}
                      title={event.title}
                    >
                      <CalendarDays size={14} strokeWidth={1.75} className="conversation-search-modal__item-icon" />
                      <div className="conversation-search-modal__item-body">
                        <div className="conversation-search-modal__item-title">{event.title}</div>
                        <div className="conversation-search-modal__item-snippet">{formatEventDate(event.start)} · {event.location || event.roomId}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {projectHits.length > 0 && (
            <>
              <div className="conversation-search-modal__count">项目与资料 ({projectHits.length})</div>
              <ul className="conversation-search-modal__list">
                {projectHits.map((project) => (
                  <li key={project.id}>
                    <button
                      type="button"
                      className={resultButtonClassName(searchResultId("project", project.id))}
                      id={searchResultId("project", project.id)}
                      onClick={() => {
                        onSelectProject?.(project.id);
                        onClose();
                      }}
                      title={project.name}
                    >
                      <FolderKanban size={14} strokeWidth={1.75} className="conversation-search-modal__item-icon" />
                      <div className="conversation-search-modal__item-body">
                        <div className="conversation-search-modal__item-title">{project.name}</div>
                        <div className="conversation-search-modal__item-snippet">项目 · {project.assets.length} 个资料 · {project.tasks.length} 个任务{project.tags?.length ? ` · 标签：${project.tags.join("、")}` : ""}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {inboxHits.length > 0 && (
            <>
              <div className="conversation-search-modal__count">助理收件箱 ({inboxHits.length})</div>
              <ul className="conversation-search-modal__list">
                {inboxHits.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={resultButtonClassName(searchResultId("inbox", item.id))}
                      id={searchResultId("inbox", item.id)}
                      onClick={() => {
                        if (item.source === "email" && item.emailAccountId && item.emailThreadId) onSelectEmail?.(item.emailAccountId, item.emailThreadId);
                        else onSelectAssistant?.();
                        onClose();
                      }}
                      title={item.title}
                    >
                      <Inbox size={14} strokeWidth={1.75} className="conversation-search-modal__item-icon" />
                      <div className="conversation-search-modal__item-body">
                        <div className="conversation-search-modal__item-title">{item.title}</div>
                        <div className="conversation-search-modal__item-snippet">{item.summary}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {knowledgeHits.length > 0 && (
            <>
              <div className="conversation-search-modal__count">知识库文档 ({knowledgeHits.length})</div>
              <ul className="conversation-search-modal__list">
                {knowledgeHits.map((entry) => (
                  <li key={`${entry.source ?? "kb"}:${entry.id}`}>
                    <button
                      type="button"
                      className={resultButtonClassName(searchResultId("knowledge", entry.id))}
                      id={searchResultId("knowledge", entry.id)}
                      onClick={() => {
                        onSelectKnowledge?.(entry.id, entry.url);
                        onClose();
                      }}
                      title={entry.url ?? entry.title}
                    >
                      <FileText size={14} strokeWidth={1.75} className="conversation-search-modal__item-icon" />
                      <div className="conversation-search-modal__item-body">
                        <div className="conversation-search-modal__item-title">{entry.title}</div>
                        <div className="conversation-search-modal__item-snippet">{entry.snippet || entry.source || "知识库"}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!searching &&
            localMatches.length === 0 &&
            remoteOnly.length === 0 &&
            emailHits.length === 0 &&
            taskHits.length === 0 &&
            calendarHits.length === 0 &&
            projectHits.length === 0 &&
            inboxHits.length === 0 &&
            knowledgeHits.length === 0 &&
            query.trim().length > 0 && (
              <div className="conversation-search-modal__empty">
                没有匹配的工作区内容
              </div>
            )}
          {!searching &&
            localMatches.length === 0 &&
            remoteOnly.length === 0 &&
            emailHits.length === 0 &&
            taskHits.length === 0 &&
            calendarHits.length === 0 &&
            projectHits.length === 0 &&
            inboxHits.length === 0 &&
            knowledgeHits.length === 0 &&
            query.trim().length === 0 && (
              <div className="conversation-search-modal__count">
                输入关键词搜索邮件、会话、任务、日程、项目和知识库
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function searchable(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

function rankEmailHits(hits: EmailThreadPreview[], query: string): EmailThreadPreview[] {
  const terms = query.toLocaleLowerCase().split(/\s+/u).map((term) => term.trim()).filter(Boolean);
  const score = (hit: EmailThreadPreview): number => {
    const subject = hit.subject.toLocaleLowerCase();
    const sender = `${hit.from.name ?? ""} ${hit.from.address}`.toLocaleLowerCase();
    const snippet = (hit.snippet ?? "").toLocaleLowerCase();
    const tags = (hit.tags ?? []).join(" ").toLocaleLowerCase();
    return terms.reduce((total, term) => total + (subject.includes(term) ? 8 : 0) + (sender.includes(term) ? 5 : 0) + (snippet.includes(term) ? 3 : 0) + (tags.includes(term) ? 2 : 0), 0) + (hit.unread ? 1 : 0) + (hit.starred ? 1 : 0);
  };
  return hits.map((hit, index) => ({ hit, index, score: score(hit) })).sort((left, right) => right.score - left.score || Number(right.hit.unread) - Number(left.hit.unread) || right.hit.date.localeCompare(left.hit.date) || left.index - right.index).map(({ hit }) => hit);
}

function formatEventDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
