export const STYLES_DIR: string;
export function listStyleFiles(): string[];
export function stripComments(css: string): string;
export function scanFile(cssText: string): {
  hex: number;
  radiusBare: number;
  fontSizeBare: number;
  zIndexBare: number;
  heavyWeight: number;
};
export function scanAllStyles(): Record<string, Partial<Record<"hex" | "radiusBare" | "fontSizeBare" | "zIndexBare" | "heavyWeight", number>>>;
export const METRICS: readonly ["hex", "radiusBare", "fontSizeBare", "zIndexBare", "heavyWeight"];
