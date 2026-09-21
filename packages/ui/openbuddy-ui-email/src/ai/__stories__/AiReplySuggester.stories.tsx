/**
 * AiReplySuggester stories — 3-tone reply picker.
 */
import type { Meta, StoryObj } from "../story-runtime";
import { AiReplySuggester } from "../components/AiReplySuggester";
import { phaseError, phaseIdle, phaseLoading, phaseReady } from "../types";
import { sampleReplies } from "./fixtures";

const meta: Meta<Parameters<typeof AiReplySuggester>[0]> = {
  title: "Email AI/AiReplySuggester",
  component: AiReplySuggester,

  args: {
    threadId: "t1",
    suggestions: phaseIdle(),
    onEnsure: async (threadId: string) => sampleReplies.map((r) => ({ ...r, id: `${threadId}-${r.id}` })),
    onAdopt: () => undefined,
  },
};

type Story = StoryObj;

export const Idle: Story = {};

export const Loading: Story = { args: { suggestions: phaseLoading() } };

export const Ready: Story = { args: { suggestions: phaseReady(sampleReplies) } };

export const Error: Story = {
  args: { suggestions: phaseError("AI 回复生成失败"), onRetry: () => undefined },
};

export default meta;
