/**
 * conversation-view — `conversation.view`（keyed 槽）的实现与内置视图。
 *
 * ## 为什么要这个槽（P0-4）
 *
 * 改造前，会话转录区只有**一种**呈现方式：`ChatView` 里那一段固定的
 * 「空态 / 虚拟列表 / 普通列表」JSX。用户看不到「这一轮的最终结果是什么」，
 * 也没法把工具卡片与分隔符折叠掉只看正文 —— 而这正是 Cabinet 用
 * `conversation-{live,result,session,content}-view.tsx` 四个独立视图解决的
 * 问题（见 `docs/plan/03-cabinet-benchmark.md` 资产 C1–C3）。
 *
 * 这里用**已有的** `keyed` 槽能力补上多视图，不引入任何新概念：
 *
 *   - key  = 视图 id（`live` / `result` / `content` / 插件自定义）
 *   - 一个 key 只渲染一个实现（同 key 高 `priority` 覆盖低 `priority`，
 *     与内核 keyed 语义一致）
 *
 * ## 回退语义（关键，见 `docs/plan/05-target-architecture.md` R5）
 *
 * `live` 视图**刻意不注册实现**。它走 `fallback`，也就是 `ChatView` 现有
 * 的那段 JSX —— 因此：
 *
 *   1. 一个插件都不装时，界面与改造前**逐像素一致**；
 *   2. 卸载插件后视觉零变化；
 *   3. 不会出现「内置视图和内核默认两套实现都在跑」的双渲染。
 *
 * 内置只注册 `result` / `content` 两个**增量**视图。
 *
 * ## 复用而非重写
 *
 * 两个内置视图都不自己渲染消息：它们把宿主给的 `renderNode` 用来渲染被筛
 * 选出的节点。换句话说，消息气泡、工具卡片、markdown 出口全部沿用既有实现，
 * 这里只负责**选哪些节点**。
 */

import { useMemo, type ComponentType, type ReactNode, type RefObject } from "react";
import { useSlotEntries } from "@openbuddy/ui-runtime/client";
import type { TimelineNode } from "@/lib/ui/timeline-utils";

// ─── 契约 ───────────────────────────────────────────────────────────

export type ConversationViewProps = {
  /** 当前激活的视图 id。 */
  view: string;
  /** 时间线节点（分隔符 + 消息），由宿主 `buildTimeline()` 产出。 */
  timeline: readonly TimelineNode[];
  /** 宿主的默认节点渲染器。**视图应当复用它**，而不是自己渲染消息。 */
  renderNode: (args: { node: TimelineNode; index: number }) => ReactNode;
  sessionId?: string;
  streaming: boolean;
  virtualized: boolean;
  /** 滚动容器 ref。接管布局的视图应把它挂到自己的滚动容器上，
   *  否则「跳到末尾 / 未读计数」会失效。 */
  scrollRef?: RefObject<HTMLElement | null>;
  /** 内核默认渲染（`live` 视图的既有 JSX）。没有实现注册时原样返回。 */
  fallback: ReactNode;
};

/** 视图注册时可携带的描述载荷。本包不依赖 i18n，标签由注册方提供。 */
export type ConversationViewPayload = { label?: string };

/**
 * 节点列表 key。
 *
 * `TimelineNode` 只有 `date-divider` / `model-divider` 两个变体带 `key`，
 * `message` 变体没有，所以这里按 kind + index 派生，保证同一份 timeline
 * 内稳定（timeline 本身由 `buildTimeline` 确定性产出）。
 */
function nodeKey(node: TimelineNode, index: number): string {
  return node.kind === "message" ? `message-${index}` : node.key;
}

const EMPTY_VIEWS: readonly { key: string; label: string }[] = Object.freeze([]);

/**
 * 读出一个 entry 的标签。
 *
 * `payload` 在内核里是 `unknown`（组件型贡献直接就是组件），所以这里只做
 * 「有 label 字符串就用、否则退回 key」的窄化，不假设任何其它结构。
 */
