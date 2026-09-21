/**
 * AiSummaryCard stories — idle / loading / error / ready.
 */
import type { Meta, StoryObj } from "../story-runtime";
import { AiSummaryCard } from "../components/AiSummaryCard";
import { phaseError, phaseIdle, phaseLoading, phaseReady } from "../types";
import { sampleSummary } from "./fixtures";

const meta: Meta<Parameters<typeof AiSummaryCard>[0]> = {
  title: "Email AI/AiSummaryCard",
  component: AiSummaryCard,

  args: {
    threadId: "t1",
    summary: phaseIdle(),
    onEnsure: async (threadId: string) => ({ ...sampleSummary, threadId }),
    onAction: () => undefined,
  },
};

type Story = StoryObj;

export const Idle: Story = {};

export const Loading: Story = { args: { summary: phaseLoading() } };

export const Ready: Story = { args: { summary: phaseReady(sampleSummary) } };

export const Error: Story = {
  args: { summary: phaseError("AI 服务暂时不可用"), onRetry: () => undefined },
};

export default meta;
