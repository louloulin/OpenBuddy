import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Markdown } from "../markdown";
import { ThemeProvider } from "../ThemeProvider";

const md = (text: string, onApplyCode = vi.fn()) => {
  render(<ThemeProvider><Markdown config={{ onApplyCode, pathClickHandler: { onPathClick: vi.fn() } }}>{text}</Markdown></ThemeProvider>);
  return onApplyCode;
};
const fence = (info: string) => "```" + info + "\nexport const a = 1;\n```";

it("offers 应用 only on blocks that name a whole file", () => {
  const apply = md(["说明：", fence('ts title="src/a.ts"'), fence("ts"), fence("ts:3:9:src/b.ts")].join("\n\n"));
  const buttons = screen.getAllByRole("button", { name: /^应用到/ });
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]);
  expect(apply).toHaveBeenCalledWith("export const a = 1;\n", "typescript", "src/a.ts");
  // The excerpt keeps its line range label instead.
  expect(screen.getByText("L3-L9")).toBeInTheDocument();
});

it("reads bare paths and lang:path fences", () => {
  const apply = md([fence("py scripts/run.py"), fence("json:config/app.json")].join("\n\n"));
  const buttons = screen.getAllByRole("button", { name: /^应用到/ });
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["应用到 scripts/run.py", "应用到 config/app.json"]);
  fireEvent.click(buttons[1]);
  expect(apply.mock.calls[0][2]).toBe("config/app.json");
});
