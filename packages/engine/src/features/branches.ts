import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { BranchSibling, BranchTree, BranchTurn, NavigateFileConflict, NavigateOptions, NavigateResult } from "@openbuddy/protocol/branches";
import { protocolError } from "@openbuddy/protocol/errors";
import type { EngineContext } from "../engine-context.js";
import { deriveTitle, messageText } from "../titles.js";

/**
 * Branch switcher ‹1/2› (20261116-pii W1.1, Pi S1). Regenerating or editing a prompt moves the
 * leaf of the session tree and sends again, so earlier versions stay on sibling branches. Pi
 * already keeps that tree (`SessionManager` entries with `parentId`) and switches between its
 * nodes (`AgentSession.navigateTree`); this reads it per user turn and switches leaves.
 */

type Entry = SessionEntry;
interface TreeIndex {
  byId: Map<string, Entry>;
  /** Append order (the session file is append-only): a larger number is newer. */
  order: Map<string, number>;
  children: Map<string | null, Entry[]>;
}

const isUser = (entry: Entry) => entry.type === "message" && (entry.message as { role?: string }).role === "user";
/**
 * Entries that carry conversation content. Everything else (model / thinking changes, labels,
 * session info, built-in extension state) is transparent: it can sit between a reply and the
 * next prompt without making two versions of that prompt look unrelated.
 */
const isAnchor = (entry: Entry) => entry.type === "message" || entry.type === "branch_summary" || entry.type === "compaction" || entry.type === "custom_message";

function indexTree(entries: Entry[]): TreeIndex {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const order = new Map(entries.map((entry, i) => [entry.id, i] as const));
  const children = new Map<string | null, Entry[]>();
  for (const entry of entries) {
    // Orphans (a broken parent chain) count as roots, as in `getTree()`.
    const parent = entry.parentId && byId.has(entry.parentId) ? entry.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), entry]);
  }
  return { byId, order, children };
}

/** Root → `leafId`. */
function pathTo(tree: TreeIndex, leafId: string | null): Entry[] {
  const path: Entry[] = [];
  const seen = new Set<string>();
  for (let entry = leafId ? tree.byId.get(leafId) : undefined; entry && !seen.has(entry.id); entry = entry.parentId ? tree.byId.get(entry.parentId) : undefined) {
    seen.add(entry.id);
    path.push(entry);
  }
  return path.reverse();
}

/** The nearest content-carrying ancestor of `entry` (null = the session root). */
function anchorOf(tree: TreeIndex, entry: Entry): string | null {
  for (let parent = entry.parentId ? tree.byId.get(entry.parentId) : undefined; parent; parent = parent.parentId ? tree.byId.get(parent.parentId) : undefined)
    if (isAnchor(parent)) return parent.id;
  return null;
}

/** Every version of the prompt `user`: user messages hanging off the same anchor, oldest first. */
function siblingsOf(tree: TreeIndex, user: Entry): Entry[] {
  const out: Entry[] = [];
  const stack = [...(tree.children.get(anchorOf(tree, user)) ?? [])];
  while (stack.length) {
    const entry = stack.pop()!;
    if (isUser(entry)) out.push(entry);
    else if (!isAnchor(entry)) stack.push(...(tree.children.get(entry.id) ?? []));
  }
  return out.sort((a, b) => tree.order.get(a.id)! - tree.order.get(b.id)!);
}

/** The newest entry under `entry` (inclusive): where that branch was last left. */
function latestLeaf(tree: TreeIndex, entry: Entry): Entry {
  let best = entry;
  const stack = [entry];
  while (stack.length) {
    const next = stack.pop()!;
    if (tree.order.get(next.id)! > tree.order.get(best.id)!) best = next;
    stack.push(...(tree.children.get(next.id) ?? []));
  }
  return best;
}

/** Tool call ids of the assistant messages in `entries`. */
function toolCallIds(entries: Entry[]): string[] {
  return entries.flatMap((entry) => {
    if (entry.type !== "message") return [];
    const content = (entry.message as { role?: string; content?: unknown }).content;
    return Array.isArray(content) ? content.flatMap((part: { type?: string; id?: unknown }) => (part?.type === "toolCall" && typeof part.id === "string" ? [part.id] : [])) : [];
  });
}

/** `from` → `leaf` (both inclusive), assuming `from` is on the path to `leaf`. */
function segment(tree: TreeIndex, from: Entry, leafId: string | null): Entry[] {
  const path = pathTo(tree, leafId);
  const start = path.findIndex((entry) => entry.id === from.id);
  return start < 0 ? [] : path.slice(start);
}

const timestampOf = (entry: Entry) => {
  const value = (entry as { message?: { timestamp?: unknown } }).message?.timestamp;
  return typeof value === "number" ? value : Date.parse(entry.timestamp) || 0;
};

