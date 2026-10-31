/**
 * plan1030 §5.2.1 — ModelSelector 图层与删除契约。
 *
 * 真机发现的三件事：
 *   1. 菜单以 position:absolute 渲染在 composer 内,被 `.wb-composer-wrap--home`
 *      等祖先的 overflow:hidden 裁掉首行(-flyout 首行被裁剪);
 *   2. 对话内没有任何删除模型的入口(只有 设置→模型 有);
 *   3. (portal 化的代价)outside-close 若不豁免 portal 菜单,mousedown 会先
 *      关菜单、行点击永远落空 —— 切换看起来"完全不可用"。
 *
 * 层级契约对齐 R8.61 MentionPicker:portal + position:fixed + z-index>=1000。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelSelector, type ModelOption } from "../ModelSelector";

const models: ModelOption[] = [
  { id: "minimax/MiniMax-M2.7", label: "MiniMax-M2.7", apiBackend: "chat_completions" },
  { id: "claude/claude-opus-4.7", label: "Claude Opus 4.7", apiBackend: "messages" },
];

function renderPicker(overrides?: { onModelChange?: (id: string) => void; onModelDelete?: (m: ModelOption) => void }) {
  const onModelChange = overrides?.onModelChange ?? vi.fn();
  const onModelDelete = overrides?.onModelDelete;
  const utils = render(
    <div className="wb-composer">
      <ModelSelector
        modelId="minimax/MiniMax-M2.7"
        models={models}
        onModelChange={onModelChange}
        onModelDelete={onModelDelete}
      />
    </div>,
  );
  return { ...utils, onModelChange, onModelDelete };
}

async function open() {
  await userEvent.click(screen.getByRole("button", { name: /MiniMax-M2.7/ }));
  return screen.getByRole("listbox");
}

describe("plan1030 §5.2.1 — ModelSelector portal layering", () => {
  it("菜单渲染在宿主容器之外(portal 到 body),不被 composer overflow 链裁剪", async () => {
    const { container } = renderPicker();
    const host = container.querySelector(".wb-composer");
    expect(host).toBeTruthy();
    const menu = await open();
    expect(host!.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it("菜单是 position:fixed 且 z-index>=1000(对齐 R8.61 浮层契约)", async () => {
    renderPicker();
    const menu = await open() as HTMLElement;
    const style = menu.style;
    expect(style.position).toBe("fixed");
    expect(Number.parseInt(style.zIndex, 10)).toBeGreaterThanOrEqual(1000);
    // 向上展开:锚点来自 trigger 的 bottom 边,而不是文档流位置。
    expect(style.top).toBe("auto");
    expect(style.bottom).not.toBe("");
  });

  it("portal 菜单内的 mousedown 不会误关菜单 —— 否则行点击永远落空", async () => {
    renderPicker();
    const menu = await open();
    // 模拟点击序列的前半:mousedown 落在菜单行内。
    fireEvent.mouseDown(within(menu).getByText("MiniMax-M2.7"));
    expect(screen.queryByRole("listbox")).not.toBeNull();
    // 后半:click 正常落地并触发切换。
    await userEvent.click(within(menu).getByText("MiniMax-M2.7"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("菜单外的 mousedown 仍然关闭菜单(既有行为不回归)", async () => {
    render(
      <div>
        <ModelSelector modelId="minimax/MiniMax-M2.7" models={models} onModelChange={() => {}} />
        <button data-testid="outside">elsewhere</button>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: /MiniMax-M2.7/ }));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("plan1030 §5.2.1 — ModelSelector 行级删除", () => {
  it("行尾删除按钮触发 onModelDelete 且不触发选中/关菜单", async () => {
    const onModelDelete = vi.fn();
    const { onModelChange } = renderPicker({ onModelDelete });
    const menu = await open();
    const row = within(menu).getByText("Claude Opus 4.7").closest("li")!;
    const del = within(row).getByRole("button", { name: /删除模型 Claude Opus 4.7/ });
    await userEvent.click(del);
    expect(onModelDelete).toHaveBeenCalledWith(models[1]);
    expect(onModelChange).not.toHaveBeenCalled();
    // 删除不关菜单:用户常要连续清理多个模型。
    expect(screen.queryByRole("listbox")).not.toBeNull();
  });

  it("键盘 Delete 删除当前高亮模型行,Backspace 不触发", async () => {
    const onModelDelete = vi.fn();
    const { onModelChange } = renderPicker({ onModelDelete });
    const menu = await open();
    // 默认高亮在当前选中模型(index 0)。
    fireEvent.keyDown(menu, { key: "Delete" });
    expect(onModelDelete).toHaveBeenCalledWith(models[0]);
    expect(onModelChange).not.toHaveBeenCalled();
    fireEvent.keyDown(menu, { key: "Backspace" });
    expect(onModelDelete).toHaveBeenCalledTimes(1);
  });

  it("键盘 Delete 对推理档位行不生效", async () => {
    const onModelDelete = vi.fn();
    const onThinkingChange = vi.fn();
    render(
      <ModelSelector
        modelId="minimax/MiniMax-M2.7"
        models={models}
        onModelChange={() => {}}
        onModelDelete={onModelDelete}
        thinkingLevel="medium"
        onThinkingChange={onThinkingChange}
      />,
    );
    const menu = await open();
    fireEvent.keyDown(menu, { key: "End" }); // 跳到最后一个档位行
    fireEvent.keyDown(menu, { key: "Delete" });
    expect(onModelDelete).not.toHaveBeenCalled();
    expect(onThinkingChange).not.toHaveBeenCalled();
  });

  it("不传 onModelDelete 时不渲染删除按钮", async () => {
    renderPicker();
    const menu = await open();
    expect(within(menu).queryAllByRole("button", { name: /删除模型/ })).toHaveLength(0);
  });
});
