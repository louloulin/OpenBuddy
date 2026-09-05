/**
 * ChatView pause/yield/resume 闭环集成测试。
 *
 * 验证:
 *  - 流式时显示「暂停」按钮,点击 → onCancel + 进入 yielding。
 *  - 流式结束(yielding → yielded)显示「已暂停」横幅 + 「恢复」/「恢复并继续」两按钮。
 *  - 「恢复」:仅清状态(不触发 onSend)。
 *  - 「恢复并继续」:清状态 + onSend("请继续。")。
 *
 * mock session-store 提供 streaming/sessionId/messages;mock pi-client 的 rewind*。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// session-store mock:可控的 streaming / sessionId / messages。
let storeState: {
  messages: unknown[];
  streaming: boolean;
  streamingMessageId: string | null;
  error: string | null;
  plan: null;
  sessionId: string | null;
  setDraft: () => void;
} = {
  messages: [],
  streaming: false,
  streamingMessageId: null,
  error: null,
  plan: null,
  sessionId: "s1",
  setDraft: () => {},
};
const rendererSessionSnapshot = vi.hoisted(() => ({
  items: [], byId: {}, current: "s1", state: "idle" as const, phase: "ready" as const,
  subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined as { parentSessionId: string; childSessionId: string; mode: "one-shot" | "continuable" } | undefined,
  subagentBreadcrumb: [], error: undefined,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));
vi.mock("@/stores/sessions-store", () => ({
  useSessionsStore: (sel: (s: {
    drafts: Record<string, string>;
    setDraft: () => void;
    independent: unknown[];
    workspaceSessions: Record<string, unknown[]>;
  }) => unknown) =>
    sel({
      drafts: {},
      setDraft: () => {},
      independent: [],
      workspaceSessions: {},
    }),
  HOME_DRAFT_KEY: "home",
}));
vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
  useRendererSlotEntries: () => [],
  getRendererPluginRuntime: () => ({
    context: {
      get: () => ({
        list: {
          getSnapshot: () => rendererSessionSnapshot,
          subscribe: () => () => undefined,
        },
      }),
    },
  }),
}));

vi.mock("@/lib/agent/pi-client", async () => {
  // 用空实现铺满所有被引用的导出,避免「No export defined」。
  const mod: Record<string, unknown> = {};
  const handler = () => undefined;
  const asyncEmpty = async () => undefined;
  const asyncArr = async () => [];
  for (const name of [
    "rewindExecute", "rewindPoints", "piInit", "piNewSession", "piSend",
    "piCancel", "piLoadSession", "piListSessions", "piListWorkspaces",
    "piRenameSession", "piSetModel", "piSetSessionExpert", "piAuthStatus",
    "providersList", "flattenModels", "subscribePiEvents",
    "commandsList", "promptHistory", "tasksList", "taskKill", "permissionList",
    "permissionSave", "permissionModeGet", "permissionModeSet",
    "sessionSearch", "sessionFork", "agentsList", "agentsGet", "agentsSave",
    "agentsDelete", "agentsTemplate", "mcpList", "mcpUpsert", "mcpDelete",
    "mcpToggle", "mcpConfigPath", "mcpConfigRead", "mcpConfigSave", "mcpAuthTrigger",
    "mcpAuthStatus", "togglePlanMode", "internalReload", "automationsSnapshot",
    "automationsSave", "automationsDelete", "automationsSetStatus", "automationsRun",
    "automationRecordsArchive", "automationRecordsDelete",
    "accountGetApiKey", "accountSetApiKey", "agentsDefaultsGet", "agentsDefaultsSave",
    "pluginsList", "pluginsAction", "marketplaceList", "marketplaceAction",
    "exportTextFile", "openUrl", "folderTrustRespond",
    "piDeleteSession", "piSetSessionPinned", "piSetSessionArchived",
    "piSessionInfo", "piSessionUsage", "piResolvePermission",
    "piResolveQuestion", "connectorsCliStatus", "connectorsCliAuth",
    "connectorsCliAuthCancel", "connectorsCliUnauth", "connectorsCliSkillsDir",
    "onConnectorCliAuthUrl", "onConnectorCliAuthLog", "onConnectorCliAuthDone",
    "connectorsDefaultRoot", "connectorsListRoots", "connectorsLoad", "connectorsIcon",
    "connectorsReadMcpConfig", "skillsCatalogDefaultRoot", "skillsCatalogListRoots",
    "skillsCatalogLoad", "skillsCatalogReadSkill", "expertsDefaultRoot",
    "expertsListRoots", "expertsLoad", "expertsThumbnail", "expertsImageBytes",
    "expertsReadAgentPrompt", "expertsLinkAgents", "piClearSessionExpert",
    "skillsList", "skillsAdd", "skillsRemove", "skillsToggle",
    "collaborationOnUpdate",
  ]) {
    mod[name] = name.startsWith("on") ? handler : asyncArr;
  }
  // 个别需要特定返回。
  mod.rewindExecute = asyncEmpty;
  mod.rewindPoints = asyncArr;
  mod.providersList = async () => ({ providers: [], models: [] });
  mod.flattenModels = () => [];
  mod.piAuthStatus = async () => ({ ready: true, hasAuthFile: true, providers: [] });
  mod.subscribePiEvents = async () => () => {};
  mod.permissionModeGet = async () => "default";
  mod.agentsList = asyncArr;
  mod.mcpList = asyncArr;
  mod.tasksList = asyncArr;
  mod.commandsList = asyncArr;
  mod.promptHistory = asyncArr;
  return mod;
});

import { ChatView } from "@openbuddy/ui-conversation";
import { ThemeProvider } from "@openbuddy/ui-theme/client";

/** 用 ThemeProvider 包裹(ChatView 内的 MessageItem/Markdown 需要 useTheme)。 */
function renderChat() {
  return render(
    <ThemeProvider>
      <ChatView {...baseProps} />
    </ThemeProvider>,
  );
}

