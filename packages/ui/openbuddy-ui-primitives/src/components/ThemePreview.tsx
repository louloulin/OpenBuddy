import { useMemo, type ReactNode } from "react";

export interface ThemePreviewToken {
  /** Stable token id (e.g. `--wb-bg-primary`). */
  id: string;
  /** Human label shown next to the swatch. */
  label: string;
  /** CSS color value used to render the swatch. */
  value: string;
}

export interface ThemePreviewProps {
  /** Tokens to display; usually the first 6-8 `--wb-*` variables. */
  tokens: readonly ThemePreviewToken[];
  /** Optional heading rendered above the swatch row. */
  heading?: ReactNode;
  /** Optional class names applied to the wrapper. */
  className?: string;
}

/**
 * Live theme swatch row that mirrors the WorkBuddy theme-switcher widget.
 * Lets the user preview a palette before committing to a theme switch
 * (previously the renderer hard-refreshed on every change).
 */
export function ThemePreview({ tokens, heading, className }: ThemePreviewProps) {
  const stylesheet = useMemo(() => {
    const declarations = tokens.map((token) => `  --preview-${token.id}: ${token.value};`).join("\n");
    return `:root {\n${declarations}\n}`;
  }, [tokens]);

  return (
    <section className={className}>
      {heading}
      <style>{stylesheet}</style>
      {/* role="list" 在这里不是冗余:上面 inline style 设了 listStyle:none,
          Safari / VoiceOver 会因此丢掉整个列表语义(读屏不再播报"列表,共 N 项")。
          eslint 的 no-redundant-roles 看不到这一点,已在 eslint.config.mjs 里
          针对 ul 做了豁免。删掉它会静默地让 VoiceOver 用户失去列表结构。 */}
      <ul role="list" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", padding: 0, margin: 0, listStyle: "none" }}>
        {tokens.map((token) => (
          <li key={token.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              aria-hidden
              style={{
                display: "block",
                height: 32,
                borderRadius: 6,
                background: `var(--preview-${token.id})`,
                border: "1px solid color-mix(in srgb, var(--preview-${token.id}) 60%, transparent)",
              }}
            />
            <small style={{ fontFamily: "monospace" }}>{token.id}</small>
            <small style={{ color: "var(--wb-text-muted, #888)" }}>{token.label}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}