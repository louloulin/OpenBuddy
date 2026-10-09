/**
 * createEmailDataProvider — R92 修复的单元测试。
 *
 * 覆盖:
 *   - listAccounts:映射 EmailAccount → AiInboxAccount
 *   - listAccounts 失败时 fallback 到 defaultAccountId
 *   - listAccounts 返回空数组 → 返回空数组
 *   - listThreads:映射 EmailThreadPreview → AiInboxThread
 *   - listThreads 失败时返回 []
 *   - counts:启发式计数(并行拉 inbox / sent / drafts / snoozed)
 *   - counts 失败时返回 EMPTY_COUNTS
 *   - triage:EmailTriageSnapshot 转 Record<threadId, chips[]>
 *   - triage 失败时返回 {}
 *   - 注入的 mock client 完全覆盖默认 client
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmailDataProvider } from "../createEmailDataProvider";
import type {
  EmailAccount,
  EmailSearchInput,
  EmailThreadPreview,
  EmailTriageSnapshot,
} from "@/lib/agent/pi-client-email";

const ACCOUNTS: EmailAccount[] = [
  {
    id: "a1",
    address: "me@openbuddy.test",
    name: "Work",
    provider: "mcp",
    status: "connected",
    capabilities: { read: true, write: true, attachments: true, multipleAccounts: false },
  },
];

const THREADS: EmailThreadPreview[] = [
  {
    id: "t1",
    accountId: "a1",
    subject: "Q4 review",
    snippet: "please confirm",
    from: { name: "Lin", address: "lin@x.com" },
    date: "2026-09-21T09:00:00Z",
    messageCount: 2,
    unread: true,
    labels: ["inbox"],
  },
];

beforeEach(() => vi.restoreAllMocks());

describe("createEmailDataProvider", () => {
  describe("listAccounts", () => {
    it("maps EmailAccount → AiInboxAccount", async () => {
      const provider = createEmailDataProvider({
        client: { listAccounts: vi.fn().mockResolvedValue(ACCOUNTS) },
      });
      const accounts = await provider.listAccounts();
      expect(accounts).toEqual([
        { id: "a1", address: "me@openbuddy.test", name: "Work", status: "connected" },
      ]);
    });

    it("失败 + defaultAccountId → 返回 disconnected fallback", async () => {
      const provider = createEmailDataProvider({
        defaultAccountId: "self",
        client: { listAccounts: vi.fn().mockRejectedValue(new Error("boom")) },
      });
      const accounts = await provider.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toEqual({
        id: "self",
        address: "self@openbuddy.local",
        name: "self",
        status: "disconnected",
      });
    });

    it("空数组 → 返回空数组", async () => {
      const provider = createEmailDataProvider({
        client: { listAccounts: vi.fn().mockResolvedValue([]) },
      });
      expect(await provider.listAccounts()).toEqual([]);
    });
  });

  describe("listThreads", () => {
    it("maps EmailThreadPreview → AiInboxThread", async () => {
      const provider = createEmailDataProvider({
        client: { listThreads: vi.fn().mockResolvedValue(THREADS) },
      });
      const threads = await provider.listThreads({
        view: "today",
        folder: "inbox",
        accountId: "a1",
      });
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({
        id: "t1",
        accountId: "a1",
        subject: "Q4 review",
        from: { name: "Lin", address: "lin@x.com" },
        unread: true,
        messageCount: 2,
        labels: ["inbox"],
      });
    });

    it("filters 透传到 client", async () => {
      const listThreads = vi.fn().mockResolvedValue([]);
      const provider = createEmailDataProvider({ client: { listThreads } });
      await provider.listThreads({ view: "today", folder: "inbox", unreadOnly: true, accountId: "a2" });
      expect(listThreads).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: "a2", unread: true, folder: "inbox" }),
      );
    });

    it("失败 → 返回 []", async () => {
      const provider = createEmailDataProvider({
        client: { listThreads: vi.fn().mockRejectedValue(new Error("x")) },
      });
      expect(await provider.listThreads({ view: "today", folder: "inbox" })).toEqual([]);
    });

    it("client 返回非数组 → 返回 []", async () => {
      const provider = createEmailDataProvider({
        client: { listThreads: vi.fn().mockResolvedValue(null as unknown as EmailThreadPreview[]) },
      });
      expect(await provider.listThreads({ view: "today", folder: "inbox" })).toEqual([]);
    });
  });

  describe("counts", () => {
    it("并行 4 个 folder 数长度", async () => {
      const listThreads = vi.fn().mockImplementation((input?: EmailSearchInput) => {
        if (input?.folder === "inbox") return Promise.resolve(THREADS);
        if (input?.folder === "sent") return Promise.resolve(THREADS.slice(0, 1));
        if (input?.folder === "drafts") return Promise.resolve([]);
        if (input?.folder === "snoozed") return Promise.resolve(THREADS);
        return Promise.resolve([]);
      });
      const provider = createEmailDataProvider({ client: { listThreads } });
      const counts = await provider.counts();
      expect(counts).toEqual({
        today: 0,
        later: 0,
        done: 0,
        inbox: 1,
        drafts: 0,
        scheduled: 1,
        snoozed: 1,
      });
    });

    it("失败 → EMPTY_COUNTS(全 0)", async () => {
      const provider = createEmailDataProvider({
        client: { listThreads: vi.fn().mockRejectedValue(new Error("x")) },
      });
      expect(await provider.counts()).toEqual({
        today: 0,
        later: 0,
        done: 0,
        inbox: 0,
        drafts: 0,
        scheduled: 0,
        snoozed: 0,
      });
    });
  });

  describe("triage", () => {
    it("把 suggestion category 映射到 chip", async () => {
      const snapshot = {
        items: [
          { threadId: "t1", category: "priority", score: 0.9 },
          { threadId: "t2", category: "reply", score: 0.85 },
          { threadId: "t3", category: "action", score: 0.7 },
          { threadId: "t4", category: "noise", score: 0.95 },
          { threadId: "t5", category: "unknown-category" as never, score: 0.5 },
        ],
        total: 5,
        generatedAt: "2026-09-22T00:00:00.000Z",
        counts: { urgent: 0, "needs-reply": 0, "waiting-for-reply": 0, noise: 0, normal: 0 },
      };
      const provider = createEmailDataProvider({
        client: { triage: vi.fn().mockResolvedValue(snapshot) },
      });
      const chips = await provider.triage({ accountId: "a1" });
      expect(chips).toEqual({
        t1: ["priority"],
        t2: ["reply"],
        t3: ["action"],
        t4: ["muted"],
        t5: ["priority"], // unknown 兜底
      });
    });

    it("失败 → {}", async () => {
      const provider = createEmailDataProvider({
        client: { triage: vi.fn().mockRejectedValue(new Error("x")) },
      });
      expect(await provider.triage({})).toEqual({});
    });

    it("snapshot 无 suggestions → {}", async () => {
      const provider = createEmailDataProvider({
        client: { triage: vi.fn().mockResolvedValue({ items: [], total: 0, generatedAt: "", counts: { urgent: 0, "needs-reply": 0, "waiting-for-reply": 0, noise: 0, normal: 0 } }) },
      });
      expect(await provider.triage({})).toEqual({});
    });
  });

  describe("mock client 完全覆盖", () => {
    it("未注入的方法调用真实 client(由调用方传入覆盖)", async () => {
      const listAccounts = vi.fn().mockResolvedValue(ACCOUNTS);
      const listThreads = vi.fn().mockResolvedValue(THREADS);
      // 部分 mock:只注入 listAccounts
      const provider = createEmailDataProvider({
        client: { listAccounts },
      });
      // 未注入的 listThreads 会调用真实 client — 这里只验证 listAccounts mock 生效
      await provider.listAccounts();
      expect(listAccounts).toHaveBeenCalled();
    });
  });
});
