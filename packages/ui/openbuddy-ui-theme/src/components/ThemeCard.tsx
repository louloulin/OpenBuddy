/**
 * @openbuddy/ui-theme/ThemeCard — single theme row inside the picker.
 *
 * Compact preview: a color swatch (accent), label, optional heading-font
 * preview, and a check icon when selected. No animation, no portal —
 * picked up by ThemePicker's scroll container.
 */
import type { ThemeDefinition } from "../themes";
import styles from "./ThemeCard.module.css";

export interface ThemeCardProps {
  theme: ThemeDefinition;
  active: boolean;
  onSelect(name: ThemeDefinition["name"]): void;
  showHeadingPreview?: boolean;
}

export function ThemeCard({
  theme,
  active,
  onSelect,
  showHeadingPreview = true,
}: ThemeCardProps) {
  return (
    <button
      type="button"
      className={styles.row + (active ? " " + styles.active : "")}
      onClick={() => onSelect(theme.name)}
      data-theme-name={theme.name}
    >
      <span
        className={styles.swatch}
        style={{ background: theme.accent }}
        aria-hidden
      />
      <span
        className={styles.label}
        style={{
          fontFamily: showHeadingPreview
            ? theme.headingFont ?? theme.font
            : theme.font,
        }}
      >
        {theme.label}
      </span>
      {active ? <span className={styles.check} aria-hidden>✓</span> : null}
    </button>
  );
}