/** For each user turn on the current path: how many versions it has, which one is shown, and where each one leads. */
export async function tree(engine: EngineContext, id: string): Promise<BranchTree> {
  const sm = engine.slot(id).session.sessionManager;
  const index = indexTree(sm.getEntries());
  const leafId = sm.getLeafId();
  const users = pathTo(index, leafId).filter(isUser);
  const groups = users.map((user) => ({ user, siblings: siblingsOf(index, user) }));
  const branched = groups.some((g) => g.siblings.length > 1);
  const records = branched ? (await engine.checkpoints.list(id)).filter((r) => r.source === "tool" && r.toolCallId) : [];
  const filesOf = (entries: Entry[]) => {
    const ids = new Set(toolCallIds(entries));
    return [...new Set(records.filter((r) => ids.has(r.toolCallId!)).map((r) => r.path))].slice(0, 50);
  };
  const turns = groups.map(({ user, siblings }): BranchTurn => {
    const base = { entryId: user.id, timestamp: timestampOf(user) };
    if (siblings.length <= 1) return { ...base, index: 0, total: 1, siblings: [] };
    return {
      ...base,
      index: siblings.findIndex((s) => s.id === user.id),
      total: siblings.length,
      siblings: siblings.map((sibling): BranchSibling => {
        const leaf = sibling.id === user.id ? leafId! : latestLeaf(index, sibling).id;
        const text = messageText((sibling as { message: { content?: unknown } }).message);
        return { entryId: sibling.id, leafId: leaf, timestamp: timestampOf(sibling), preview: deriveTitle(text) ?? text.slice(0, 60), files: filesOf(segment(index, sibling, leaf)) };
      }),
    };
  });
  return { sessionId: id, leafId, turns };
}

/** Tool calls of the branch being left and of the branch being entered (below their common ancestor). */
function switchSegments(tree: TreeIndex, fromLeaf: string | null, toLeaf: string) {
  const from = pathTo(tree, fromLeaf);
  const to = pathTo(tree, toLeaf);
  let common = 0;
  while (common < from.length && common < to.length && from[common].id === to[common].id) common++;
  return { undo: toolCallIds(from.slice(common)), redo: toolCallIds(to.slice(common)) };
}

/**
 * Show another version (`entryId`, normally a sibling's `leafId`). With `restoreFiles` the files
 * are first put back to that version's state (all or nothing: changes made since need `force` or
 * `skip`); with `summarize` Pi writes a summary of the abandoned branch at the target.
 */
export async function navigate(engine: EngineContext, id: string, entryId: string, opts: NavigateOptions = {}): Promise<NavigateResult> {
  const slot = engine.slot(id);
  const session = slot.session;
  if (slot.busy || session.isStreaming) throw protocolError("session_busy", "会话忙碌：回复完成后再切换版本");
  if (session.isBashRunning) throw protocolError("bash_running", "命令还在运行，结束后再切换版本");
  const target = session.sessionManager.getEntry(entryId);
  if (!target) throw protocolError("entry_not_found", "该版本不存在");
  let restored: string[] = [];
  let conflicts: NavigateFileConflict[] = [];
  if (opts.restoreFiles) {
    const restore = typeof opts.restoreFiles === "object" ? opts.restoreFiles : {};
    const { undo, redo } = switchSegments(indexTree(session.sessionManager.getEntries()), session.sessionManager.getLeafId(), entryId);
    const result = await engine.checkpoints.switchBranch(id, undo, redo, restore);
    if (!restore.force && result.conflicts.some((c) => c.reason === "changed_since")) return { navigated: false, restored: [], conflicts: result.conflicts };
    ({ restored, conflicts } = result);
    if (restored.length) engine.emit("agent://artifacts", { sessionId: id });
  }
  // Summarizing calls the model: hold the session like /compact does.
  const generation = slot.generation;
  if (opts.summarize) {
    slot.busy = true;
    engine.emitStatus(slot);
  }
  try {
    const result = await session.navigateTree(entryId, { summarize: opts.summarize === true });
    if (result.cancelled) return { navigated: false, restored, conflicts };
    engine.invalidateList();
    engine.emitEvent(slot, { type: "session_rewound", messages: session.messages });
    return { navigated: true, restored, conflicts, ...(result.editorText !== undefined ? { editorText: result.editorText } : {}), ...(result.summaryEntry ? { summarized: true } : {}) };
  } finally {
    if (opts.summarize && generation === slot.generation) {
      slot.busy = false;
      engine.emitStatus(slot);
      if (slot.stale && engine.slots.get(id) === slot) void engine.rebuild(slot).catch(() => {});
    }
  }
}
