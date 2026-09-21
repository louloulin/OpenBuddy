// @vitest-environment jsdom
/**
 * ProviderEditor.test.tsx — 「添加 / 编辑厂商」对话框的回归测试。
 *
 * 锁定三组契约:
 *   1. i18n:测试按钮 + 状态消息必须使用中文(避免英文硬编码回流)。
 *   2. IPC 调用:`agent:providers-test` 通道名 + payload 形状必须保持稳定,
 *      以免主进程 IPC handler 改动后 UI 悄无声息地破坏。
 *   3. 状态机:idle → testing → ok/degraded/unreachable/error 各分支的中文提示。
 *
 * 不依赖真实的 Electron preload — 用 `(globalThis as any).window.api` 注入
 * stub,符合 use-frontmatter.test.tsx 的现有模式。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProviderEditor } from "../SettingsPanel";

// ---------------------------------------------------------------------------
// 类型 + 测试 fixture
// ---------------------------------------------------------------------------

type ProviderKindValue = "openai" | "anthropic" | "minimax" | "custom" | "custom_anthropic" | "new_api";

interface TestDraft {
  providerKind: ProviderKindValue;
  apiKey: string;
  baseUrl: string;
  apiBackend: "openai" | "anthropic" | "pi";
  authScheme: "bearer" | "x-api-key";
  contextWindow: string;
}

const baseDraft: TestDraft = {
  providerKind: "openai",
  apiKey: "sk-test-123",
  baseUrl: "https://api.example.com/v1",
  apiBackend: "openai",
  authScheme: "bearer",
  contextWindow: "8192",
};

function setApiMock(invoke: ReturnType<typeof vi.fn>) {
  // 只覆盖 window.api,保留 window 上的其它属性(jsdom 提供的 document/location
  // 等 React scheduler 依赖的全局)。直接替换 window 会触发
  // "Should not already be working."。
  const win = globalThis as unknown as { window: { api?: unknown } };
  win.window.api = { invoke };
}

let savedApi: unknown;
beforeEach(() => {
  savedApi = (globalThis as unknown as { window: { api?: unknown } }).window?.api;
  setApiMock(vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // 还原测试前的 window.api,避免污染后续 suite。
  if (savedApi === undefined) {
    delete (globalThis as unknown as { window: { api?: unknown } }).window.api;
  } else {
    (globalThis as unknown as { window: { api?: unknown } }).window.api = savedApi;
  }
});

// ---------------------------------------------------------------------------
// 契约 1:i18n — 按钮文本必须中文
// ---------------------------------------------------------------------------

describe("ProviderEditor — 测试连接按钮 i18n", () => {
  it("按钮渲染中文「测试连接」", () => {
    render(
      <ProviderEditor
        draft={baseDraft as never}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByTestId("provider-test-button").textContent).toContain("测试连接");
    expect(screen.getByTestId("provider-test-button").textContent).not.toContain("Test connection");
  });

  it("测试中态按钮文案切换为「测试中…」", async () => {
    const invoke = vi.fn(async () => new Promise(() => {})); // 永不 resolve,保持 testing
    setApiMock(invoke);
    render(
      <ProviderEditor
        draft={baseDraft as never}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("provider-test-button"));
    await waitFor(() => {
      expect(screen.getByTestId("provider-test-button").textContent).toContain("测试中…");
    });
  });
});

// ---------------------------------------------------------------------------
// 契约 2:IPC 调用 — 通道名 + payload 形状
// ---------------------------------------------------------------------------

describe("ProviderEditor — agent:providers-test IPC 调用契约", () => {
  it("点击测试按钮时调用 agent:providers-test 并把当前表单值作为 payload 传过去", async () => {
    const invoke = vi.fn(async () => ({
      status: "healthy",
      modelsCount: 12,
      latencyMs: 240,
      probe: "models",
    }));
    setApiMock(invoke);

    render(
      <ProviderEditor
        draft={baseDraft as never}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("provider-test-button"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    });
    const [channel, payload] = invoke.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(channel).toBe("agent:providers-test");
    expect(payload).toEqual({
      baseUrl: baseDraft.baseUrl,
      apiKey: baseDraft.apiKey,
      providerKind: baseDraft.providerKind,
    });
  });

  it("没有 baseUrl 时按钮被禁用,不会发起 IPC", () => {
    const invoke = vi.fn();
    setApiMock(invoke);
    render(
      <ProviderEditor
        draft={{ ...baseDraft, baseUrl: "" } as never}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    const btn = screen.getByTestId("provider-test-button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(invoke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 契约 3:状态机 — healthy / degraded / unreachable / error / IPC 异常
// ---------------------------------------------------------------------------

describe("ProviderEditor — 测试结果状态机", () => {
  function setupWithResponse(response: unknown) {
    const invoke = vi.fn(async () => response);
    setApiMock(invoke);
    return invoke;
  }

  it("healthy + probe=models → 中文「N 个模型可达」", async () => {
    setupWithResponse({ status: "healthy", modelsCount: 12, latencyMs: 240, probe: "models" });
    render(<ProviderEditor draft={baseDraft as never} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId("provider-test-button"));
    await waitFor(() => {
      const node = screen.getByTestId("provider-test-result");
      expect(node.dataset.status).toBe("ok");
      expect(node.textContent).toContain("12 个模型可达");
      expect(node.textContent).toContain("240 毫秒");
    });
  });

  it("healthy + probe=messages → 中文「聊天端点可达」(不展示模型数,避免 0 模型误导)", async () => {
    setupWithResponse({ status: "healthy", latencyMs: 180, probe: "messages" });
    render(<ProviderEditor draft={baseDraft as never} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId("provider-test-button"));
    await waitFor(() => {
      const node = screen.getByTestId("provider-test-result");
      expect(node.dataset.status).toBe("ok");
      expect(node.textContent).toContain("聊天端点可达");
      expect(node.textContent).toContain("180 毫秒");
      expect(node.textContent).not.toContain("0 个模型");
    });
  });

  it("degraded → 中文「服务返回非 2xx 状态」兜底文案", async () => {
    setupWithResponse({ status: "degraded", errorCode: "401" });
    render(<ProviderEditor draft={baseDraft as never} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId("provider-test-button"));
    await waitFor(() => {
      const node = screen.getByTestId("provider-test-result");
      expect(node.dataset.status).toBe("degraded");
      expect(node.textContent).toContain("401");
      expect(node.textContent).toContain("服务返回非 2xx 状态");
    });
  });

  it("unreachable → 中文「无法连接服务」兜底文案", async () => {
    setupWithResponse({ status: "unreachable", errorCode: "ECONNREFUSED" });
    render(<ProviderEditor draft={baseDraft as never} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId("provider-test-button"));
    await waitFor(() => {
      const node = screen.getByTestId("provider-test-result");
      expect(node.dataset.status).toBe("unreachable");
      expect(node.textContent).toContain("ECONNREFUSED");
      expect(node.textContent).toContain("无法连接服务");
    });
  });

  it("未知 status → 中文「未知状态」兜底文案", async () => {
    setupWithResponse({ status: "weird-new-state" });
    render(<ProviderEditor draft={baseDraft as never} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId("provider-test-button"));
    await waitFor(() => {
      const node = screen.getByTestId("provider-test-result");
      expect(node.dataset.status).toBe("error");
      expect(node.textContent).toContain("未知状态");
      expect(node.textContent).toContain("weird-new-state");
    });
  });

  it("IPC 抛错 → 中文「IPC 桥接错误」", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("bridge offline");
    });
    setApiMock(invoke);
    render(<ProviderEditor draft={baseDraft as never} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByTestId("provider-test-button"));
    await waitFor(() => {
      const node = screen.getByTestId("provider-test-result");
      expect(node.dataset.status).toBe("error");
      expect(node.textContent).toContain("IPC 桥接错误");
      expect(node.textContent).toContain("bridge offline");
    });
  });
});

// ---------------------------------------------------------------------------
// 取消按钮回调
// ---------------------------------------------------------------------------

describe("ProviderEditor — 取消按钮", () => {
  it("点击取消时调用 onCancel", () => {
    const onCancel = vi.fn();
    render(<ProviderEditor draft={baseDraft as never} onCancel={onCancel} onSave={vi.fn()} />);
    fireEvent.click(screen.getByText("取消"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
