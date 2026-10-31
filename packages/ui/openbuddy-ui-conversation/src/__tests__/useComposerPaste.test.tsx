/**
 * useComposerPaste.test.tsx — Plan5 组件化回归测试
 *
 * 验证从 Composer 抽出的 paste hook:
 *   - 文本粘贴:优先 Electron readText(大文本完整),插入到实时值与光标
 *   - 文件粘贴(image/* 或 document/*):走 readImageFile + 写入 images 状态,
 *     不往输入框里插 `![pasted image]()`
 *   - readText 为空回落 DOM 文本;无 Electron 时同步插入
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComposerPaste } from "../composer/use-composer-paste";
import type { ImageAttachment } from "../composer/types";
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
  it("文本粘贴:优先 Electron readText,插入到实时值与光标(期间新输入不丢)", async () => {
    const updateText = vi.fn();
    const el = { focus: vi.fn(), value: "ab", selectionStart: 1, selectionEnd: 1 };
    const ref: RefObject<HTMLTextAreaElement> = { current: el as unknown as HTMLTextAreaElement };
    let release: (v: string) => void = () => undefined;
    const readText = vi.fn(() => new Promise<string>((r) => { release = r; }));
    const { result } = renderHook(() =>
      useComposerPaste({
        ref,
        text: "ab",
        setImages: vi.fn(),
        updateText,
        setCursorPos: vi.fn(),
        electronApi: { clipboard: { readText } },
      }),
    );
    const evt = fakeEvent({ text: "dom" }) as { preventDefault: ReturnType<typeof vi.fn> };
    act(() => {
      result.current(evt as never);
    });
    expect(evt.preventDefault).toHaveBeenCalled();
    // 用户在 IPC 读取期间继续输入
    el.value = "abc";
    el.selectionStart = el.selectionEnd = 3;
    act(() => release("X"));
    await vi.waitFor(() => expect(updateText).toHaveBeenCalledWith("abcX"));
  });

  it("Electron readText 为空时回落到 DOM 文本;无 Electron 时同步插入 DOM 文本", async () => {
    const updateText = vi.fn();
    const ref: RefObject<HTMLTextAreaElement> = {
      current: { focus: vi.fn(), value: "ab", selectionStart: 1, selectionEnd: 1 } as unknown as HTMLTextAreaElement,
    };
    const { result, rerender } = renderHook(
      ({ api }: { api?: { clipboard: { readText: () => Promise<string> } } }) =>
        useComposerPaste({ ref, text: "ab", setImages: vi.fn(), updateText, setCursorPos: vi.fn(), electronApi: api }),
      {
        initialProps: { api: { clipboard: { readText: async () => "" } } } as {
          api?: { clipboard: { readText: () => Promise<string> } };
        },
      },
    );
    act(() => {
      result.current(fakeEvent({ text: "D" }) as never);
    });
    await vi.waitFor(() => expect(updateText).toHaveBeenLastCalledWith("aDb"));
    rerender({ api: undefined });
    // 上一次插入的 rAF 会把光标移到插入点之后;复位后再测同步路径。
    Object.assign(ref.current!, { selectionStart: 1, selectionEnd: 1 });
    act(() => {
      result.current(fakeEvent({ text: "S" }) as never);
    });
    expect(updateText).toHaveBeenLastCalledWith("aSb");
  });

  it("浏览器支持 insertText 时走原生编辑栈(可撤销),不直接改 state", async () => {
    const updateText = vi.fn();
    const setSelectionRange = vi.fn();
    const ref: RefObject<HTMLTextAreaElement> = {
      current: { focus: vi.fn(), value: "ab", selectionStart: 1, selectionEnd: 1, setSelectionRange } as unknown as HTMLTextAreaElement,
    };
    const original = document.execCommand;
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand as typeof document.execCommand;
    try {
      const { result } = renderHook(() =>
        useComposerPaste({ ref, text: "ab", setImages: vi.fn(), updateText, setCursorPos: vi.fn(), electronApi: undefined }),
      );
      act(() => {
        result.current(fakeEvent({ text: "Z" }) as never);
      });
      expect(setSelectionRange).toHaveBeenCalledWith(1, 1);
      expect(execCommand).toHaveBeenCalledWith("insertText", false, "Z");
      expect(updateText).not.toHaveBeenCalled();
    } finally {
      document.execCommand = original;
    }
  });

  it("图片粘贴:image/* → 走 readImageFile → push 到 images 状态", async () => {
    const updateText = vi.fn();
    const setCursorPos = vi.fn();
    const setImages = vi.fn((updater: (prev: ImageAttachment[]) => ImageAttachment[]) => {
      updater([]);
    });
    const ref: RefObject<HTMLTextAreaElement> = {
      current: {
        focus: vi.fn(),
        selectionStart: 0,
        selectionEnd: 0,
      } as unknown as HTMLTextAreaElement,
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
    // 图片只作为附件 chip,不往提示词里写占位 markdown。
    expect(updateText).not.toHaveBeenCalled();
  });
});