function labelOf(payload: unknown, key: string): string {
  if (payload !== null && typeof payload === "object" && "label" in payload) {
    // SAFETY: `in` 已经把 payload 收窄到「有 label 属性的对象」；下面只读
    // 这一个属性并再次用 `typeof` 判型，所以断言出的 `{ label?: unknown }`
    // 比真实结构更宽松，读不到字符串时退回 key。
    const raw = (payload as { label?: unknown }).label;
    if (typeof raw === "string" && raw.length > 0) return raw;
  }
  return key;
}

/**
 * `conversation.view` 已注册的视图（id + 标签），按 `order` 升序。
 *
 * 宿主用它渲染视图切换器。**只列出真正有实现的视图**（外加内核自带的
 * `live`，它由宿主自己补进列表），所以这个 hook 不返回 `live`。
 */
export function useConversationViews(): readonly { key: string; label: string }[] {
  const entries = useSlotEntries("conversation.view");
  return useMemo(() => {
    if (entries.length === 0) return EMPTY_VIEWS;
    const rows = entries
      .map((entry) => {
        const key = entry.options?.key;
        if (typeof key !== "string" || key.length === 0) return null;
        return {
          key,
          label: labelOf(entry.options?.payload, key),
          order: typeof entry.options?.order === "number" ? entry.options.order : 0,
          priority: typeof entry.options?.priority === "number" ? entry.options.priority : 0,
        };
      })
      .filter((row): row is { key: string; label: string; order: number; priority: number } => row !== null);

    // 同 key 只保留 priority 最高的一条（与内核 keyed 覆盖语义一致）。
    const byKey = new Map<string, { key: string; label: string; order: number; priority: number }>();
    for (const row of rows) {
      const prev = byKey.get(row.key);
      if (!prev || row.priority >= prev.priority) byKey.set(row.key, row);
    }
    return [...byKey.values()]
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
      .map(({ key, label }) => ({ key, label }));
  }, [entries]);
}

/** 本包把 slot entry 的 `component` 解析成这个可渲染形状（视图即函数组件）。 */
type ViewImpl = ComponentType<ConversationViewProps>;

/**
 * 边界解析：把内核里的 `component: unknown` 收窄成 `ViewImpl | undefined`。
 *
 * 只接受函数形态 —— 本包的内置视图与插件视图都是函数组件；带 `render()`
 * 的对象形态由 `renderSlotEntry` 那条路径处理，不走 keyed 视图。
 */
function asViewImpl(component: unknown): ViewImpl | undefined {
  if (typeof component !== "function") return undefined;
  // SAFETY: 内核契约只保证 `component` 是可渲染项，不保证它的 props 签名。
  // 断言成 `ViewImpl` 是安全的：React 传入的多余 props 会被忽略，若插件
  // 的函数事实上不读 `ConversationViewProps`，最坏结果是该视图不渲染内容
  // （等价于空视图），不会越界访问、也不会影响宿主其它部分。
  return component as ViewImpl;
}

/** 挑出某个 key 下 priority 最高的实现组件（与内核 keyed 覆盖语义一致）。 */
function pickViewComponent(
  entries: readonly { options?: { key?: string; priority?: number }; component: unknown }[],
  view: string,
): ViewImpl | undefined {
  let best: ViewImpl | undefined;
  let bestPriority = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (entry.options?.key !== view) continue;
    const impl = asViewImpl(entry.component);
    if (!impl) continue;
    const priority = typeof entry.options?.priority === "number" ? entry.options.priority : 0;
    if (priority >= bestPriority) {
      bestPriority = priority;
      best = impl;
    }
  }
  return best;
}

/**
 * 视图出口。没有对应实现时渲染 `fallback`（内核默认），因此对现有行为
 * **零影响**。
 */
export function ConversationViewOutlet(props: ConversationViewProps): ReactNode {
  const entries = useSlotEntries("conversation.view");
  const Impl = pickViewComponent(entries, props.view);
  if (!Impl) return props.fallback;
  return <Impl {...props} />;
}

