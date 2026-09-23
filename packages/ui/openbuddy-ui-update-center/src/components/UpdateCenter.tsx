/**
 * UpdateCenter — release-channel browser + locale-aware announcements.
 * Phase 2 / C4.
 *
 * Mirrors PI-Desktop `apps/desktop/components/ApplicationUpdateDelivery.tsx`
 * (ADR 0022). Subscribes to the auto-updater feed, surfaces per-channel
 * changelogs, and supports staged rollouts (stable / beta / nightly).
 *
 * The component does not perform the actual update — it only renders the
 * available versions and forwards the user choice to the host shell, which
 * owns the install pipeline.
 */
import { useMemo, useState } from "react";
import styles from "./UpdateCenter.module.css";

export type UpdateChannel = "stable" | "beta" | "nightly";

export interface UpdateRelease {
  id: string;
  channel: UpdateChannel;
  version: string;
  releasedAt: string;
  /** Per-locale changelog. The UI picks the best match. */
  notes: { locale: string; title: string; body: string }[];
  /** Critical → bumps UI to require acknowledgement before continue. */
  critical?: boolean;
  /** Approximate download size in MB; null = unknown. */
  sizeMb?: number | null;
}

export interface UpdateCenterProps {
  currentVersion: string;
  currentChannel: UpdateChannel;
  releases: readonly UpdateRelease[];
  locale?: string;
  onSelectChannel?: (channel: UpdateChannel) => void;
  onInstall?: (release: UpdateRelease) => void;
  className?: string;
}

export function UpdateCenter(props: UpdateCenterProps) {
  const { currentVersion, currentChannel, releases, locale = "en", onSelectChannel, onInstall, className } = props;
  const channels: UpdateChannel[] = ["stable", "beta", "nightly"];
  const [activeChannel, setActiveChannel] = useState<UpdateChannel>(currentChannel);
  const filtered = useMemo(
    () => releases.filter((r) => r.channel === activeChannel).sort((a, b) => b.releasedAt.localeCompare(a.releasedAt)),
    [releases, activeChannel],
  );
  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")} data-testid="update-center">
      <header className={styles.header}>
        <h2 className={styles.title}>Update Center</h2>
        <p className={styles.subtitle}>Currently running v{currentVersion} on {currentChannel}.</p>
      </header>
      <nav className={styles.channels} role="tablist">
        {channels.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={activeChannel === c || undefined}
            className={[styles.channel, activeChannel === c ? styles.channelActive : ""].filter(Boolean).join(" ")}
            onClick={() => { setActiveChannel(c); onSelectChannel?.(c); }}
            data-testid={`channel-${c}`}
          >
            {c}
          </button>
        ))}
      </nav>
      <ul className={styles.releases} role="list">
        {filtered.length === 0 ? (
          <li className={styles.empty} data-testid="update-empty">No releases on this channel.</li>
        ) : null}
        {filtered.map((r) => {
          const note = r.notes.find((n) => n.locale === locale) ?? r.notes[0];
          return (
            <li key={r.id} className={[styles.release, r.critical ? styles.critical : ""].filter(Boolean).join(" ")} data-testid={`release-${r.id}`}>
              <header className={styles.releaseHeader}>
                <div>
                  <h3 className={styles.version}>v{r.version}</h3>
                  <p className={styles.meta}>
                    <span>{r.channel}</span>
                    <span>{r.releasedAt}</span>
                    {typeof r.sizeMb === "number" ? <span>{r.sizeMb} MB</span> : null}
                    {r.critical ? <strong className={styles.criticalTag}>Critical</strong> : null}
                  </p>
                </div>
                {onInstall ? (
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => onInstall(r)}
                    data-testid={`release-install-${r.id}`}
                  >
                    Install
                  </button>
                ) : null}
              </header>
              {note ? (
                <article className={styles.notes}>
                  <h4>{note.title}</h4>
                  <p>{note.body}</p>
                </article>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
