/**
 * CanvasPanel —— 右侧画布工作区。
 *
 * 与 ToolSidePanel **互斥**:两者都是右侧工作区,同时开会把转录区挤没,
 * 所以打开画布会关掉工具面板(见 ChatView 的 openCanvas 回调)。
 *
 * 三种承载(markdown / 沙箱 / 文件预览)全部 `lazy()`:Tiptap、pdf.js 的依赖图
 * 都不该进首包(bundle-topology 的 entryChunkMB=5.0 是 CI 硬门禁)。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  clampCanvasWidth,
  useCanvasStore,
  type CanvasTab,
} from "@openbuddy/ui-state/canvas-store";
import { useT } from "@openbuddy/ui-locale/client";

const CanvasSandboxFrame = lazy(() =>
  import("./CanvasSandboxFrame").then((m) => ({ default: m.CanvasSandboxFrame })),
);
const CanvasMarkdownEditor = lazy(() =>
  import("./CanvasMarkdownEditor").then((m) => ({ default: m.CanvasMarkdownEditor })),
);
const CanvasFilePreview = lazy(() =>
  import("./CanvasFilePreview").then((m) => ({ default: m.CanvasFilePreview })),
);

const KIND_KEYS: Record<CanvasTab["kind"], string> = {
  markdown: "conversation.canvas.kind.markdown",
  html: "conversation.canvas.kind.html",
  react: "conversation.canvas.kind.react",
  svg: "conversation.canvas.kind.svg",
  code: "conversation.canvas.kind.code",
  image: "conversation.canvas.kind.image",
  pdf: "conversation.canvas.kind.pdf",
};

/** 承载类型标签 —— 单独一个组件,因为 `useT` 是单 key hook,不能放进 tabs.map。 */
function KindLabel({ kind }: { kind: CanvasTab["kind"] }) {
  return <span className="canvas-panel__tab-kind">{useT(KIND_KEYS[kind])}</span>;
}

function TabCloseButton({
  tab,
  onClose,
  fallbackTitle,
}: {
  tab: CanvasTab;
  onClose(canvasId: string): void;
  fallbackTitle: string;
}) {
  const label = useT("conversation.canvas.closeTab", { title: tab.title || fallbackTitle });
  return (
    <button
      type="button"
      className="canvas-panel__tab-close"
      aria-label={label}
      data-testid={`canvas-tab-close-${tab.canvasId}`}
      onClick={() => onClose(tab.canvasId)}
    >
      ×
    </button>
  );
}

function Carrier({ tab }: { tab: CanvasTab }) {  const updateContent = useCanvasStore((s) => s.updateContent);
  if (tab.kind === "markdown") {
    return (
      <CanvasMarkdownEditor
        tab={tab}
        onChange={(content) => updateContent(tab.canvasId, content)}
      />
    );
  }
  if (tab.kind === "html" || tab.kind === "react" || tab.kind === "svg") {
    return <CanvasSandboxFrame kind={tab.kind} content={tab.content ?? ""} />;
  }
  return <CanvasFilePreview tab={tab} />;
}

export function CanvasPanel() {
  const tabs = useCanvasStore((s) => s.tabs);
  const activeCanvasId = useCanvasStore((s) => s.activeCanvasId);
  const width = useCanvasStore((s) => s.width);
  const setActive = useCanvasStore((s) => s.setActive);
  const setWidth = useCanvasStore((s) => s.setWidth);
  const closeTab = useCanvasStore((s) => s.closeTab);
  const close = useCanvasStore((s) => s.close);

  const panelRef = useRef<HTMLElement | null>(null);
  const measured = useContainerWidth(panelRef);

  // 拖拽把手:按住左边缘改宽度,松手落盘(localStorage key 见 canvas-store)。
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const onSashDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = { startX: event.clientX, startWidth: width };
    },
    [width],
  );
  const onSashMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(drag.startWidth - (event.clientX - drag.startX));
  }, [setWidth]);
  const onSashUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  }, []);

  const active = tabs.find((t) => t.canvasId === activeCanvasId) ?? tabs[0] ?? null;

  const panelLabel = useT("conversation.canvas.panelLabel");
  const sashLabel = useT("conversation.canvas.resize");
  const closeLabel = useT("conversation.canvas.close");
  const emptyLabel = useT("conversation.canvas.empty");
  const loadingLabel = useT("conversation.canvas.loading");
  const untitledLabel = useT("conversation.canvas.untitled");

  return (
    <aside
      ref={panelRef}
      className="canvas-panel"
      data-testid="canvas-panel"
      aria-label={panelLabel}
      style={{ width: `${clampCanvasWidth(width, measured)}px` }}
    >
      <div
        className="canvas-panel__sash"
        role="separator"
        aria-orientation="vertical"
        aria-label={sashLabel}
        tabIndex={0}
        onPointerDown={onSashDown}
        onPointerMove={onSashMove}
        onPointerUp={onSashUp}
        onPointerCancel={onSashUp}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 8;
          if (event.key === "ArrowLeft") setWidth(width + step);
          else if (event.key === "ArrowRight") setWidth(width - step);
          else return;
          event.preventDefault();
        }}
      />
      <header className="canvas-panel__tabs" role="tablist">
        {tabs.map((tab) => (
          <div key={tab.canvasId} className="canvas-panel__tab-wrap">
            <button
              type="button"
              role="tab"
              aria-selected={tab.canvasId === active?.canvasId}
              className={
                "canvas-panel__tab" + (tab.canvasId === active?.canvasId ? " canvas-panel__tab--active" : "")
              }
              data-testid={`canvas-tab-${tab.canvasId}`}
              title={tab.title}
              onClick={() => setActive(tab.canvasId)}
            >
              <KindLabel kind={tab.kind} />
              <span className="canvas-panel__tab-title">{tab.title || untitledLabel}</span>
            </button>
            <TabCloseButton tab={tab} onClose={closeTab} fallbackTitle={untitledLabel} />
          </div>
        ))}
        <button
          type="button"
          className="canvas-panel__close"
          aria-label={closeLabel}
          data-testid="canvas-panel-close"
          onClick={close}
        >
          ×
        </button>
      </header>
      <div className="canvas-panel__body">
        {active ? (
          <Suspense fallback={<div className="canvas-panel__loading">{loadingLabel}</div>}>
            <Carrier tab={active} />
          </Suspense>
        ) : (
          <div className="canvas-panel__empty">{emptyLabel}</div>
        )}
      </div>
    </aside>
  );
}

/** 容器宽度比视口更准 —— 窄窗口里"视口 72%"仍会把转录区挤没。 */
function useContainerWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return undefined;
    const apply = () => setWidth(parent.clientWidth);
    apply();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(apply);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export default CanvasPanel;
