import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataDirPrompt } from "../components/DataDirPrompt";

afterEach(() => cleanup());

describe("@openbuddy/ui-onboarding/DataDirPrompt", () => {
  it("默认选中第一个候选目录并渲染隐私说明", () => {
    render(<DataDirPrompt defaultPaths={["/data/a", "/data/b"]} onSubmit={() => {}} />);
    expect((screen.getByTestId("data-dir-input") as HTMLInputElement).value).toBe("/data/a");
    expect(screen.getAllByTestId("data-dir-default")).toHaveLength(2);
    expect(screen.getByTestId("data-dir-prompt").textContent).toContain("不会上传");
  });

  it("点击候选目录切换输入框的值", () => {
    render(<DataDirPrompt defaultPaths={["/data/a", "/data/b"]} onSubmit={() => {}} />);
    fireEvent.click(screen.getAllByTestId("data-dir-default")[1]);
    expect((screen.getByTestId("data-dir-input") as HTMLInputElement).value).toBe("/data/b");
  });

  it("提交时去掉首尾空白", () => {
    const onSubmit = vi.fn();
    render(<DataDirPrompt initialPath="  /data/a  " onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("data-dir-submit"));
    expect(onSubmit).toHaveBeenCalledWith("/data/a");
  });

  it("回车提交", () => {
    const onSubmit = vi.fn();
    render(<DataDirPrompt initialPath="/data/a" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByTestId("data-dir-input"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("/data/a");
  });

  it("空路径拦截并给出本地错误,不回调宿主", () => {
    const onSubmit = vi.fn();
    render(<DataDirPrompt initialPath="   " onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("data-dir-submit"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("data-dir-error").textContent).toBe("请选择或输入一个目录");

    fireEvent.change(screen.getByTestId("data-dir-input"), { target: { value: "/data/c" } });
    expect(screen.queryByTestId("data-dir-error")).toBeNull();
  });

  it("宿主错误优先展示,并支持 onCancel", () => {
    const onCancel = vi.fn();
    render(
      <DataDirPrompt
        initialPath="/data/a"
        onSubmit={() => {}}
        onCancel={onCancel}
        error="目录不可写"
      />,
    );
    expect(screen.getByTestId("data-dir-error").textContent).toBe("目录不可写");
    fireEvent.click(screen.getByTestId("data-dir-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("不传 onCancel 时不渲染取消按钮", () => {
    render(<DataDirPrompt initialPath="/data/a" onSubmit={() => {}} />);
    expect(screen.queryByTestId("data-dir-cancel")).toBeNull();
  });

  it("busy 时禁用交互并换按钮文案", () => {
    render(<DataDirPrompt initialPath="/data/a" onSubmit={() => {}} busy />);
    const submit = screen.getByTestId("data-dir-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe("保存中…");
    expect((screen.getByTestId("data-dir-input") as HTMLInputElement).disabled).toBe(true);
  });

  it("initialPath 变化时覆盖本地输入(宿主异步拿到当前目录)", () => {
    const { rerender } = render(<DataDirPrompt initialPath="/old" onSubmit={() => {}} />);
    rerender(<DataDirPrompt initialPath="/new" onSubmit={() => {}} />);
    expect((screen.getByTestId("data-dir-input") as HTMLInputElement).value).toBe("/new");
  });
});
