import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "../ErrorBoundary";

const diagnose = vi.fn(async (_request?: unknown) => ({ diagnostics: "# OpenBuddy 诊断报告\n- 平台：darwin" }));
const copy = vi.fn(async (_text: string) => undefined);
vi.mock("@openbuddy/client/agent-client", () => ({ agentDiagnose: (request: unknown) => diagnose(request) }));
vi.mock("@openbuddy/platform/clipboard", () => ({ copyText: (text: string) => copy(text) }));

let crash = true;
function Boom() {
  if (crash) throw new Error("render exploded");
  return <div>恢复后的内容</div>;
}

describe("ErrorBoundary (O1)", () => {
  it("shows the fallback instead of a white screen and recovers on 重试", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorBoundary scope="app"><Boom /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("这个页面遇到了问题")).toBeTruthy();
    expect(screen.getByText("render exploded")).toBeTruthy();
    crash = false;
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByText("恢复后的内容")).toBeTruthy();
    consoleError.mockRestore();
  });

  it("copies a redacted diagnostic report on 复制诊断", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    crash = true;
    render(<ErrorBoundary scope="app"><Boom /></ErrorBoundary>);
    await userEvent.click(screen.getByRole("button", { name: "复制诊断" }));
    expect(diagnose).toHaveBeenCalledWith(expect.objectContaining({ feedback: expect.stringContaining("render exploded") }));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining("诊断报告"));
    expect(await screen.findByText(/诊断已复制/)).toBeTruthy();
    consoleError.mockRestore();
  });
});
