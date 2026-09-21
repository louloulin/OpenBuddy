/**
 * ReceiptToast stories — 4 receipts tones.
 */
import type { Meta, StoryObj } from "../story-runtime";
import { ReceiptToast } from "../components/ReceiptToast";
import type { AiActionReceipt, UndoEntry } from "../types";

const meta: Meta<Parameters<typeof ReceiptToast>[0]> = {
  title: "Email AI/ReceiptToast",
  component: ReceiptToast,
  args: {
    receipts: [],
    undoEntry: null,
    onUndo: () => undefined,
    onDismiss: () => undefined,
  },
};

type Story = StoryObj;

const successReceipts: AiActionReceipt[] = [
  { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
  { actionId: "a2", threadId: "t2", kind: "mark-read", status: "executed" },
];

const partialReceipts: AiActionReceipt[] = [
  ...successReceipts,
  { actionId: "a3", threadId: "t3", kind: "label", status: "failed", reason: "Gmail 限流" },
];

const failedReceipts: AiActionReceipt[] = [
  { actionId: "a1", threadId: "t1", kind: "archive", status: "failed", reason: "Network error" },
];

export const AllSuccess: Story = {
  args: {
    receipts: successReceipts,
    undoEntry: {
      id: "u1",
      planId: "p1",
      receipts: successReceipts,
      createdAt: Date.now() - 3_000,
      undo: async () => undefined,
    } satisfies UndoEntry,
  },
};

export const PartialFailure: Story = {
  args: {
    receipts: partialReceipts,
    undoEntry: {
      id: "u2",
      planId: "p2",
      receipts: partialReceipts,
      createdAt: Date.now() - 1_000,
      undo: async () => undefined,
    } satisfies UndoEntry,
  },
};

export const AllFailed: Story = {
  args: {
    receipts: failedReceipts,
  },
};

export const Empty: Story = {};

export default meta;
