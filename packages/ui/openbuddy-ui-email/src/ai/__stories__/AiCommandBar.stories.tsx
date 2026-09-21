/**
 * AiCommandBar stories — Cmd+K natural-language prompt entry.
 * States: closed (no-op), open + idle, open + recent, busy.
 */
import type { Meta, StoryObj } from "../story-runtime";
import { AiCommandBar } from "../components/AiCommandBar";

const meta: Meta<Parameters<typeof AiCommandBar>[0]> = {
  title: "Email AI/AiCommandBar",
  component: AiCommandBar,

  args: {
    open: true,
    onClose: () => undefined,
    onSubmit: () => undefined,
  },
};

type Story = StoryObj;

export const OpenAndIdle: Story = {};

export const OpenWithRecentPrompts: Story = {
  args: {
    recentPrompts: [
      { id: "p1", prompt: "归档所有 GitHub 通知", ranAt: "2026-09-21T08:00:00Z" },
      { id: "p2", prompt: "总结本周 inbox", ranAt: "2026-09-20T17:00:00Z" },
    ],
  },
};

export const Busy: Story = { args: { busy: true } };

export const Closed: Story = { args: { open: false } };

export default meta;
