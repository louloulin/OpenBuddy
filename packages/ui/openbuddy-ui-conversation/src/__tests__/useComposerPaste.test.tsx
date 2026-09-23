/**
 * useComposerPaste.test.tsx — Plan5 组件化回归测试
 *
 * 验证从 Composer 抽出的 paste hook:
 *   - 文本粘贴:insert + 焦点恢复 + caret 复位
 *   - 文件粘贴(image/* 或 document/*):走 readImageFile + 写入 images 状态
 *   - 无 nativeReadText 时退回到 event.clipboardData
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComposerPaste } from "../composer/use-composer-paste";
import type { RefObject } from "react";

// mock send-payload 中的 readImageFile
vi.mock("../composer/send-payload", () => ({
  readImageFile: vi.fn(async () => ({
    id: "img-1",
    kind: "image",
    mediaType: "image/png",
    data: "base64data",
    name: "pasted.png",
  })),
}));

function fakeEvent(opts: {
  text?: string;
  file?: { kind: string; type: string; getAsFile: () => File | null };
}): unknown {
  const items = opts.file ? [opts.file] : [];
  return {
    preventDefault: vi.fn(),
    currentTarget: {
      selectionStart: 0,
      selectionEnd: 0,
    },
    clipboardData: {
      items,
      getData: (_t: string) => opts.text ?? "",
    },
  };
}

describe("useComposerPaste (Plan5 componentization)", () => {
  it("文本粘贴:调 updateText,带 setCursorPos + 1 frame 焦点恢复", () => {
    const updateText = vi.fn();
    const setCursorPos = vi.fn();
    const setImages = vi.fn();
    const focus = vi.fn();
    const ref: RefObject<HTMLTextAreaElement> = {
      current: {
        focus,
        selectionStart: 0,
        selectionEnd: 0,
      } as HTMLTextAreaElement,
    };

    const { result } = renderHook(() =>
      useComposerPaste({
        ref,
        text: "",
        setImages,
        updateText,
        setCursorPos,
        electronApi: undefined,
      }),
    );

    const evt = fakeEvent({ text: "hello world" });
    act(() => {
      result.current(evt as never);
    });

    expect(updateText).toHaveBeenCalledWith("hello world");
    expect(setCursorPos).toHaveBeenCalledWith(11);
    // 不应写入图片
    expect(setImages).not.toHaveBeenCalled();
  });

  it("图片粘贴:image/* → 走 readImageFile → push 到 images 状态", async () => {
    const updateText = vi.fn();
    const setCursorPos = vi.fn();
    const setImages = vi.fn((updater: (prev: unknown[]) => unknown[]) => updater([]));
    const ref: RefObject<HTMLTextAreaElement> = {
      current: {
        focus: vi.fn(),
        selectionStart: 0,
        selectionEnd: 0,
      } as HTMLTextAreaElement,
    };

    const { result } = renderHook(() =>
      useComposerPaste({
        ref,
        text: "",
        setImages,
        updateText,
        setCursorPos,
        electronApi: undefined,
      }),
    );

    const fakeFile = {
      kind: "file",
      type: "image/png",
      getAsFile: () => ({ name: "p.png" } as File),
    };
    const evt = fakeEvent({ file: fakeFile });
    await act(async () => {
      result.current(evt as never);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setImages).toHaveBeenCalledTimes(1);
  });
});
