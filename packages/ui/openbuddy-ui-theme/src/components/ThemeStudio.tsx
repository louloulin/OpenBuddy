/**
 * @openbuddy/ui-theme/ThemeStudio — in-app OKLCh theme editor.
 *
 * OpenBuddy's differentiator vs cabinet: you can build your own theme from
 * the running app instead of hand-editing a TS file. The studio exposes the
 * token groups that matter for a first pass — background, foreground,
 * border, accent — as OKLCh sliders (L / C / H), previews the result live on
 * `documentElement`, and exports / imports the theme as JSON.
 *
 * Scope (v1): edit an existing theme as a starting point, then Save as a
 * custom theme stored in localStorage under `openbuddy.theme.custom`. Custom
 * themes appear in the picker's list right after the built-ins.
 *
 * Deliberately dependency-free: no color-picker library, no OKLCh parser
 * beyond a small regex. Everything is a number input plus a range slider.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./ThemeStudio.module.css";

export interface OkLChValue {
  l: number; // 0..1
  c: number; // 0..0.4
  h: number; // 0..360
}

export interface CustomTheme {
  name: string;
  label: string;
  type: "dark" | "light";
  accent: string;
  font?: string;
  headingFont?: string;
  vars: Record<string, string>;
}

const CUSTOM_KEY = "openbuddy.theme.custom";
const ACTIVE_CUSTOM_KEY = "openbuddy.theme.custom.active";

const OKLCH_RE = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i;

export function parseOklch(value: string | undefined): OkLChValue | null {
  if (!value) return null;
  const m = value.match(OKLCH_RE);
  if (!m) return null;
  const l = Number(m[1]);
  const c = Number(m[2]);
  const h = Number(m[3]);
  if (![l, c, h].every((n) => Number.isFinite(n))) return null;
  return { l, c, h };
}

export function formatOklch(v: OkLChValue): string {
  return `oklch(${v.l.toFixed(3)} ${v.c.toFixed(3)} ${v.h.toFixed(1)})`;
}

/** Token groups exposed in the editor. */
const TOKEN_GROUPS: Array<{ id: string; label: string; tokens: string[] }> = [
  {
    id: "surface",
    label: "表面 (Surface)",
    tokens: [
      "--wb-bg-primary",
      "--wb-bg-secondary",
      "--wb-bg-tertiary",
      "--wb-bg-elevated",
    ],
  },
  {
    id: "text",
    label: "文本 (Foreground)",
    tokens: ["--wb-fg-primary", "--wb-fg-secondary", "--wb-fg-tertiary"],
  },
  {
    id: "line",
    label: "描边 (Border)",
    tokens: ["--wb-border", "--wb-border-soft"],
  },
  {
    id: "accent",
    label: "强调色 (Accent)",
    tokens: ["--wb-accent", "--wb-accent-soft"],
  },
];

export interface ThemeStudioProps {
  /** Starting vars. Defaults to the active theme's resolved vars. */
  initialVars: Record<string, string>;
  /** Starting display name. */
  initialLabel?: string;
  /** Called when the user saves. The host persists / registers the theme. */
  onSave?(theme: CustomTheme): void;
  onClose?(): void;
}

export function readCustomThemes(): CustomTheme[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomTheme[]) : [];
  } catch {
    return [];
  }
}

export function writeCustomThemes(themes: CustomTheme[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(themes));
  } catch {
    /* ignore */
  }
}

export function getActiveCustomName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_CUSTOM_KEY);
  } catch {
    return null;
  }
}

/** Apply a custom theme's vars to documentElement (preview + persistence). */
export function applyCustomVars(vars: Record<string, string>): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute("data-theme-name", "custom");
}

