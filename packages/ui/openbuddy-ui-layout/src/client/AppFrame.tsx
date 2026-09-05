/**
 * AppFrame — three-column shell that resolves ui-slots slots.
 *
 * Direct port of the deepseek-harness ui-layout AppFrame pattern:
 * declares children slots (sidebar / conversation / details /
 * shell.overlay) AND renders them via the renderer-host SlotCore
 * registry. The frame is the only place that ever paints the global
 * shell chrome (title bar, secondary sidebar).
 */

import { useState, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import {
  TitleBar,
  TopbarActions,
  TopbarTitle,
} from "@openbuddy/ui-shell";
import { useUiRuntime } from "@openbuddy/ui-runtime/client";
import { APP_VERSION } from "@/lib/platform/app-version";

export interface AppFrameProps {
  children?: ReactNode;
  /** Initial sidebar collapsed state. */
  initialSidebarCollapsed?: boolean;
  /** Initial details column open state. */
  initialDetailsOpen?: boolean;
}

/**
 * AppFrame — the application shell. Mounts:
 *   - TitleBar (top)
 *   - Sidebar slot (left)
 *   - Conversation slot (center)
 *   - Details slot (right, when open)
 *   - Overlay slot (floating)
 *   - TopbarActions / TopbarTitle (right of title)
 *
 * The frame is the only consumer of ctx.slots.entries() — child slots
 * are dispatched by name, never via React Context.
 */
export function AppFrame({
  initialSidebarCollapsed = false,
  initialDetailsOpen = false,
}: AppFrameProps) {
  const runtime = useUiRuntime();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

  const toggleDetails = useCallback(() => {
    setDetailsOpen((o) => !o);
  }, []);

  // Re-render when any rendered slot's entries change. Subscribing to each
  // slot we render (sidebar / conversation / details / shell.overlay) replaces
  // the previous 250ms forceUpdate polling and keeps the frame idle when no
  // plugin churn happens.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const slots = runtime.slots;
    if (!slots.entries) return;
    if (typeof slots.subscribe !== "function") return;
    const tick = () => forceUpdate((n) => n + 1);
    const disposers = ["sidebar", "conversation", "details", "shell.overlay"]
      .map((name) => slots.subscribe?.(name, tick))
      .filter((dispose): dispose is () => void => typeof dispose === "function");
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [runtime]);

  const sidebarWidth = sidebarCollapsed ? 64 : 240;
  const detailsWidth = detailsOpen ? 320 : 0;

  const sidebarEntries = runtime.slots.entries("sidebar");
  const conversationEntries = runtime.slots.entries("conversation");
  const detailsEntries = runtime.slots.entries("details");
  const overlayEntries = runtime.slots.entries("shell.overlay");

  const SidebarComp = sidebarEntries[0];
  const ConversationComp = conversationEntries[0];
  const DetailsComp = detailsEntries[0];

  return (
    <div
      className="app-frame"
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr",
        height: "100vh",
        background: "var(--wb-bg-primary)",
        color: "var(--wb-fg-primary)",
      }}
    >
      <header
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid var(--wb-border)",
          background: "var(--wb-bg-secondary)",
          minHeight: 36,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <TitleBar onPlaceholder={toggleSidebar} onShowAbout={toggleDetails} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TopbarTitle title="" appVersion={APP_VERSION} onRename={async () => {}} />
          <TopbarActions sessionId="" title="" />
        </div>
      </header>

      <main
        style={{
          display: "grid",
          gridTemplateColumns: `${sidebarWidth}px 1fr ${detailsWidth}px`,
          overflow: "hidden",
          transition: "grid-template-columns 0.18s",
        }}
      >
        <aside
          aria-label="Sidebar"
          style={{
            borderRight: "1px solid var(--wb-border)",
            background: "var(--wb-bg-secondary)",
            overflow: "auto",
          }}
        >
          {SidebarComp ? (
            renderSlotComponent(SidebarComp, { collapsed: sidebarCollapsed, width: sidebarWidth })
          ) : null}
        </aside>

        <section
          aria-label="Conversation"
          style={{
            overflow: "hidden",
            background: "var(--wb-bg-primary)",
          }}
        >
          {ConversationComp
            ? renderSlotComponent(ConversationComp, {})
            : null}
        </section>

        {detailsOpen && DetailsComp ? (
          <aside
            aria-label="Details"
            style={{
              borderLeft: "1px solid var(--wb-border)",
              background: "var(--wb-bg-secondary)",
              overflow: "auto",
            }}
          >
            {renderSlotComponent(DetailsComp, { open: detailsOpen, width: detailsWidth })}
          </aside>
        ) : null}
      </main>

      {overlayEntries.length > 0 ? (
        <div
          aria-label="Overlay"
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 100,
          }}
        >
          {overlayEntries.map((entry: unknown, i: number) => (
            <div key={i} style={{ pointerEvents: "auto" }}>
              {renderSlotComponent(entry, {})}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Render a slot component by name with provided props. */
function renderSlotComponent(Comp: unknown, props: object) {
  if (typeof Comp === "function") {
    const C = Comp as React.ComponentType<Record<string, unknown>>;
    return <C {...(props as Record<string, unknown>)} />;
  }
  if (Comp && typeof Comp === "object" && "render" in Comp && typeof (Comp as { render?: () => ReactNode }).render === "function") {
    const R = Comp as unknown as { render: () => ReactNode };
    return R.render();
  }
  return null;
}
