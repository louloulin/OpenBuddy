// @vitest-environment jsdom
/**
 * useComposerAttachments — 钩子行为测试（Phase 3 落地配套）
 *
 * 钩子位于 packages/ui/openbuddy-ui-conversation/src/composer/use-composer-attachments.ts
 *
 * 验证范围（避免依赖 Electron 桥 + DOM webview 的复杂 setup）：
 *   1. 初始 state（attachments / images / dragActive 都空 / false）
 *   2. setAttachments / setImages 通过返回值对外暴露
 *   3. readImageFile 校验逻辑（MIME 类型 + 大小）
 *      - 支持的 image MIME（image/png 等）→ 返回 ImageAttachment
 *      - 支持的 doc MIME（application/pdf 等）→ 返回 ImageAttachment kind="file"
 *      - 不支持的 MIME → 返回 null + onToast 触发
 *      - 超过 IMAGE_CAP 16MB → 返回 null + onToast 触发
 *      - 超过 FILE_CAP 8MB → 返回 null + onToast 触发
 *   4. readImageFile 产生的 ImageAttachment 数据形状正确
 *
 * 拖拽（getCurrentWebview + onDragDropEvent）和 picker（openPaths）在 jsdom
 * 下需要 electron fake，不在本测试范围（留待 vitest-electron 后续接入）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// 这些模块在 Composer 测试里都被 mock 掉以避免 jsdom 下 Electron 缺失
// 直接报错；本测试也走同一路径，只关注 readImageFile 的纯函数分支。
vi.mock("@/lib/platform/electron-api", () => ({
  openPaths: vi.fn().mockResolvedValue([]),
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => undefined)),
  })),
}));
vi.mock("@/lib/files/drop-utils", () => ({
  collectDroppedPaths: vi.fn((paths: readonly string[]) => [...paths]),
  isDragDrop: vi.fn(() => false),
  isDragHovering: vi.fn(() => false),
}));

import { useComposerAttachments } from "../composer/use-composer-attachments";

const noop = () => undefined;

describe("useComposerAttachments — 初始 state", () => {
  it("默认返回 attachments/images 空数组 + dragActive false", () => {
    const { result } = renderHook(() => useComposerAttachments({ onToast: noop }));
    expect(result.current.attachments).toEqual([]);
    expect(result.current.images).toEqual([]);
    expect(result.current.dragActive).toBe(false);
    expect(result.current.imagesRef.current).toEqual([]);
  });

  it("setAttachments / setImages 是 React.Dispatch 类型（外部可写）", () => {
    const { result } = renderHook(() => useComposerAttachments({ onToast: noop }));
    expect(typeof result.current.setAttachments).toBe("function");
    expect(typeof result.current.setImages).toBe("function");
  });

  it("imagesRef 跟随 images state 同步", () => {
    const { result } = renderHook(() => useComposerAttachments({ onToast: noop }));
    act(() => {
      result.current.setImages([{
        id: "img_test_1",
        mediaType: "image/png",
        data: "AAA",
        kind: "image",
        name: "x.png",
      }]);
    });
    expect(result.current.images).toHaveLength(1);
    expect(result.current.imagesRef.current).toHaveLength(1);
    expect(result.current.imagesRef.current[0]?.id).toBe("img_test_1");
  });
});

describe("useComposerAttachments — readImageFile（MIME 校验）", () => {
  it("支持 image/png → 返回 ImageAttachment kind=image", async () => {
    const { result } = renderHook(() => useComposerAttachments({ onToast: vi.fn() }));
    const file = new File([new Uint8Array(8)], "tiny.png", { type: "image/png" });
    let attachment: Awaited<ReturnType<typeof result.current.readImageFile>> | undefined;
    await act(async () => {
      attachment = await result.current.readImageFile(file);
    });
    expect(attachment).not.toBeNull();
    expect(attachment!.kind).toBe("image");
    expect(attachment!.mediaType).toBe("image/png");
    expect(attachment!.data).toMatch(/^[A-Za-z0-9+/=]+$/); // base64-ish
  });

  it("支持 application/pdf → 返回 ImageAttachment kind=file", async () => {
    const { result } = renderHook(() => useComposerAttachments({ onToast: vi.fn() }));
    const file = new File([new Uint8Array(16)], "spec.pdf", { type: "application/pdf" });
    let attachment: Awaited<ReturnType<typeof result.current.readImageFile>> | undefined;
    await act(async () => {
      attachment = await result.current.readImageFile(file);
    });
    expect(attachment).not.toBeNull();
    expect(attachment!.kind).toBe("file");
    expect(attachment!.mediaType).toBe("application/pdf");
  });

  it("不支持的 MIME（application/zip）→ 返回 null + toast", async () => {
    const toast = vi.fn();
    const { result } = renderHook(() => useComposerAttachments({ onToast: toast }));
    const file = new File([new Uint8Array(8)], "blob.zip", { type: "application/zip" });
    let attachment: Awaited<ReturnType<typeof result.current.readImageFile>> | undefined;
    await act(async () => {
      attachment = await result.current.readImageFile(file);
    });
    expect(attachment).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("不支持的文件类型"));
  });

  it("未知 MIME（空字符串）→ 返回 null + toast", async () => {
    const toast = vi.fn();
    const { result } = renderHook(() => useComposerAttachments({ onToast: toast }));
    const file = new File([new Uint8Array(8)], "blob", { type: "" });
    let attachment: Awaited<ReturnType<typeof result.current.readImageFile>> | undefined;
    await act(async () => {
      attachment = await result.current.readImageFile(file);
    });
    expect(attachment).toBeNull();
    expect(toast).toHaveBeenCalled();
  });
});

describe("useComposerAttachments — readImageFile（大小校验）", () => {
  it("image > 16MB → 返回 null + toast", async () => {
    const toast = vi.fn();
    const { result } = renderHook(() => useComposerAttachments({ onToast: toast }));
    // 17MB 文件（17 * 1024 * 1024 字节），仅声明 size；FileReader 不会真读这么多
    const big = new File([new Uint8Array(8)], "huge.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 17 * 1024 * 1024 });
    let attachment: Awaited<ReturnType<typeof result.current.readImageFile>> | undefined;
    await act(async () => {
      attachment = await result.current.readImageFile(big);
    });
    expect(attachment).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("16MB"));
  });

  it("file > 8MB → 返回 null + toast", async () => {
    const toast = vi.fn();
    const { result } = renderHook(() => useComposerAttachments({ onToast: toast }));
    const big = new File([new Uint8Array(8)], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    let attachment: Awaited<ReturnType<typeof result.current.readImageFile>> | undefined;
    await act(async () => {
      attachment = await result.current.readImageFile(big);
    });
    expect(attachment).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("8MB"));
  });

  it("openPaths 返回空（用户取消）→ attachments 不变", async () => {
    const { openPaths } = await import("@/lib/platform/electron-api");
    vi.mocked(openPaths).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useComposerAttachments({ onToast: noop }));
    await act(async () => {
      await result.current.pickFiles();
    });
    expect(result.current.attachments).toEqual([]);
  });

  it("openPaths 抛错（dialog plugin 不可用）→ 静默降级，attachments 不变", async () => {
    const { openPaths } = await import("@/lib/platform/electron-api");
    vi.mocked(openPaths).mockRejectedValueOnce(new Error("no dialog plugin"));
    const { result } = renderHook(() => useComposerAttachments({ onToast: vi.fn() }));
    await act(async () => {
      await result.current.pickFiles();
    });
    expect(result.current.attachments).toEqual([]);
  });
});

describe("useComposerAttachments — pickImages（fetch + readImageFile）", () => {
  it("fetch 失败（非 Electron-compatible）→ toast + 不入队", async () => {
    const toast = vi.fn();
    const { openPaths } = await import("@/lib/platform/electron-api");
    vi.mocked(openPaths).mockResolvedValueOnce(["/path/to/img.png"]);
    // jsdom 下 fetch 会 reject（无 file:// protocol 支持）
    const { result } = renderHook(() => useComposerAttachments({ onToast: toast }));
    await act(async () => {
      await result.current.pickImages();
    });
    expect(result.current.images).toEqual([]);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("无法读取图片"));
  });

  it("openPaths 返回空 → 跳过 fetch 循环", async () => {
    const { openPaths } = await import("@/lib/platform/electron-api");
    vi.mocked(openPaths).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useComposerAttachments({ onToast: vi.fn() }));
    await act(async () => {
      await result.current.pickImages();
    });
    expect(result.current.images).toEqual([]);
  });
});

describe("useComposerAttachments — drag（webview 原生事件）", () => {
  it("getCurrentWebview 抛错（非 Electron）→ 静默降级（dragActive 保持 false）", async () => {
    // renderHook 时就抛错 — useEffect 内 try/catch 应吞掉
    const { getCurrentWebview } = (await import("@/lib/platform/electron-api")) as typeof import("@/lib/platform/electron-api");
    vi.mocked(getCurrentWebview as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("no webview in jsdom");
    });
    const { result } = renderHook(() => useComposerAttachments({ onToast: noop }));
    // 不应抛错；dragActive 保持 false
    expect(result.current.dragActive).toBe(false);
  });
});