const baseProps = {
  onSend: vi.fn(),
  onCancel: vi.fn(),
  modelId: "m1",
  onToast: vi.fn(),
};

function setStore(patch: Partial<typeof storeState>) {
  storeState = { ...storeState, ...patch };
}

describe("ChatView pause/yield/resume 闭环", () => {
  beforeEach(() => {
    setStore({
      messages: [{ id: "u1", role: "user", complete: true, parts: [{ kind: "text", text: "hi" }] }],
      streaming: false,
      streamingMessageId: null,
      error: null,
      plan: null,
      sessionId: "s1",
    });
    baseProps.onSend.mockClear();
    baseProps.onCancel.mockClear();
    baseProps.onToast.mockClear();
  });

  it("流式时显示「暂停」按钮,点击触发 onCancel", () => {
    setStore({ streaming: true, streamingMessageId: "a1" });
    renderChat();
    const pauseBtn = screen.getByTitle("暂停生成(保留会话,可继续)");
    fireEvent.click(pauseBtn);
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it("暂停 → 流式结束 → 显示「已暂停」横幅 + 两个恢复按钮", async () => {
    // 初始流式 → 点暂停。
    setStore({ streaming: true, streamingMessageId: "a1" });
    const { rerender } = renderChat();
    fireEvent.click(screen.getByTitle("暂停生成(保留会话,可继续)"));
    expect(baseProps.onCancel).toHaveBeenCalled();
    // 模拟 pi complete:streaming → false。yield 状态在 streaming 结束后确认。
    setStore({ streaming: false, streamingMessageId: null });
    rerender(
      <ThemeProvider>
        <ChatView {...baseProps} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("已暂停(会话上下文已保留)")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "恢复" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复并继续" })).toBeInTheDocument();
  });

  it("「恢复」仅清状态,不触发 onSend", async () => {
    setStore({ streaming: true, streamingMessageId: "a1" });
    const { rerender } = renderChat();
    fireEvent.click(screen.getByTitle("暂停生成(保留会话,可继续)"));
    setStore({ streaming: false, streamingMessageId: null });
    rerender(
      <ThemeProvider>
        <ChatView {...baseProps} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("已暂停(会话上下文已保留)")).toBeInTheDocument());
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    });
    expect(baseProps.onSend).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText("已暂停(会话上下文已保留)")).toBeNull(),
    );
  });

  it("「恢复并继续」清状态 + onSend(\"请继续。\")", async () => {
    setStore({ streaming: true, streamingMessageId: "a1" });
    const { rerender } = renderChat();
    fireEvent.click(screen.getByTitle("暂停生成(保留会话,可继续)"));
    setStore({ streaming: false, streamingMessageId: null });
    rerender(
      <ThemeProvider>
        <ChatView {...baseProps} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText("已暂停(会话上下文已保留)")).toBeInTheDocument());
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "恢复并继续" }));
    });
    expect(baseProps.onSend).toHaveBeenCalledWith("请继续。");
    await waitFor(() =>
      expect(screen.queryByText("已暂停(会话上下文已保留)")).toBeNull(),
    );
  });

  it("one-shot 子代理进入只读历史视图", () => {
    storeState = {
      ...storeState,
      sessionId: "child-1",
      messages: [{ id: "u1", role: "user", complete: true, parts: [{ kind: "text", text: "历史" }] }],
    };
    rendererSessionSnapshot.current = "child-1";
    rendererSessionSnapshot.currentAddress = {
      parentSessionId: "s1",
      childSessionId: "child-1",
      mode: "one-shot",
    };

    renderChat();
    // R4.2 mounts a StatusIndicator (role="status") for the live region;
    // disambiguate by text content rather than counting role matches.
    const banners = screen.getAllByRole("status").filter((el) =>
      el.textContent?.includes("单次子代理仅支持查看历史记录"),
    );
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent("单次子代理仅支持查看历史记录");
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.queryByText("回溯")).toBeNull();
  });

  it("catalog 标记 one-shot 时，即使 route 尚未发布也保持只读", () => {
    storeState = { ...storeState, sessionId: "child-1" };
    rendererSessionSnapshot.currentAddress = undefined;
    rendererSessionSnapshot.subagentsByParent = {
      "parent-1": {
        parentAvailable: true,
        entries: [{ kind: "child", id: "child-1", activity: "inactive", hasChildren: false, mode: "one-shot" }],
      },
    };

    renderChat();
    expect(screen.getByText("单次子代理仅支持查看历史记录")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
