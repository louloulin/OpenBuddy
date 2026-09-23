import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { PluginTemplates, DEFAULT_TEMPLATES } from "../components/index.js";

describe("PluginTemplates", () => {
  it("renders 4 default templates", () => {
    render(<PluginTemplates />);
    expect(screen.getByTestId("template-panel-basic")).toBeTruthy();
    expect(screen.getByTestId("template-agent-tool-basic")).toBeTruthy();
    expect(screen.getByTestId("template-skill-pack")).toBeTruthy();
    expect(screen.getByTestId("template-full-demo")).toBeTruthy();
  });

  it("fires onUseTemplate with the template descriptor", () => {
    const fn = vi.fn();
    render(<PluginTemplates onUseTemplate={fn} />);
    fireEvent.click(screen.getByTestId("template-use-skill-pack"));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0].id).toBe("skill-pack");
  });

  it("fires onPreview with the template descriptor", () => {
    const fn = vi.fn();
    render(<PluginTemplates onPreview={fn} />);
    fireEvent.click(screen.getByTestId("template-preview-panel-basic"));
    expect(fn.mock.calls[0][0].id).toBe("panel-basic");
  });

  it("exposes the 4 template ids via DEFAULT_TEMPLATES", () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.id)).toEqual([
      "panel-basic", "agent-tool-basic", "skill-pack", "full-demo",
    ]);
  });
});
