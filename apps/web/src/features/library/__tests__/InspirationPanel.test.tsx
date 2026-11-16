import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { InspirationPanel } from "../InspirationPanel";

const saved: unknown[] = [];
vi.mock("@openbuddy/client/agent-client", () => ({
  promptsSave: vi.fn(async (...args: unknown[]) => { saved.push(args); return { name: "x" }; }),
}));

beforeEach(() => { saved.length = 0; });

describe("灵感 (pii W2.8)", () => {
  it("renders static scene cards without calling a model", () => {
    render(<InspirationPanel cwd="/ws" />);
    // Scene tabs come from the home scenes, and cards are the templates.
    expect(screen.getByRole("tab", { name: "日常办公" })).toBeInTheDocument();
    expect(screen.getByText("财报分析全流程")).toBeInTheDocument();
    expect(screen.queryByText(/生成中/)).not.toBeInTheDocument();
  });

  it("filters by scene tab and search", () => {
    render(<InspirationPanel cwd="/ws" />);
    fireEvent.click(screen.getByRole("tab", { name: "代码开发" }));
    expect(screen.queryByText("财报分析全流程")).not.toBeInTheDocument();
    const search = screen.getByRole("textbox", { name: "搜索场景" });
    fireEvent.change(search, { target: { value: "不存在的场景" } });
    expect(screen.getByText(/没有匹配的场景/)).toBeInTheDocument();
  });

  it("launches a scene into the composer and saves it as a 我的指令", async () => {
    const launched: string[] = [];
    render(<InspirationPanel cwd="/ws" onLaunch={(prompt) => launched.push(prompt)} onToast={() => {}} />);
    const pick = (title: string) => screen.getByText(title).closest(".inspiration-card") as HTMLElement;

    fireEvent.click(within(pick("财报分析全流程")).getByRole("button", { name: /用这个开工/ }));
    expect(launched[0]).toContain("财报分析");

    fireEvent.click(within(pick("财报分析全流程")).getByRole("button", { name: /存为指令/ }));
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    const [draft, scope] = saved[0] as [Record<string, string>, string];
    expect(scope).toBe("global");
    expect(draft.name).toMatch(/^scene-working-\d+-\d+$/);
    expect(draft.description).toContain("财报分析全流程");
    expect(draft.content).toContain("财报分析");
  });
});
