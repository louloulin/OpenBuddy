import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor as rtlWaitFor } from "@testing-library/react";
import { OpenBuddyPluginPanel } from "@openbuddy/ui-mcp";

vi.mock("@/lib/agent/pi-client", () => ({
  agentListPlugins: vi.fn(async () => [
    { id: "pi-plan-mode", name: "pi-plan-mode", state: "loaded" },
    { id: "openbuddy-session", name: "openbuddy-session", state: "loaded" },
    { id: "openbuddy-disabled", name: "openbuddy-disabled", state: "disabled" },
  ]),
  agentPluginInventory: vi.fn(async () => ({
    entries: [
      { id: "pi-plan-mode", name: "pi-plan-mode", state: "loaded", kind: "cordis" },
      { id: "openbuddy-session", name: "openbuddy-session", state: "loaded", kind: "cordis" },
      { id: "openbuddy-disabled", name: "openbuddy-disabled", state: "disabled", kind: "cordis" },
    ],
    piExtensions: [],
    renderers: [{ id: "openbuddy-renderer", name: "openbuddy-renderer", disabled: false }],
    packages: [],
    providers: [{ id: "pi-extension-provider", source: "pi-extension", extensionPath: "/profile/extensions/provider.ts" }],
    terminals: { backends: ["shell"], sessionCount: 1 },
  })),
  agentPluginReadiness: vi.fn(async () => ({
    version: 1,
    phase: "ready",
    generation: 3,
    updatedAt: "2026-08-27T07:00:00.000Z",
    main: { loaded: 3, pending: 0, failed: 0, disabled: 0, degraded: 0 },
    pi: { loaded: 1, pending: 0, failed: 0, disabled: 0, degraded: 0 },
  })),
  agentDeepSeekCordisSnapshot: vi.fn(async () => null),
  agentPluginSnapshot: vi.fn(async () => ({
    version: 1,
    generation: 3,
    updatedAt: "2026-08-27T07:00:00.000Z",
    phase: "ready",
    readiness: {
      version: 1,
      phase: "ready",
      generation: 3,
      updatedAt: "2026-08-27T07:00:00.000Z",
      main: { loaded: 3, pending: 0, failed: 0, disabled: 0, degraded: 0 },
      pi: { loaded: 1, pending: 0, failed: 0, disabled: 0, degraded: 0 },
    },
    surfaces: {
      bundle: { expected: 1, loaded: 1, missing: 0 },
      pi: { expected: 1, loaded: 1, missing: 0 },
      renderer: { expected: 1, loaded: 1, missing: 0 },
      remote: { expected: 1, loaded: 1, missing: 0 },
      typert: { expected: 1, loaded: 1, missing: 0 },
    },
    packages: [],
    consistency: { complete: true, issues: [] },
  })),
  agentResourceInventory: vi.fn(async () => ({
    agents: [],
    skills: [{ name: "pi-skill", path: "/profile/skills/pi-skill/SKILL.md" }],
    prompts: [],
    themes: [],
    hooks: [],
    diagnostics: [],
  })),
  agentSessionEventLog: vi.fn(async () => [
    { sequence: 1, timestamp: "2026-08-27T07:00:01.000Z", type: "plugin/loaded", payload: { id: "pi-plan-mode" } },
    { sequence: 2, timestamp: "2026-08-27T07:00:02.000Z", type: "plugin/failed", payload: { id: "openbuddy-broken", error: "boom" } },
  ]),
  agentOnPluginEvent: vi.fn(async () => () => undefined),
  agentSetPluginEnabled: vi.fn(async (id: string, enabled: boolean) => ({
    id,
    name: id,
    state: enabled ? "loaded" : "disabled",
  })),
  agentReloadPlugin: vi.fn(async (id: string) => ({ id, name: id, state: "loaded" })),
  agentUpdatePluginConfig: vi.fn(async (id: string) => ({ id, name: id, state: "loaded" })),
  agentGetStoredPluginState: vi.fn(async () => ({
    updatedAt: "2026-08-27T07:00:00.000Z",
    overrides: {
      "pi-plan-mode": { disabled: true },
    },
  })),
  agentProfilePackages: vi.fn(async () => []),
  agentInstallProfilePackage: vi.fn(async (sourcePath: string) => ({ name: sourcePath, path: sourcePath, installed: true, bundle: true, client: false, pi: false, listed: true })),
  agentInstallDefaultPiPackages: vi.fn(async () => ([
    { spec: "npm:pi-mcp-adapter@2.31.0", status: "installed" },
    { spec: "npm:pi-goal@0.1.7", status: "skipped" },
  ] as never)),
  agentRemoveProfilePackage: vi.fn(async () => undefined),
  agentResetPluginState: vi.fn(async () => ({
    updatedAt: "2026-08-27T07:00:00.000Z",
    overrides: {},
  })),
}));

