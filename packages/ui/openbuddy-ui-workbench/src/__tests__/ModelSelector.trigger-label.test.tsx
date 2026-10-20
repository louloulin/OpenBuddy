/**
 * ModelSelector 触发器标签 —— 空态不得回退成上游塞来的原始 id。
 *
 * 背景(2026-10-11 真实启动截图):一个 provider 都没配置时,上游把占位 id 传进来,
 * 触发器把 id 原样渲染成了字面量 "unknown/unknown" —— 用户会以为存在这么一个模型。
 * 下拉菜单本身有正确的空态(「未配置模型」+ 前往设置),触发器也必须一致。
 *
 * 这两条断言都是 mutation 可杀的:把 ModelSelector 里 `models.length === 0 ? "" : …`
 * 那个分支去掉、退回 `current?.id || modelId`,第一条立刻失败。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelSelector } from "../ModelSelector";

vi.mock("@openbuddy/ui-locale/client", () => ({
  useLocale: () => ({ t: (key: string) => key, current: () => "zh-CN", subscribe: () => () => {} }),
  useT: (key: string) => key,
}));

describe("ModelSelector 触发器", () => {
  it("没有可用模型时不显示原始 id,而是空态文案", () => {
    render(<ModelSelector models={[]} modelId="unknown/unknown" onModelChange={() => {}} />);
    const trigger = document.querySelector(".model-selector__trigger");
    expect(trigger?.textContent).toContain("未配置模型");
    expect(trigger?.textContent).not.toContain("unknown");
  });

  it("匹配到模型时显示它的标签(有思考档位则并排显示)", () => {
    render(
      <ModelSelector
        models={[{ id: "custom_anthropic/glm-5.3-flash", label: "glm-5.3-flash" }]}
        modelId="custom_anthropic/glm-5.3-flash"
        onModelChange={() => {}}
      />,
    );
    expect(screen.getByText(/glm-5\.3-flash/)).toBeInTheDocument();
  });
});
