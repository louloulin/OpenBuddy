import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Clock, FileText, CalendarDays, ListTodo, FolderKanban, Inbox } from "lucide-react";
import { useSessionsStore } from "@/stores/sessions-store";
import { calendarList, collaborationSnapshot, emailListThreadsPage, emailListWorkspaceTags, sessionSearch, tasksListForSession } from "@/lib/agent/pi-client";
import { useProjectsStore, type ProjectMeta } from "@/stores/projects-store";
import { searchStoredKnowledge } from "@/lib/files/knowledge-base-runtime";
import type { SearchHit, SessionSummary, RunningTask } from "@openbuddy/shared-types";
import type { CalendarEvent, CollaborationSnapshot, EmailThreadPreview } from "@/lib/agent/pi-client";
import type { KbEntry } from "@openbuddy/files-kb";

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
  const [remoteHits, setRemoteHits] = useState<SearchHit[]>([]);
  const [emailHits, setEmailHits] = useState<EmailThreadPreview[]>([]);
  const [taskHits, setTaskHits] = useState<RunningTask[]>([]);
  const [calendarHits, setCalendarHits] = useState<CalendarEvent[]>([]);
  const [projectHits, setProjectHits] = useState<ProjectMeta[]>([]);
  const [inboxHits, setInboxHits] = useState<CollaborationSnapshot["inbox"]>([]);
  const [knowledgeHits, setKnowledgeHits] = useState<KbEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setRemoteHits([]);
      setEmailHits([]);
      setTaskHits([]);
      setCalendarHits([]);
      setProjectHits([]);
      setInboxHits([]);
      setKnowledgeHits([]);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
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

  // Debounced remote search. Only kicks in for queries ≥ 2 chars.
  const runRemoteSearch = useCallback(async (q: string) => {
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
      const [sessionResult, emailResult, taskResult, calendarResult, collaborationResult, knowledgeResult, workspaceTagsResult] = await Promise.allSettled([
        sessionSearch(q.trim(), undefined, 30),
        emailListThreadsPage({ query: q.trim(), limit: 20 }),
        // Stage B: todo list moved to pi-native; no IPC binding to query.
        currentSessionId ? tasksListForSession(currentSessionId) : Promise.resolve<RunningTask[]>([]),
        calendarList(),
        collaborationSnapshot(),
        searchStoredKnowledge(q.trim()),
        emailListWorkspaceTags(),
      ]);
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
      const emailByKey = new Map([...directEmailHits, ...tagEmailHits].map((hit) => [`${hit.accountId}:${hit.id}`, hit]));
      setEmailHits(rankEmailHits([...emailByKey.values()], q));
      setTaskHits(taskResult.status === "fulfilled" ? taskResult.value.filter((task) => searchable(task.description ?? "", q)) : []);
      setCalendarHits(calendarResult.status === "fulfilled" ? calendarResult.value.filter((event) => searchable([event.title, event.description, event.location, ...event.attendees].filter(Boolean).join(" "), q)) : []);
      setProjectHits(projects.filter((project) => searchable([
        project.name,
        project.instructions,
        ...(project.tags ?? []),
        ...project.plans.flatMap((plan) => [plan.title, ...(plan.tags ?? [])]),
        ...project.tasks.flatMap((task) => [task.title, ...(task.tags ?? [])]),
        ...project.assets.map((asset) => asset.name),
        ...project.dataSources.map((source) => source.label),
      ].filter(Boolean).join(" "), q)).slice(0, 20));
      setInboxHits(collaborationResult.status === "fulfilled" ? collaborationResult.value.inbox.filter((item) => searchable(`${item.title} ${item.summary}`, q)).slice(0, 20) : []);
      setKnowledgeHits(knowledgeResult.status === "fulfilled" ? knowledgeResult.value.slice(0, 20) : []);
    } catch {
      // pi FTS not available / index empty — fall back to local-only.
      setRemoteHits([]);
      setEmailHits([]);
      setTaskHits([]);
      setCalendarHits([]);
      setProjectHits([]);
      setInboxHits([]);
      setKnowledgeHits([]);
    } finally {
      setSearching(false);
    }
  }, [currentSessionId, projects]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runRemoteSearch(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, runRemoteSearch]);

  // Local title matches (always computed, instant).
  const localMatches: SessionSummary[] = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  })();

  // Dedupe: remote hits whose sessionId already appears in localMatches are
  // shown only once (in the remote section, which has the snippet).
  const localIds = new Set(localMatches.map((s) => s.sessionId));
  const remoteOnly = remoteHits.filter((h) => !localIds.has(h.sessionId));

  if (!open) return null;

  return (
    <div
      className="conversation-search-modal__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="搜索会话"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="conversation-search-modal">
        <div className="conversation-search-modal__input-wrapper">
          <Search size={16} strokeWidth={1.75} className="conversation-search-modal__icon" />
          <input
            ref={inputRef}
            className="conversation-search-modal__input"
            placeholder="搜索会话标题或内容…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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

        <div className="conversation-search-modal__body">
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
                      className="conversation-search-modal__item"
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
                      className="conversation-search-modal__item conversation-search-modal__item--remote"
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
                      className="conversation-search-modal__item conversation-search-modal__item--remote"
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
                      className="conversation-search-modal__item conversation-search-modal__item--remote"
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
                      className="conversation-search-modal__item conversation-search-modal__item--remote"
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
                      className="conversation-search-modal__item conversation-search-modal__item--remote"
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
                      className="conversation-search-modal__item conversation-search-modal__item--remote"
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
                      className="conversation-search-modal__item conversation-search-modal__item--remote"
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
