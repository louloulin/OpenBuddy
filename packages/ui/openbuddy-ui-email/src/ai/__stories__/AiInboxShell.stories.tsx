/**
 * AiInboxShell stories — the unified 3-mode 3-section inbox.
 * Visual reference for Shortwave / Superhuman layout.
 */
import type { Meta, StoryObj } from "../story-runtime";
import { AiInboxShell } from "../components/AiInboxShell";
import { makeSampleRuntime, sampleAccounts, sampleCounts, sampleThreads } from "./fixtures";

const meta: Meta<Parameters<typeof AiInboxShell>[0]> = {
  title: "Email AI/AiInboxShell",
  component: AiInboxShell,

  args: {
    accounts: sampleAccounts,
    accountId: "a1",
    threads: sampleThreads,
    runtime: makeSampleRuntime(),
    counts: sampleCounts,
    selectedThreadId: "t1",
    onSelectAccount: () => undefined,
    onSelectThread: () => undefined,
    onOpenComposer: () => undefined,
    onReceipt: () => undefined,
  },
};

type Story = StoryObj;

export const Default: Story = {};

export const EmptyInbox: Story = {
  args: {
    threads: [],
    counts: { ...sampleCounts, today: 0, later: 0, inbox: 0 },
    selectedThreadId: null,
  },
};

export const ManyMultiSelectable: Story = {
  args: {
    threads: [
      ...sampleThreads,
      {
        id: "t4",
        accountId: "a1",
        subject: "Weekly digest · LessWrong",
        from: { name: "LessWrong", address: "no-reply@lesswrong.com" },
        date: "2026-09-21T07:00:00Z",
        snippet: "Top posts this week…",
        unread: false,
        messageCount: 1,
        labels: ["CATEGORY_UPDATES"],
        aiChips: ["muted"] as Array<"priority" | "reply" | "action" | "muted">,
      },
      {
        id: "t5",
        accountId: "a1",
        subject: "Compose auto-save 提案",
        from: { name: "Alice", address: "alice@openbuddy.ai" },
        date: "2026-09-21T09:30:00Z",
        snippet: "我已经把初稿放在 PR,等大家 review。",
        unread: true,
        messageCount: 2,
        labels: ["INBOX"],
        aiChips: ["reply"] as Array<"priority" | "reply" | "action" | "muted">,
      },
    ],
  },
};

export default meta;
