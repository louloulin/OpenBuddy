import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { calendarList, type CalendarEvent } from "@/lib/agent/pi-client";
import { assistantFacade } from "@/lib/agent/assistant-facade";

interface AssistantCalendarPanelProps {
  onToast?: (message: string) => void;
}

function startOfWeek(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  const day = value.getDay();
  value.setDate(value.getDate() - (day === 0 ? 6 : day - 1));
  return value;
}

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function eventDateTimeValue(value: string): string {
  return localDateTimeValue(new Date(value));
}

function displayDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function sameDay(left: string, right: string): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function overlaps(left: CalendarEvent, right: CalendarEvent): boolean {
  return left.id !== right.id && new Date(left.start).getTime() < new Date(right.end).getTime() && new Date(right.start).getTime() < new Date(left.end).getTime();
}

export function AssistantCalendarPanel({ onToast }: AssistantCalendarPanelProps) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [end, setEnd] = useState(() => localDateTimeValue(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [roomId, setRoomId] = useState("personal-room");
  const [description, setDescription] = useState("");
  const [allDay, setAllDay] = useState(false);
  const weekEnd = useMemo(() => new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000), [weekStart]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await calendarList({ from: weekStart.toISOString(), to: weekEnd.toISOString() }));
    } catch (error) {
      onToast?.(`日程读取失败：${String(error).replace(/^Error:\s*/u, "")}`);
    } finally {
      setLoading(false);
    }
  }, [onToast, weekEnd, weekStart]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !start || !end) return;
    try {
      const targetRoom = roomId.trim() || "personal-room";
      const isEditing = Boolean(editingEvent);
      const capability = isEditing ? "calendar:update" : "calendar:create";
      const capabilityInput = isEditing
        ? { id: editingEvent!.id, patch: { title: title.trim(), start: new Date(start).toISOString(), end: new Date(end).toISOString(), allDay, description: description.trim() || undefined } }
        : { title: title.trim(), start: new Date(start).toISOString(), end: new Date(end).toISOString(), roomId: targetRoom, allDay, description: description.trim() || undefined, contextRefs: ["assistant:calendar"] };
      const proposal = await assistantFacade.propose({ mode: "personal", title: `${isEditing ? "修改" : "创建"}日程：${title.trim()}`, objective: `在本地日历中${isEditing ? "修改" : "创建"}日程「${title.trim()}」`, capability, dataScopes: [`room:${targetRoom}`], artifactTypes: ["other"], contextRefs: [`room:${targetRoom}`], capabilityInput });
      await assistantFacade.createSideEffect({ capability, action: "write:calendar", summary: `${isEditing ? "修改" : "创建"}日程：${title.trim()}`, fingerprint: JSON.stringify(capabilityInput), resourceId: isEditing ? editingEvent!.id : undefined, taskId: proposal.taskId });
      setTitle("");
      setDescription("");
      setShowCreate(false);
      setEditingEvent(null);
      onToast?.(`日程已提交审批，请在助理·收件箱中批准后执行`);
    } catch (error) {
      onToast?.(`创建日程失败：${String(error).replace(/^Error:\s*/u, "")}`);
    }
  };

  const edit = (item: CalendarEvent) => {
    setEditingEvent(item);
    setTitle(item.title);
    setStart(eventDateTimeValue(item.start));
    setEnd(eventDateTimeValue(item.end));
    setRoomId(item.roomId);
    setDescription(item.description ?? "");
    setAllDay(item.allDay);
    setShowCreate(true);
  };

  const remove = async (item: CalendarEvent) => {
    try {
      const proposal = await assistantFacade.propose({ mode: "personal", title: `删除日程：${item.title}`, objective: `在本地日历中删除日程「${item.title}」`, capability: "calendar:delete", dataScopes: [`room:${item.roomId}`], artifactTypes: ["other"], contextRefs: [`room:${item.roomId}`], capabilityInput: { id: item.id } });
      await assistantFacade.createSideEffect({ capability: "calendar:delete", action: "write:calendar", summary: `删除日程：${item.title}`, fingerprint: JSON.stringify({ id: item.id }), resourceId: item.id, taskId: proposal.taskId });
      onToast?.("删除日程已提交审批，请在助理·收件箱中批准后执行");
    } catch (error) {
      onToast?.(`删除日程失败：${String(error).replace(/^Error:\s*/u, "")}`);
    }
  };

  return (
    <div className="assistant-calendar">
      <div className="assistant-calendar__hero">
        <div className="assistant-workspace__hero-icon"><CalendarDays size={24} /></div>
        <div><h2>个人日程</h2><p>Personal Buddy 的本地日程视图，按 Room 和 context refs 隔离；当前未连接 Google Calendar 或 Outlook。</p></div>
      </div>
      <section className="assistant-calendar__toolbar">
        <div className="assistant-calendar__range"><button type="button" aria-label="上一周" onClick={() => setWeekStart((value) => new Date(value.getTime() - 7 * 24 * 60 * 60 * 1000))}><ChevronLeft size={16} /></button><strong>{weekStart.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} – {new Date(weekEnd.getTime() - 1).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</strong><button type="button" aria-label="下一周" onClick={() => setWeekStart((value) => new Date(value.getTime() + 7 * 24 * 60 * 60 * 1000))}><ChevronRight size={16} /></button></div>
        <div className="assistant-calendar__actions"><button type="button" onClick={() => void refresh()}><RefreshCw size={14} />刷新</button><button type="button" className="assistant-calendar__primary" onClick={() => setShowCreate((value) => !value)}><Plus size={14} />创建本地日程</button></div>
      </section>
      {showCreate && <form className="assistant-calendar__form" onSubmit={(event) => void submit(event)}><strong>{editingEvent ? "编辑本地日程" : "创建本地日程"}</strong><input aria-label="日程标题" placeholder="日程标题" value={title} onChange={(event) => setTitle(event.target.value)} required /><div className="assistant-calendar__form-grid"><label>开始<input aria-label="开始时间" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required /></label><label>结束<input aria-label="结束时间" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required /></label><label>Room<input aria-label="日程 Room" value={roomId} onChange={(event) => setRoomId(event.target.value)} disabled={Boolean(editingEvent)} /></label></div><textarea aria-label="日程说明" placeholder="说明（可选）" value={description} onChange={(event) => setDescription(event.target.value)} /><label className="assistant-calendar__checkbox"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />全天事件</label><div className="assistant-calendar__form-actions"><button type="button" onClick={() => { setShowCreate(false); setEditingEvent(null); }}>取消</button><button type="submit" className="assistant-calendar__primary">提交审批</button></div></form>}
      <section className="assistant-calendar__scope"><strong>本地优先</strong><span>Room：personal-room 或 project-* · 外部同步：未配置 · 人工创建</span></section>
      <section className="assistant-calendar__list"><div className="assistant-workspace__projection-header"><h3>本周安排</h3><span>{loading ? "读取中…" : `${events.length} 项`}</span></div>{events.length === 0 && !loading ? <p className="assistant-workspace__projection-empty">本周还没有日程。创建一个本地事件，后续可由 Buddy 在授权范围内读取。</p> : <div className="assistant-workspace__projection-list">{events.map((item) => { const conflict = events.some((other) => overlaps(item, other)); return <article key={item.id} className="assistant-workspace__projection-item"><div><strong>{item.title}</strong><p>{sameDay(item.start, item.end) ? `${displayDate(item.start)} – ${new Date(item.end).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : `${displayDate(item.start)} – ${displayDate(item.end)}`}</p><p>{item.roomId} · {item.contextRefs.join("、") || "无 context ref"}{item.description ? ` · ${item.description}` : ""}</p></div><span className="assistant-calendar__event-meta"><em className={`assistant-calendar__status assistant-calendar__status--${item.status}`}>{item.status}</em>{conflict && <em className="assistant-calendar__conflict">有冲突</em>}<button type="button" onClick={() => edit(item)}>编辑</button><button type="button" onClick={() => void remove(item)}>删除</button></span></article>; })}</div>}</section>
    </div>
  );
}
