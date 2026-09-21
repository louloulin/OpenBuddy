/**
 * useProviderUndo — Provider 特定撤销实现。
 *
 * 设计目标:把 capability-email 的"已执行 receipt"反演成 provider-specific
 * mutation 调用,使 ReceiptToast 的 30s 撤销按钮真正生效。
 *
 * Provider 矩阵:
 *   - Gmail API:
 *       archive    → modifyThreadLabels "INBOX remove" 或 un-archive(没有 API)
 *                    实际:archive 是 Gmail 里的 "archive" label 移除;撤销 = 重新加 INBOX label
 *       mark-read  → 撤销 = mark-unread(只是反转)
 *       snooze     → 撤销 = 清掉自定义 snooze label(无内置)
 *       label      → 撤销 = remove label
 *   - Microsoft Graph:
 *       archive    → move to Inbox
 *       mark-read  → mark-unread
 *       snooze     → 取消 snooze(自定义 API)
 *       label      → remove category
 *
 * 默认实现(no provider capability)→ 返回 noop;UI 不显示撤销按钮。
 */
import { useCallback, useMemo } from "react";
import type { AiActionReceipt } from "../types";

export interface UndoBindings {
  provider: "gmail-api" | "graph-api" | "jmap-api" | "mcp" | "unknown";
  /** Gmail: modifyThreadLabels(threadId, add: string[], remove: string[]) */
  gmailModifyLabels?(threadId: string, add: string[], remove: string[]): Promise<unknown>;
  /** Graph: moveThread(threadId, destinationFolderId) */
  graphMoveThread?(threadId: string, folderId: string): Promise<unknown>;
  graphMarkUnread?(threadId: string): Promise<unknown>;
  graphRemoveCategory?(threadId: string, categoryId: string): Promise<unknown>;
  /** 通用 updateThread kind 反演 — 必须由调用方在 UpdateInput 里支持 'restore'。 */
  updateThread?(input: {
    accountId: string;
    threadId: string;
    kind: "mark-unread" | "restore" | "label-remove";
    labelId?: string;
  }): Promise<unknown>;
}

export interface UseProviderUndoArgs {
  bindings: UndoBindings;
  accountId?: string;
}

export interface UseProviderUndoResult {
  /** 撤销一组 receipts(过滤掉非 executed)。 */
  undo: (receipts: AiActionReceipt[]) => Promise<void>;
  /** 该 provider 是否支持撤销 — false 时 UI 隐藏撤销按钮。 */
  supportsUndo: boolean;
}

export function useProviderUndo({ bindings, accountId = "self" }: UseProviderUndoArgs): UseProviderUndoResult {
  const supportsUndo = useMemo(() => {
    return Boolean(
      bindings.provider === "gmail-api" && bindings.gmailModifyLabels ||
      bindings.provider === "graph-api" && (bindings.graphMoveThread || bindings.updateThread) ||
      bindings.updateThread,
    );
  }, [bindings]);

  const undo = useCallback(async (receipts: AiActionReceipt[]) => {
    for (const r of receipts) {
      if (r.status !== "executed") continue;
      try {
        switch (bindings.provider) {
          case "gmail-api":
            await undoGmail(r, bindings, accountId);
            break;
          case "graph-api":
            await undoGraph(r, bindings, accountId);
            break;
          default:
            if (bindings.updateThread) {
              await undoGeneric(r, bindings, accountId);
            }
        }
      } catch {
        // 单条撤销失败不影响其它。
      }
    }
  }, [bindings, accountId]);

  return { undo, supportsUndo };
}

async function undoGmail(r: AiActionReceipt, b: UndoBindings, accountId: string): Promise<void> {
  if (!b.gmailModifyLabels) return;
  switch (r.kind) {
    case "archive":
      // Gmail 的 archive 是从 INBOX 移除 — 撤销 = 加回 INBOX。
      await b.gmailModifyLabels(r.threadId, ["INBOX"], []);
      break;
    case "mark-read":
      // mark-read 是移除 UNREAD label;撤销 = 加回 UNREAD。
      await b.gmailModifyLabels(r.threadId, ["UNREAD"], []);
      break;
    case "label":
      // 撤销 label-add = 从 thread 移除该 label(简化:假设 UNLABELED;真实 ID 由调用方覆盖)。
      await b.gmailModifyLabels(r.threadId, [], [String((r as { label?: string }).label ?? "")]);
      break;
    case "snooze":
      // Gmail 没有原生 snooze — 一般用自定义 label;撤销 = 移除。
      await b.gmailModifyLabels(r.threadId, [], ["SNOOZED"]);
      break;
    default:
      // 其它动作类型不支持撤销。
      void accountId;
  }
}

async function undoGraph(r: AiActionReceipt, b: UndoBindings, accountId: string): Promise<void> {
  switch (r.kind) {
    case "archive":
      await b.graphMoveThread?.(r.threadId, "inbox");
      break;
    case "mark-read":
      await b.graphMarkUnread?.(r.threadId);
      break;
    case "label":
      await b.graphRemoveCategory?.(r.threadId, String((r as { label?: string }).label ?? ""));
      break;
    case "snooze":
      // Graph 没有原生 snooze;通常清掉 followup flag。
      await b.graphRemoveCategory?.(r.threadId, "SNOOZED");
      break;
    default:
      void accountId;
  }
}

async function undoGeneric(r: AiActionReceipt, b: UndoBindings, accountId: string): Promise<void> {
  if (!b.updateThread) return;
  switch (r.kind) {
    case "archive":
      await b.updateThread({ accountId, threadId: r.threadId, kind: "restore" });
      break;
    case "mark-read":
      await b.updateThread({ accountId, threadId: r.threadId, kind: "mark-unread" });
      break;
    case "label":
      await b.updateThread({
        accountId, threadId: r.threadId, kind: "label-remove",
        labelId: (r as { label?: string }).label,
      });
      break;
    default:
      // snooze / reply-draft / create-task — 默认 noop。
      break;
  }
}
