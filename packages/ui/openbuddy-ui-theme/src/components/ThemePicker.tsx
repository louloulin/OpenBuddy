/**
 * @openbuddy/ui-theme/ThemePicker — single-button popover for choosing a
 * theme. Inspired by cabinet's picker: groups themes by dark/light, shows
 * an accent swatch and a heading-font preview for each entry, supports
 * "Match system" mode that pairs a different theme per system color scheme.
 *
 * Rendering: portal to document.body so it sits above any z-index on the
 * host page. Position is computed from the trigger's bounding rect on
 * open. Closes on outside click + Escape.
 *
 * Subscriptions: we use a single manual useEffect + useState snapshot
 * instead of multiple useThemeSnapshot calls, because the latter would
 * allocate a fresh selector closure per render and cause useSyncExternalStore
 * to resubscribe — harmless in production but it surfaces as a "Maximum
 * update depth exceeded" warning under React 18 strict-mode (which the
 * test runner enables).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../client";
import { themesByType, type ThemeDefinition, type ThemeName } from "../themes";
import { ThemeCard } from "./ThemeCard";
import styles from "./ThemePicker.module.css";

export interface ThemePickerProps {
  className?: string;
  label?: string;
  compact?: boolean;
  onOpenChange?(open: boolean): void;
}

const ANCHOR_GAP = 8;

interface ThemeSnapshot {
  currentName: ThemeName;
  mode: "manual" | "system";
  pair: { light: ThemeName; dark: ThemeName };
}

function useThemeFields(): ThemeSnapshot {
  const service = useTheme();
  const [snap, setSnap] = useState<ThemeSnapshot>(() => ({
    currentName: service.currentName(),
    mode: service.mode(),
    pair: service.getPair(),
  }));
  useEffect(() => {
    const sync = () => {
      setSnap({
        currentName: service.currentName(),
        mode: service.mode(),
        pair: service.getPair(),
      });
    };
    return service.subscribe(sync);
  }, [service]);
  return snap;
}

function useHydrated(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

function useClickOutside(
  enabled: boolean,
  menuRef: React.RefObject<HTMLDivElement | null>,
  buttonRef: React.RefObject<HTMLButtonElement | null>,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (buttonRef.current && buttonRef.current.contains(target)) return;
      onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [enabled, menuRef, buttonRef, onOutside]);
}

export function ThemePicker({
  className,
  label = "Theme",
  compact = true,
  onOpenChange,
}: ThemePickerProps) {
  const hydrated = useHydrated();
  const service = useTheme();
  const { currentName, mode, pair } = useThemeFields();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const handleOpen = useCallback(() => {
    if (open) {
      close();
      return;
    }
    if (buttonRef.current && typeof window !== "undefined") {
      const r = buttonRef.current.getBoundingClientRect();
      setPos({
        top: r.bottom + ANCHOR_GAP,
        right: Math.max(8, window.innerWidth - r.right),
      });
    }
    setOpen(true);
    onOpenChange?.(true);
  }, [open, close, onOpenChange]);

  useClickOutside(open, menuRef, buttonRef, close);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (buttonRef.current && typeof window !== "undefined") {
        const r = buttonRef.current.getBoundingClientRect();
        setPos({
          top: r.bottom + ANCHOR_GAP,
          right: Math.max(8, window.innerWidth - r.right),
        });
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const onSelect = useCallback(
    (name: ThemeName) => {
      service.setThemeByName(name);
      // Selecting a theme is a terminal action — close the popover so the
      // user immediately sees the result. (Keyboard users keep focus on the
      // trigger, so this is also the right UX for them.)
      close();
    },
    [service, close],
  );

  const onSetMode = useCallback(
    (next: "manual" | "system") => {
      service.setMode(next);
    },
    [service],
  );

  const dark = useMemo(() => themesByType("dark"), []);
  const light = useMemo(() => themesByType("light"), []);

  const usingCustom = useMemo(() => {
    return (
      !!currentName &&
      currentName !== "claude" &&
      currentName !== "white" &&
      currentName !== "black" &&
      currentName !== "paper"
    );
  }, [currentName]);

  const menu = open && hydrated && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className={styles.section}>
            <div className={styles.sectionHeader}>模式</div>
            <div className={styles.modeRow}>
              <button
                type="button"
                className={styles.modeBtn + (mode === "manual" ? " " + styles.modeActive : "")}
                onClick={() => onSetMode("manual")}
                aria-pressed={mode === "manual"}
              >
                手动
              </button>
              <button
                type="button"
                className={styles.modeBtn + (mode === "system" ? " " + styles.modeActive : "")}
                onClick={() => onSetMode("system")}
                aria-pressed={mode === "system"}
                title="Match system"
              >
                跟随系统
              </button>
            </div>
          </div>
          {mode === "system" ? (
            <SystemPairRow
              service={service}
              pair={pair}
              currentName={currentName}
            />
          ) : null}
          <div className={styles.divider} />
          <ThemeGroup
            label="深色"
            items={dark}
            currentName={currentName}
            onSelect={onSelect}
          />
          <div className={styles.divider} />
          <ThemeGroup
            label="浅色"
            items={light}
            currentName={currentName}
            onSelect={onSelect}
          />
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={(compact ? styles.triggerCompact : styles.trigger) + (className ? " " + className : "")}
        onClick={handleOpen}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title="切换主题"
      >
        {compact ? (
          usingCustom ? <PaletteIcon /> : <SunMoonIcon />
        ) : (
          <span className={styles.triggerLabel}>
            {usingCustom ? <PaletteIcon /> : <SunMoonIcon />}
            <span className={styles.triggerText}>{currentName}</span>
          </span>
        )}
      </button>
      {menu}
    </>
  );
}

function ThemeGroup({
  label,
  items,
  currentName,
  onSelect,
}: {
  label: string;
  items: ThemeDefinition[];
  currentName: ThemeName;
  onSelect(name: ThemeName): void;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>{label}</div>
      <div className={styles.list}>
        {items.map((t) => (
          <ThemeCard
            key={t.name}
            theme={t}
            active={t.name === currentName}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function SystemPairRow({
  service,
  pair,
  currentName,
}: {
  service: ReturnType<typeof useTheme>;
  pair: { light: ThemeName; dark: ThemeName };
  currentName: ThemeName;
}) {
  return (
    <div className={styles.pairRow}>
      <div className={styles.pairGroup}>
        <div className={styles.pairLabel}>浅色</div>
        <select
          className={styles.pairSelect}
          value={pair.light}
          onChange={(e) => {
            const v = e.target.value as ThemeName;
            service.setPair({ light: v });
          }}
        >
          {themesByType("light").map((t) => (
            <option key={t.name} value={t.name}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.pairGroup}>
        <div className={styles.pairLabel}>深色</div>
        <select
          className={styles.pairSelect}
          value={pair.dark}
          onChange={(e) => {
            const v = e.target.value as ThemeName;
            service.setPair({ dark: v });
          }}
        >
          {themesByType("dark").map((t) => (
            <option key={t.name} value={t.name}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.pairHint}>当前: {currentName}</div>
    </div>
  );
}

function SunMoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.673 0-.43-.18-.812-.437-1.106-.25-.286-.43-.622-.43-1.005 0-.83.673-1.5 1.5-1.5H16c3.314 0 6-2.686 6-6 0-4.5-4.5-8-10-8Z" />
    </svg>
  );
}
