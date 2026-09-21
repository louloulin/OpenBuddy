/**
 * MailStatusBar stories — bottom strip with shortcuts + AI status.
 */
import type { Meta, StoryObj } from "../story-runtime";
import { MailStatusBar } from "../components/MailStatusBar";

const meta: Meta = {
  title: "Email AI/MailStatusBar",
  component: MailStatusBar,
  args: {
    aiStatus: "AI 待命",
    threadCount: 17,
    onShowHelp: () => undefined,
  },
};

type Story = StoryObj;

export const Idle: Story = {};

export const Planning: Story = {
  args: { aiStatus: "AI 正在规划…", pendingPlanCount: 1 },
};

export const Executing: Story = {
  args: { aiStatus: "正在执行…", pendingPlanCount: 1 },
};

export const UndoAvailable: Story = {
  args: { aiStatus: "已执行 · 可撤销", undoSecondsRemaining: 27, pendingPlanCount: 0 },
};

export const SummaryReady: Story = {
  args: { aiStatus: "AI 摘要已生成", threadCount: 1 },
};

export default meta;
