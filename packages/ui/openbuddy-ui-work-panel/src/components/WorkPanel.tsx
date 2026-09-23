/**
 * WorkPanel — independent work-focused window that runs alongside the main
 * chat window. Phase 2 / C1.
 *
 * Mirrors PI-Desktop `apps/desktop/components/WorkPanel.tsx`: a slot-driven
 * surface that hosts long-running tasks (background jobs, file-watchers,
 * build progress) without disturbing the conversation thread.
 *
 * The panel exposes a slot for nested sections so a host shell can register
 * per-feature panels (e.g. "Background Jobs", "Watched Files", "Build
 * Progress") via the existing `@openbuddy/ui-slots` registry.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./WorkPanel.module.css";

export interface WorkPanelSectionDescriptor {
  id: string;
  title: string;
  /** Slot id the section renders into (must be unique across the panel). */
  slotId: string;
  /** Optional subtitle. */
  subtitle?: string;
}

export interface WorkPanelProps {
  sections: readonly WorkPanelSectionDescriptor[];
  /** Render-prop slot system: maps slotId → ReactNode. */
  resolveSection(slotId: string): React.ReactNode;
  title?: string;
  onClose?: () => void;
  className?: string;
}

export function WorkPanel(props: WorkPanelProps) {
  const { sections, resolveSection, title = "Work", onClose, className } = props;
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);

  return (
    <div
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-testid="work-panel"
      data-section-count={sections.length}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {onClose ? (
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            data-testid="work-panel-close"
            aria-label="Close work panel"
          >
            ×
          </button>
        ) : null}
      </header>
      <nav className={styles.tabs} role="tablist">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={activeId === s.id || undefined}
            className={[styles.tab, activeId === s.id ? styles.tabActive : ""].filter(Boolean).join(" ")}
            onClick={() => setActiveId(s.id)}
            data-testid={`work-panel-tab-${s.id}`}
          >
            {s.title}
          </button>
        ))}
      </nav>
      <main className={styles.body}>
        {sections.map((s) =>
          activeId === s.id ? (
            <section
              key={s.id}
              role="tabpanel"
              className={styles.section}
              data-testid={`work-panel-section-${s.id}`}
            >
              {s.subtitle ? <p className={styles.subtitle}>{s.subtitle}</p> : null}
              {resolveSection(s.slotId)}
            </section>
          ) : null,
        )}
        {sections.length === 0 ? (
          <div className={styles.empty} data-testid="work-panel-empty">
            No work sections registered.
          </div>
        ) : null}
      </main>
    </div>
  );
}
