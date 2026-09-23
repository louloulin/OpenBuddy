import styles from "./WorkPanelSection.module.css";

export interface WorkPanelSectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Optional footer actions (e.g. "Cancel job", "Clear log"). */
  actions?: React.ReactNode;
  /** Tone affects the accent stripe + heading colour. */
  tone?: "default" | "info" | "warning" | "danger" | "success";
}

export function WorkPanelSection({
  title,
  subtitle,
  children,
  actions,
  tone = "default",
}: WorkPanelSectionProps) {
  return (
    <div className={styles.wrap} data-tone={tone} data-testid="work-panel-section-wrap">
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>{title}</h3>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
