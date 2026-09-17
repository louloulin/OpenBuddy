/**
 * FilePreview — Office 预览槽接管测试 (R69)。
 *
 * 验证:
 *   1) 没有插件时,FilePreview 走内置 Docx/Xlsx/Pptx Preview(rendering 落到内置组件名)。
 *   2) 第三方插件以更高 priority 注册 workbench.preview.docx 单例槽后,
 *      FilePreview 把同一个 docx 文件渲染交给插件提供的 CustomPreview。
 *   3) SlotProvider 卸载 / 组件 unmount 时不报错。
 *
 * 这是微内核"插件可整体接管对应格式"承诺的最小可验证证据。
 */
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SlotProvider } from "@openbuddy/ui-runtime/client";
import { getRuntime, registerAllBuiltinUis } from "@openbuddy/ui-runtime/client";
import { FilePreview } from "../FilePreview";

// 一个最小的 zip-loader 占位:FilePreview 的 `richOfficePreview` 路径要求
// content 非空,但实际并不调用 docExtractor(走 DocxPreview 内置懒加载),
// 所以这里空字符串 + payload 就好。
const base64 = "data:application/octet-stream;base64,UEsDBA==";

function customPreviewProps(props: Record<string, unknown>) {
  return {
    filename: props.filename as string,
    content: props.content as string,
    fallback: props.fallback as React.ReactNode,
    className: props.className as string | undefined,
  };
}

beforeEach(() => {
  cleanup();
});

describe("FilePreview × workbench.preview.* slot", () => {
  it("无插件覆盖时,docx 文件回落到内置 DocxPreview(data-office-kind='docx')", () => {
    registerAllBuiltinUis();
    render(
      <SlotProvider runtime={getRuntime()}>
        <FilePreview filename="report.docx" content={base64} docExtractor={() => null} />
      </SlotProvider>
    );
    // 内置 DocxPreview 用 data-office-kind="docx" 标记;插件覆盖后会换成我们
    // 自定义组件的 data-testid。
    expect(document.querySelector("[data-office-kind='docx']")).toBeTruthy();
    expect(screen.queryByTestId("custom-docx-preview")).toBeNull();
  });

  it("第三方插件覆盖 workbench.preview.docx 后,FilePreview 渲染插件版本", () => {
    const rt = getRuntime();
    registerAllBuiltinUis();

    function CustomDocxPreview(props: Record<string, unknown>) {
      const p = customPreviewProps(props);
      return (
        <div data-testid="custom-docx-preview">
          CUSTOM DOC X: {p.filename}
        </div>
      );
    }

    const dispose = rt.slots.register(
      {
        name: "workbench.preview.docx",
        kind: "single",
        scope: "root",
        // Higher priority wins (slot core priority sort):
        priority: 100,
        registrant: "@test/custom-docx-plugin",
      },
      CustomDocxPreview as never
    );
    try {
      render(
        <SlotProvider runtime={rt}>
          <FilePreview filename="report.docx" content={base64} docExtractor={() => null} />
        </SlotProvider>
      );
      // 插件覆盖生效,内置组件不再出现。
      expect(screen.getByTestId("custom-docx-preview")).toBeTruthy();
      expect(document.querySelector("[data-office-kind='docx']")).toBeNull();
    } finally {
      dispose();
    }
  });

  it("插件卸载后,FilePreview 自动回落到内置 DocxPreview(契约完整)", () => {
    const rt = getRuntime();
    registerAllBuiltinUis();

    function CustomDocxPreview(props: Record<string, unknown>) {
      return (
        <div data-testid="custom-docx-preview">CUSTOM: {(props.filename as string) ?? ""}</div>
      );
    }

    const dispose = rt.slots.register(
      {
        name: "workbench.preview.docx",
        kind: "single",
        scope: "root",
        priority: 100,
        registrant: "@test/custom-docx-plugin",
      },
      CustomDocxPreview as never
    );

    const view = render(
      <SlotProvider runtime={rt}>
        <FilePreview filename="report.docx" content={base64} docExtractor={() => null} />
      </SlotProvider>
    );
    expect(screen.getByTestId("custom-docx-preview")).toBeTruthy();
    dispose();
    view.rerender(
      <SlotProvider runtime={rt}>
        <FilePreview filename="report.docx" content={base64} docExtractor={() => null} />
      </SlotProvider>
    );
    // 插件被卸载后,内置 DocxPreview 应重新可见。
    expect(document.querySelector("[data-office-kind='docx']")).toBeTruthy();
  });
});
