/**
 * AiActionPlanStrip stories — the 4-stage strip (idle / planning / plan-ready / executing / receipts).
 */
import type { Meta, StoryObj } from "../story-runtime";
import { AiActionPlanStrip } from "../components/AiActionPlanStrip";
import { phaseIdle, phaseLoading, phaseReady } from "../types";
import { sampleActions, sampleReceipts } from "./fixtures";

const meta: Meta<Parameters<typeof AiActionPlanStrip>[0]> = {
  title: "Email AI/AiActionPlanStrip",
  component: AiActionPlanStrip,

  args: {
    plan: null,
    decisions: {},
    planning: phaseIdle(),
    accepting: false,
    undoEntry: null,
    onAcceptPlan: () => undefined,
    onCancelPlan: () => undefined,
    onToggleDecision: () => undefined,
    onBulkDecide: () => undefined,
    onUndo: () => undefined,
    onDismissUndo: () => undefined,
  },
};

type Story = StoryObj;

export const Idle: Story = {};

export const Planning: Story = {
  args: { planning: phaseLoading(), plan: { id: "p1", prompt: "test", createdAt: new Date().toISOString(), phase: phaseIdle() } },
};

export const PlanReady: Story = {
  args: {
    plan: { id: "p1", prompt: "清理噪声", createdAt: new Date().toISOString(), phase: phaseIdle() },
    planning: phaseReady(sampleActions),
    decisions: Object.fromEntries(sampleActions.map((a) => [a.id, a.confidence > 0.7 ? "accepted" : "pending"])),
  },
};

export const Executing: Story = {
  args: {
    plan: { id: "p1", prompt: "清理噪声", createdAt: new Date().toISOString(), phase: phaseReady({ accepted: sampleActions, receipts: [] }) },
    accepting: true,
    planning: phaseReady([]),
  },
};

export const ReceiptsWithUndo: Story = {
  args: {
    plan: { id: "p1", prompt: "清理噪声", createdAt: new Date().toISOString(), phase: phaseReady({ accepted: sampleActions, receipts: sampleReceipts }) },
    planning: phaseReady([]),
    undoEntry: {
      id: "u1",
      planId: "p1",
      receipts: sampleReceipts,
      createdAt: Date.now() - 5_000,
      undo: async () => undefined,
    },
  },
};

export default meta;
