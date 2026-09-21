import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProviderUndo } from "../hooks/useProviderUndo";
import type { AiActionReceipt } from "../types";

describe("useProviderUndo", () => {
  describe("Gmail API", () => {
    it("undoes archive by adding INBACK label", async () => {
      const gmailModifyLabels = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "gmail-api", gmailModifyLabels },
      }));
      const receipts: AiActionReceipt[] = [
        { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
      ];
      await result.current.undo(receipts);
      expect(gmailModifyLabels).toHaveBeenCalledWith("t1", ["INBOX"], []);
      expect(result.current.supportsUndo).toBe(true);
    });

    it("undoes mark-read by adding UNREAD label", async () => {
      const gmailModifyLabels = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "gmail-api", gmailModifyLabels },
      }));
      await result.current.undo([
        { actionId: "a1", threadId: "t1", kind: "mark-read", status: "executed" },
      ]);
      expect(gmailModifyLabels).toHaveBeenCalledWith("t1", ["UNREAD"], []);
    });

    it("undoes label add by removing the label", async () => {
      const gmailModifyLabels = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "gmail-api", gmailModifyLabels },
      }));
      await result.current.undo([
        { actionId: "a1", threadId: "t1", kind: "label", status: "executed", label: "important" } as AiActionReceipt,
      ]);
      expect(gmailModifyLabels).toHaveBeenCalledWith("t1", [], ["important"]);
    });

    it("skips failed receipts", async () => {
      const gmailModifyLabels = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "gmail-api", gmailModifyLabels },
      }));
      await result.current.undo([
        { actionId: "a1", threadId: "t1", kind: "archive", status: "failed" },
      ]);
      expect(gmailModifyLabels).not.toHaveBeenCalled();
    });

    it("swallows per-receipt errors", async () => {
      const gmailModifyLabels = vi.fn()
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "gmail-api", gmailModifyLabels },
      }));
      await expect(
        result.current.undo([
          { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
          { actionId: "a2", threadId: "t2", kind: "mark-read", status: "executed" },
        ])
      ).resolves.toBeUndefined();
      expect(gmailModifyLabels).toHaveBeenCalledTimes(2);
    });
  });

  describe("Microsoft Graph", () => {
    it("undoes archive via graphMoveThread", async () => {
      const graphMoveThread = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "graph-api", graphMoveThread },
      }));
      await result.current.undo([
        { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
      ]);
      expect(graphMoveThread).toHaveBeenCalledWith("t1", "inbox");
    });

    it("undoes mark-read via graphMarkUnread", async () => {
      const graphMarkUnread = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "graph-api", graphMarkUnread },
      }));
      await result.current.undo([
        { actionId: "a1", threadId: "t1", kind: "mark-read", status: "executed" },
      ]);
      expect(graphMarkUnread).toHaveBeenCalledWith("t1");
    });
  });

  describe("Generic updateThread", () => {
    it("undoes archive via 'restore' kind", async () => {
      const updateThread = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "unknown", updateThread },
      }));
      await result.current.undo([
        { actionId: "a1", threadId: "t1", kind: "archive", status: "executed" },
      ]);
      expect(updateThread).toHaveBeenCalledWith({
        accountId: "self", threadId: "t1", kind: "restore",
      });
    });

    it("undoes mark-read via 'mark-unread'", async () => {
      const updateThread = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "unknown", updateThread },
      }));
      await result.current.undo([
        { actionId: "a1", threadId: "t1", kind: "mark-read", status: "executed" },
      ]);
      expect(updateThread).toHaveBeenCalledWith({
        accountId: "self", threadId: "t1", kind: "mark-unread",
      });
    });
  });

  describe("supportsUndo", () => {
    it("returns false when no binding provided", () => {
      const { result } = renderHook(() => useProviderUndo({ bindings: { provider: "unknown" } }));
      expect(result.current.supportsUndo).toBe(false);
    });

    it("returns true when Gmail modifyLabels available", () => {
      const { result } = renderHook(() => useProviderUndo({
        bindings: { provider: "gmail-api", gmailModifyLabels: vi.fn() },
      }));
      expect(result.current.supportsUndo).toBe(true);
    });
  });
});