export function ThemeStudio({
  initialVars,
  initialLabel = "My Theme",
  onSave,
  onClose,
}: ThemeStudioProps) {
  const [label, setLabel] = useState(initialLabel);
  const [type, setType] = useState<"dark" | "light">("dark");
  const [draft, setDraft] = useState<Record<string, OkLChValue>>(() => {
    const out: Record<string, OkLChValue> = {};
    for (const group of TOKEN_GROUPS) {
      for (const token of group.tokens) {
        const parsed = parseOklch(initialVars[token]);
        if (parsed) out[token] = parsed;
      }
    }
    return out;
  });

  const originalRef = useRef<Record<string, string>>({ ...initialVars });

  // Live preview whenever the draft changes.
  useEffect(() => {
    const vars: Record<string, string> = {};
    for (const [token, v] of Object.entries(draft)) vars[token] = formatOklch(v);
    applyCustomVars(vars);
  }, [draft]);

  // Restore the original vars on unmount (unless a save committed them).
  useEffect(() => {
    return () => {
      // The picker / store will re-apply the real theme on its next notify;
      // here we just remove our preview marker.
      document.documentElement.removeAttribute("data-theme-name");
    };
  }, []);

  const updateToken = useCallback((token: string, next: OkLChValue) => {
    setDraft((prev) => ({ ...prev, [token]: next }));
  }, []);

  const reset = useCallback(() => {
    const out: Record<string, OkLChValue> = {};
    for (const group of TOKEN_GROUPS) {
      for (const token of group.tokens) {
        const parsed = parseOklch(originalRef.current[token]);
        if (parsed) out[token] = parsed;
      }
    }
    setDraft(out);
  }, []);

  const theme = useMemo<CustomTheme>(() => {
    const vars: Record<string, string> = {};
    for (const [token, v] of Object.entries(draft)) vars[token] = formatOklch(v);
    return {
      name: `custom-${slug(label)}`,
      label,
      type,
      accent: draft["--wb-accent"] ? formatOklch(draft["--wb-accent"]) : "#888888",
      vars,
    };
  }, [draft, label, type]);

  const handleSave = useCallback(() => {
    const existing = readCustomThemes().filter((t) => t.name !== theme.name);
    const next = [...existing, theme];
    writeCustomThemes(next);
    try {
      window.localStorage.setItem(ACTIVE_CUSTOM_KEY, theme.name);
    } catch {
      /* ignore */
    }
    onSave?.(theme);
  }, [theme, onSave]);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(theme, null, 2);
    void navigator.clipboard?.writeText(json).catch(() => {});
  }, [theme]);

  return (
    <div className={styles.root} data-testid="theme-studio">
      <div className={styles.header}>
        <span className={styles.title}>Theme Studio</span>
        <div className={styles.headerRight}>
          <button type="button" className={styles.btnGhost} onClick={reset}>
            还原
          </button>
          <button type="button" className={styles.btnGhost} onClick={handleExport}>
            导出 JSON
          </button>
          <button type="button" className={styles.btn} onClick={handleSave}>
            保存
          </button>
          {onClose ? (
            <button type="button" className={styles.btnGhost} onClick={onClose}>
              关闭
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.metaRow}>
        <label className={styles.metaField}>
          <span>名称</span>
          <input
            className={styles.textInput}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className={styles.metaField}>
          <span>类型</span>
          <select
            className={styles.select}
            value={type}
            onChange={(e) => setType(e.target.value as "dark" | "light")}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>
      </div>

      <div className={styles.groups}>
        {TOKEN_GROUPS.map((group) => (
          <div key={group.id} className={styles.group}>
            <div className={styles.groupLabel}>{group.label}</div>
            {group.tokens.map((token) => {
              const v = draft[token];
              if (!v) return null;
              return (
                <div key={token} className={styles.tokenRow}>
                  <span className={styles.tokenName}>{token.replace("--wb-", "")}</span>
                  <div className={styles.sliders}>
                    <Slider
                      label="L"
                      value={v.l}
                      min={0}
                      max={1}
                      step={0.005}
                      onChange={(l) => updateToken(token, { ...v, l })}
                    />
                    <Slider
                      label="C"
                      value={v.c}
                      min={0}
                      max={0.4}
                      step={0.005}
                      onChange={(c) => updateToken(token, { ...v, c })}
                    />
                    <Slider
                      label="H"
                      value={v.h}
                      min={0}
                      max={360}
                      step={1}
                      onChange={(h) => updateToken(token, { ...v, h })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
}) {
  return (
    <label className={styles.slider}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <span className={styles.sliderValue}>{value.toFixed(step < 1 ? 3 : 0)}</span>
    </label>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "theme";
}
