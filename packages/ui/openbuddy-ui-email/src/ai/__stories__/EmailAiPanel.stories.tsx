/**
 * EmailAiPanel stories — the slot-registered wrapper for AiInboxShell.
 * Includes its own data-fetching layer via useEmailData.
 */
import type { Meta, StoryObj } from "../story-runtime";
import { EmailAiPanel } from "../components/EmailAiPanel";
import { makeSampleRuntime, sampleAccounts, sampleCounts, sampleThreads } from "./fixtures";

const meta: Meta<Parameters<typeof EmailAiPanel>[0]> = {
  title: "Email AI/EmailAiPanel",
  component: EmailAiPanel,

  args: {
    accounts: sampleAccounts,
    threads: sampleThreads,
    counts: sampleCounts,
    runtime: makeSampleRuntime(),
    onOpenComposer: () => undefined,
  },
};

type Story = StoryObj;

export const Default: Story = {};
export const NoSelection: Story = { args: { selectedThreadId: null } };
export const WithToast: Story = {
  args: { onToast: (msg: string) => console.log("toast:", msg) },
};

export default meta;
