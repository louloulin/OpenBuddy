/**
 * 「策略设置」区块总线的接线测试 —— 真内核(SlotProvider),不是 mock。
 *
 * 要证的一条**插件化**链路:注册到 `settings.policy.section` 的区块,用户在
 * 策略设置面板里真的看得见;内置两块(Pi 扩展准入名单 / 插件策略审计)走的是
 * 同一条总线而不是写死在面板里;没有元数据的注册值被忽略;order 决定顺序。
 *
 * 用真 SlotProvider 的理由与 library-sections 一致:槽位"有 entries"和
 * "用户看得见"是两件事,只有渲染出来才算数。
 */
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SlotProvider, getOrCreateSingleton } from "@openbuddy/ui-runtime/client";
import { PolicySettingsPanel } from "../../PolicySettingsPanel";
import {
  POLICY_SECTION_IDS,
  definePolicySection,
  readPolicySectionMeta,
} from "../section-contract";
import { EXTENSION_POLICY_SECTIONS } from "../sections";

// 面板会调主进程读策略 / 读扩展名单;jsdom 里没有 bridge,直接替掉这两条通道,
// 让这个 spec 只测"装配"这一件事。
vi.mock("@/lib/platform/electron-api", () => ({
  invoke: vi.fn(() => Promise.resolve({ rules: [] })),
}));
vi.mock("@/lib/agent/pi-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/pi-client")>()),
  extensionPolicyGet: vi.fn(() =>
    Promise.resolve({ allowlistPackageNames: [], denylistPackageNames: [] }),
  ),
  extensionPolicySave: vi.fn(() =>
    Promise.resolve({ ok: true, policy: { allowlistPackageNames: [], denylistPackageNames: [] } }),
  ),
}));
vi.mock("@/hooks/useExtensionAuditPanel", () => ({
  useExtensionAuditPanel: () => ({
    reports: [],
    summary: {
      latest: null,
      reports: 0,
      totalAllowed: 0,
      totalDenied: 0,
      totalNeedsReview: 0,
      lastDecisionCount: 0,
    },
    clear: () => {},
  }),
}));

const disposers: Array<() => void> = [];

function contributeSection(id: string, Component: unknown) {
  const rt = getOrCreateSingleton();
  disposers.push(
    rt.slots.register(
      {
        name: "settings.policy.section",
        kind: "list",
        scope: "root",
        id,
        registrant: "test-plugin",
      },
      Component as never,
    ),
  );
}

function mount() {
  return render(
    <SlotProvider>
      <PolicySettingsPanel />
    </SlotProvider>,
  );
}

/** 面板里所有策略区块的 id,按 DOM 顺序 —— 断言的是**用户看到的**顺序。 */
function sectionIds(): string[] {
  return Array.from(document.querySelectorAll("[data-testid^='policy-section-']")).map((el) =>
    (el.getAttribute("data-testid") ?? "").replace("policy-section-", ""),
  );
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  cleanup();
});

describe("策略设置区块总线", () => {
  it("内置两块就是 POLICY_SECTION_IDS,且 order 递增", () => {
    const ids = EXTENSION_POLICY_SECTIONS.map((s) => s.policySection.id);
    expect(ids).toEqual([
      POLICY_SECTION_IDS.extensionPolicy,
      POLICY_SECTION_IDS.extensionAudit,
    ]);
    const orders = EXTENSION_POLICY_SECTIONS.map((s) => s.policySection.order ?? 0);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("definePolicySection 挂元数据,readPolicySectionMeta 才认;裸函数不认", () => {
    const good = definePolicySection({ id: "x", order: 1 }, () => null);
    expect(readPolicySectionMeta(good)?.id).toBe("x");
    expect(readPolicySectionMeta(() => null)).toBeNull();
    expect(readPolicySectionMeta({})).toBeNull();
  });

  it("内置两块由 apply() 注册进同一条总线,策略设置面板装配后即可见", async () => {
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("policy-panel")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId(`policy-section-${POLICY_SECTION_IDS.extensionPolicy}`),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId(`policy-section-${POLICY_SECTION_IDS.extensionAudit}`),
    ).toBeInTheDocument();
    // 内置的 4 个原生区块还在 —— 追加区块不是替换面板。
    expect(screen.getByText("模型白名单").textContent).toContain("模型白名单");
  });

  it("准入名单编辑器真的挂载(有 allow/deny 两个输入 + 保存按钮)", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("extension-policy-editor")).toBeInTheDocument());
    expect(screen.getByTestId("extension-policy-allowlist")).toBeInTheDocument();
    expect(screen.getByTestId("extension-policy-denylist")).toBeInTheDocument();
    expect(screen.getByTestId("extension-policy-save")).toBeInTheDocument();
    // 审计面板也在(空态:还没有策略报告)。
    expect(screen.getByTestId("extension-audit-panel")).toBeInTheDocument();
    expect(screen.getByTestId("extension-audit-empty")).toBeInTheDocument();
  });

  it("插件区块按 order 排在内置区块之前/之后,插件乱序注册也不影响", async () => {
    contributeSection(
      "late",
      definePolicySection({ id: "late", order: 900 }, () => (
        <div data-testid="policy-section-late">late</div>
      )),
    );
    contributeSection(
      "early",
      definePolicySection({ id: "early", order: 1 }, () => (
        <div data-testid="policy-section-early">early</div>
      )),
    );
    mount();
    await waitFor(() => expect(screen.getByTestId("policy-section-late")).toBeInTheDocument());
    const ids = sectionIds();
    expect(ids).toEqual([
      "early",
      POLICY_SECTION_IDS.extensionPolicy,
      POLICY_SECTION_IDS.extensionAudit,
      "late",
    ]);
  });

  it("没有元数据的注册值被忽略(不画一个没有 id 的野区块)", async () => {
    contributeSection("raw", () => <div data-testid="policy-section-raw">raw</div>);
    mount();
    await waitFor(() =>
      expect(
        screen.getByTestId(`policy-section-${POLICY_SECTION_IDS.extensionPolicy}`),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("policy-section-raw")).toBeNull();
  });
});