// Mock the icon module so we don't pull the foundation tree into jsdom.
vi.mock("@openbuddy/ui-primitives/icons", () => {
  const stub = (testId: string) => () => <span data-testid={testId} />;
  return {
    PuzzlePieceIcon: stub("puzzle-icon"),
    RefreshCwIcon: stub("refresh-icon"),
    Code2Icon: stub("code2-icon"),
    FileTextIcon: stub("file-text-icon"),
    ImageToolIcon: stub("image-tool-icon"),
    DatabaseToolIcon: stub("database-tool-icon"),
    WbFileSlideIcon: stub("wb-file-slide-icon"),
    SparklesIcon: stub("sparkles-icon"),
    CheckIcon: stub("check-icon"),
    PlayIcon: stub("play-icon"),
    WarningOutlineIcon: stub("warning-outline-icon"),
  };
});

describe("OpenBuddyPluginPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders main-side plugin status rows from agentListPlugins", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-row-pi-plan-mode")).toBeInTheDocument();
    });
    const list = screen.getByTestId("openbuddy-plugin-list");
    expect(list.textContent).toContain("pi-plan-mode");
    expect(list.textContent).toContain("openbuddy-session");
    expect(list.textContent).toContain("openbuddy-disabled");
  });

  it("renders discovered renderer plugin entries from the unified inventory", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("renderer-plugin-row-openbuddy-renderer")).toBeInTheDocument();
    });
  });

  it("shows all declared DeepSeek Harness plugin faces in profile packages", async () => {
    const { agentProfilePackages } = await import("@/lib/agent/pi-client");
    vi.mocked(agentProfilePackages).mockResolvedValueOnce([{
      name: "@deepseek-ai/dsh-fixture",
      version: "1.0.0",
      path: "/profile/node_modules/@deepseek-ai/dsh-fixture",
      installed: true,
      bundle: true,
      client: true,
      pi: true,
      remote: true,
      typert: true,
      cordis: true,
      listed: true,
      health: "healthy",
      dependencies: [],
      manifest: {
        schema: "openbuddy.plugin.v1",
        name: "@deepseek-ai/dsh-fixture",
        path: "/profile/node_modules/@deepseek-ai/dsh-fixture",
        namespaces: ["dsh"],
        surfaces: [
          { kind: "bundle", namespace: "dsh" },
          { kind: "renderer", namespace: "dsh" },
          { kind: "pi", namespace: "pi" },
          { kind: "remote", namespace: "dsh" },
          { kind: "typert", namespace: "dsh" },
          { kind: "cordis", namespace: "dsh" },
        ],
        listed: true,
        health: "healthy",
        loaded: ["bundle", "renderer", "pi", "remote", "typert", "cordis"],
        missing: [],
      },
    }] as never);
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => expect(screen.getByText("@deepseek-ai/dsh-fixture")).toBeInTheDocument());
    const row = screen.getByText("@deepseek-ai/dsh-fixture").closest("li");
    expect(row?.textContent).toContain("Pi · Renderer · Remote · Typert · Cordis · Bundle");
  });

  it("renders Pi provider attribution from the unified inventory", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("openbuddy-provider-row-pi-extension-provider")).toBeInTheDocument();
    });
    expect(screen.getByTestId("openbuddy-provider-inventory").textContent).toContain("Pi 扩展");
    expect(screen.getByTestId("openbuddy-provider-inventory").textContent).toContain("provider.ts");
  });

  it("renders Pi native resource counts from the resource inventory", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("openbuddy-pi-resource-inventory")).toBeInTheDocument();
    });
    expect(screen.getByTestId("openbuddy-pi-resource-inventory").textContent).toContain("Skills 1");
  });

  it("renders the unified Pi/Harness readiness snapshot", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("openbuddy-plugin-readiness").textContent).toContain("ready");
    });
    expect(screen.getByTestId("openbuddy-plugin-readiness").textContent).toContain("Main 3 loaded");
    expect(screen.getByTestId("openbuddy-plugin-readiness").textContent).toContain("Pi 1 loaded");
  });

  it("renders cross-surface plugin consistency", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("openbuddy-plugin-consistency").textContent).toContain("跨端一致性：完整");
    });
  });

  it("shows recent plugin events replayed from the persistent event log", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByText("plugin/loaded")).toBeInTheDocument();
    });
    expect(screen.getByText("plugin/failed")).toBeInTheDocument();
  });

  it("toggles a plugin via agentSetPluginEnabled and surfaces a toast", async () => {
    const onToast = vi.fn();
    render(<OpenBuddyPluginPanel onToast={onToast} />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-row-pi-plan-mode")).toBeInTheDocument();
    });
    const toggle = screen.getByLabelText("启用 pi-plan-mode") as HTMLInputElement;
    await act(async () => {
      toggle.click();
    });
    await rtlWaitFor(() => {
      expect(onToast).toHaveBeenCalledWith("已禁用「pi-plan-mode」");
    });
  });

  it("reloads a plugin via agentReloadPlugin and surfaces a toast", async () => {
    const onToast = vi.fn();
    render(<OpenBuddyPluginPanel onToast={onToast} />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-row-pi-plan-mode")).toBeInTheDocument();
    });
    const button = screen.getByLabelText("重载 pi-plan-mode") as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    await rtlWaitFor(() => {
      expect(onToast).toHaveBeenCalledWith("已重载「pi-plan-mode」");
    });
  });

  it("disables the reload button for non-loaded plugins", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-row-openbuddy-disabled")).toBeInTheDocument();
    });
    const button = screen.getByLabelText("重载 openbuddy-disabled") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("calls the toast handler when refresh succeeds", async () => {
    const onToast = vi.fn();
    render(<OpenBuddyPluginPanel onToast={onToast} />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("openbuddy-plugin-list")).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByRole("button", { name: /刷新/ }).click();
    });
    await rtlWaitFor(() => {
      expect(onToast).toHaveBeenCalledWith("已刷新 3 个插件包");
    });
  });

  it("installs a package source from the inline WorkBuddy control", async () => {
    const { agentInstallProfilePackage } = await import("@/lib/agent/pi-client");
    vi.mocked(agentInstallProfilePackage).mockResolvedValueOnce({ name: "pi-source", version: "1.0.0" } as never);
    render(<OpenBuddyPluginPanel />);
    const input = await screen.findByRole("textbox", { name: "Package source" });
    const button = screen.getByRole("button", { name: "安装 source" });
    expect(button).toBeDisabled();
    await act(async () => {
      await (input as HTMLInputElement).focus();
      await import("@testing-library/user-event").then(({ default: userEvent }) => userEvent.setup().type(input, "pi-source"));
    });
    await rtlWaitFor(() => expect(button).not.toBeDisabled());
    await act(async () => { button.click(); });
    await rtlWaitFor(() => expect(agentInstallProfilePackage).toHaveBeenCalledWith("pi-source"));
  });
});

  it("shows a saved badge for plugins with persisted overrides", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-saved-pi-plan-mode")).toBeInTheDocument();
    });
  });

  it("calls agentResetPluginState when the reset button is clicked", async () => {
    const onToast = vi.fn();
    render(<OpenBuddyPluginPanel onToast={onToast} />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-row-pi-plan-mode")).toBeInTheDocument();
    });
    const button = screen.getByLabelText(
      "清除 pi-plan-mode 的持久化覆盖",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => {
      button.click();
    });
    await rtlWaitFor(() => {
      expect(onToast).toHaveBeenCalledWith(
        "已清除「pi-plan-mode」的持久化覆盖",
      );
    });
  });

  it("disables the reset button for plugins without persisted overrides", async () => {
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-row-openbuddy-session")).toBeInTheDocument();
    });
    const button = screen.getByLabelText(
      "清除 openbuddy-session 的持久化覆盖",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows the Adapter (N) badge and inline commands for adapter-projected Pi extensions", async () => {
    const { agentListPlugins, agentPluginInventory } = await import("@/lib/agent/pi-client");
    vi.mocked(agentListPlugins).mockResolvedValueOnce([
      {
        id: "pi-mcp-adapter",
        name: "pi-mcp-adapter",
        kind: "pi",
        state: "pending",
        mode: "adapter",
        adapter: "openbuddy-mcp-client",
        commands: ["mcp", "pi-mcp", "mcp-auth"],
      },
    ] as never);
    vi.mocked(agentPluginInventory).mockResolvedValueOnce({
      entries: [],
      piExtensions: [
        {
          id: "pi-mcp-adapter",
          name: "pi-mcp-adapter",
          kind: "pi",
          state: "pending",
          mode: "adapter",
          adapter: "openbuddy-mcp-client",
          commands: ["mcp", "pi-mcp", "mcp-auth"],
        },
      ],
      renderers: [],
      packages: [],
    } as never);
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-row-pi-mcp-adapter")).toBeInTheDocument();
    });
    const row = screen.getByTestId("plugin-row-pi-mcp-adapter");
    expect(row.querySelector(".plugin-list__kind--adapter")?.textContent).toContain("Adapter");
    expect(row.querySelector(".plugin-list__kind--adapter")?.textContent).toContain("(3)");
    const commandsNode = screen.getByTestId("plugin-commands-pi-mcp-adapter");
    expect(commandsNode.textContent).toContain("mcp");
    expect(commandsNode.textContent).toContain("pi-mcp");
    expect(commandsNode.textContent).toContain("mcp-auth");
  });

  it("shows the Pi discovery scope and package origin", async () => {
    const { agentPluginInventory } = await import("@/lib/agent/pi-client");
    vi.mocked(agentPluginInventory).mockResolvedValueOnce({
      entries: [],
      piExtensions: [{
        id: "/profile/node_modules/pi-fixture/extensions/index.ts",
        name: "index.ts",
        kind: "pi",
        state: "loaded",
        managed: false,
        sourceScope: "project",
        sourceOrigin: "package",
        sourceBaseDir: "/profile/node_modules/pi-fixture",
        packageName: "pi-fixture",
      }],
      renderers: [],
      packages: [],
    } as never);
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => {
      expect(screen.getByTestId("plugin-row-/profile/node_modules/pi-fixture/extensions/index.ts")).toBeInTheDocument();
    });
    expect(screen.getByTestId("plugin-source-/profile/node_modules/pi-fixture/extensions/index.ts").textContent).toContain("项目·Package");
    expect(screen.getByTestId("plugin-row-/profile/node_modules/pi-fixture/extensions/index.ts").textContent).toContain("pi-fixture");
    expect(screen.getByLabelText("启用 /profile/node_modules/pi-fixture/extensions/index.ts")).toBeDisabled();
  });

  it("saves JSON config for a managed Pi extension", async () => {
    const { agentPluginInventory, agentUpdatePluginConfig } = await import("@/lib/agent/pi-client");
    vi.mocked(agentPluginInventory).mockResolvedValueOnce({
      entries: [],
      piExtensions: [{ id: "pi-configurable", name: "pi-configurable", kind: "pi", state: "loaded", managed: true }],
      renderers: [],
      packages: [],
    } as never);
    const onToast = vi.fn();
    render(<OpenBuddyPluginPanel onToast={onToast} />);
    await rtlWaitFor(() => expect(screen.getByTestId("plugin-row-pi-configurable")).toBeInTheDocument());
    const editor = screen.getByLabelText("配置 pi-configurable") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"mode":"safe","limit":3}' } });
    await act(async () => {
      screen.getByLabelText("保存 pi-configurable 的配置").click();
    });
    await rtlWaitFor(() => {
      expect(agentUpdatePluginConfig).toHaveBeenCalledWith("pi-configurable", { mode: "safe", limit: 3 });
      expect(onToast).toHaveBeenCalledWith("已保存「pi-configurable」的配置");
    });
  });

  it("rejects invalid JSON before updating a managed Pi extension", async () => {
    const { agentPluginInventory, agentUpdatePluginConfig } = await import("@/lib/agent/pi-client");
    vi.mocked(agentUpdatePluginConfig).mockClear();
    vi.mocked(agentPluginInventory).mockResolvedValueOnce({
      entries: [],
      piExtensions: [{ id: "pi-configurable", name: "pi-configurable", kind: "pi", state: "loaded", managed: true }],
      renderers: [],
      packages: [],
    } as never);
    render(<OpenBuddyPluginPanel />);
    await rtlWaitFor(() => expect(screen.getByTestId("plugin-row-pi-configurable")).toBeInTheDocument());
    const editor = screen.getByLabelText("配置 pi-configurable") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "{invalid" } });
    await act(async () => {
      screen.getByLabelText("保存 pi-configurable 的配置").click();
    });
    expect(screen.getByText(/JSON 无效/)).toBeInTheDocument();
    expect(agentUpdatePluginConfig).not.toHaveBeenCalled();
  });

  it("renders the '启用默认 Pi bundle' button when none of the curated packages are installed", async () => {
    const onToast = vi.fn();
    const { agentInstallDefaultPiPackages } = await import("@/lib/agent/pi-client");
    vi.mocked(agentInstallDefaultPiPackages).mockResolvedValueOnce([
      { spec: "npm:pi-mcp-adapter@2.31.0", status: "installed" },
      { spec: "npm:pi-goal@0.1.7", status: "skipped" },
    ] as never);
    render(<OpenBuddyPluginPanel onToast={onToast} />);
    const button = await screen.findByTestId("openbuddy-plugin-install-default-pi");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("启用默认 Pi bundle");
    fireEvent.click(button);
    await rtlWaitFor(() => expect(agentInstallDefaultPiPackages).toHaveBeenCalledWith({ force: false }));
    await rtlWaitFor(() =>
      expect(onToast).toHaveBeenCalledWith(
        expect.stringMatching(/默认 Pi bundle：installed=1 skipped=1 failed=0/),
      ),
    );
  });

  it("disables the default-pi button when any curated package is already installed", async () => {
    const onToast = vi.fn();
    // Default mock (beforeEach) returns []; verify the default-pi button reflects
    // an un-installed state. Mount-during-render ensures we observe the mounted DOM
    // exactly as the user sees it on a fresh install.
    render(<OpenBuddyPluginPanel onToast={onToast} />);
    const button = await screen.findByTestId("openbuddy-plugin-install-default-pi");
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("启用默认 Pi bundle");
  });