// ─── 视图切换器 ─────────────────────────────────────────────

/**
 * 视图切换器。
 *
 * **只在真的有可选视图时才渲染** —— `views` 只包含「已注册实现」的视图
 * （内置 `live` 不注册实现，所以不在里面）；`views.length === 0` 时直接返回
 * `null`。因此：**一个插件都不装时，这个切换器完全不出现**，界面与改造前
 * 逐像素一致（这是 P0 的硬约束，见分册 05 R5）。
 *
 * `live` 由这里补进列表首项（它始终可用，走内核默认转录区）。
 */
export function ConversationViewTabs({
  active,
  views,
  onChange,
  liveLabel = "对话",
}: {
  active: string;
  views: readonly { key: string; label: string }[];
  onChange: (view: string) => void;
  liveLabel?: string;
}): ReactNode {
  if (views.length === 0) return null;
  const items = [{ key: "live", label: liveLabel }, ...views];
  return (
    <div className="conversation-view-tabs" role="tablist" aria-label="会话视图">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === active}
          data-view-tab={item.key}
          className={
            item.key === active
              ? "conversation-view-tabs__tab conversation-view-tabs__tab--active"
              : "conversation-view-tabs__tab"
          }
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ─── 内置视图（增量，只负责「选哪些节点」） ────────────────────────

/**
 * `result` — 结果视图。
 *
 * 只保留**分隔符与最后一条助手消息**：用户关心的「这一轮最后得到了什么」
 * 一眼可见，工具调用噪声全部收走。渲染仍走宿主 `renderNode`，所以气泡、
 * markdown、操作栏都是既有实现。
 */
export function ConversationResultView({
  timeline,
  renderNode,
  sessionId,
}: ConversationViewProps): ReactNode {
  const nodes = useMemo(() => {
    let lastAssistant = -1;
    for (let i = timeline.length - 1; i >= 0; i -= 1) {
      const node = timeline[i];
      if (node.kind === "message" && node.message.role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant < 0) return [];
    // 保留最后一条助手消息 + 紧随其后的分隔符（模型/日期切换标记）。
    const out: { node: TimelineNode; index: number }[] = [{ node: timeline[lastAssistant], index: lastAssistant }];
    for (let i = lastAssistant + 1; i < timeline.length; i += 1) {
      if (timeline[i].kind !== "message") out.push({ node: timeline[i], index: i });
    }
    return out;
  }, [timeline]);

  if (nodes.length === 0) {
    return (
      <div className="conversation-view-result conversation-view-result--empty" data-view="result" data-session={sessionId}>
        <p className="conversation-view-hint">本轮还没有助手输出。</p>
      </div>
    );
  }
  return (
    <div className="conversation-view-result" data-view="result" data-session={sessionId}>
      {nodes.map(({ node, index }) => (
        <div key={nodeKey(node, index)} className="conversation-view-result__node">
          {renderNode({ node, index })}
        </div>
      ))}
    </div>
  );
}

/**
 * `content` — 内容视图。
 *
 * 去掉所有分隔符，只留消息正文，给「连续读一遍对话」用（对齐 Cabinet 的
 * `conversation-content-viewer.tsx` 的纯内容阅读形态）。
 */
export function ConversationContentView({
  timeline,
  renderNode,
  sessionId,
}: ConversationViewProps): ReactNode {
  const nodes = useMemo(
    () =>
      timeline
        .map((node, index) => ({ node, index }))
        .filter(({ node }) => node.kind === "message"),
    [timeline],
  );

  if (nodes.length === 0) {
    return (
      <div className="conversation-view-content conversation-view-content--empty" data-view="content" data-session={sessionId}>
        <p className="conversation-view-hint">还没有消息。</p>
      </div>
    );
  }
  return (
    <div className="conversation-view-content" data-view="content" data-session={sessionId}>
      {nodes.map(({ node, index }) => (
        <div key={nodeKey(node, index)} className="conversation-view-content__node">
          {renderNode({ node, index })}
        </div>
      ))}
    </div>
  );
}
