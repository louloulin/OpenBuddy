import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ThemePreview } from "./ThemePreview";

describe("ThemePreview", () => {
  const tokens = [
    { id: "--wb-bg-primary", label: "Background", value: "#101010" },
    { id: "--wb-text-primary", label: "Text", value: "#f5f5f5" },
  ];

  it("renders one swatch per token and a CSS variable declaration for each", () => {
    const html = renderToString(<ThemePreview tokens={tokens} />);
    expect(html).toContain("--preview---wb-bg-primary: #101010");
    expect(html).toContain("--preview---wb-text-primary: #f5f5f5");
    expect(html).toContain("--wb-bg-primary");
    expect(html).toContain("Background");
  });
});