/**
 * @openbuddy/ui-theme/ThemeCard — single theme entry inside the picker.
 *
 * Two variants:
 *   - row  : list-row layout, used by SettingsSections when rendering themes
 *            inline as a vertical list.
 *   - chip : compact pill used by ThemePicker popover grid (cabinet-style:
 *            round accent dot + theme label in the theme's own font).
 *
 * Both variants share the `active` state (highlight + checkmark) so callers
 * don't need to fork on selection visuals.
 */
import type { ThemeDefinition } from "../themes";
import styles from "./ThemeCard.module.css";

export interface ThemeCardProps {
  theme: ThemeDefinition;
  active: boolean;
  onSelect(name: ThemeDefinition["name"]): void;
  /** "row" = list, "chip" = compact grid pill (cabinet-style). Default row. */
  variant?: "row" | "chip";
  /** Render the label using the theme's heading font for visual identity. */
  showHeadingPreview?: boolean;
}

export function ThemeCard({
  theme,
  active,
  onSelect,
  variant = "row",
  showHeadingPreview = true,
}: ThemeCardProps) {
  const isChip = variant === "chip";
  const cls = (isChip ? styles.chip : styles.row) + (active ? " " + styles.active : "");
  const labelStyle: React.CSSProperties = showHeadingPreview
    ? { fontFamily: theme.headingFont ?? theme.font }
    : { fontFamily: theme.font };
  return (
    <button
      type="button"
      className={cls}
      onClick={() => onSelect(theme.name)}
      data-theme-name={theme.name}
      title={theme.label}
      aria-pressed={active}
    >
      <span
        className={isChip ? styles.chipDot : styles.swatch}
        style={{ background: theme.accent }}
        aria-hidden
      />
      <span
        className={isChip ? styles.chipLabel : styles.label}
        style={labelStyle}
      >
        {theme.label}
      </span>
      {active ? (
        <span className={isChip ? styles.chipCheck : styles.check} aria-hidden>✓</span>
      ) : null}
    </button>
  );
}
