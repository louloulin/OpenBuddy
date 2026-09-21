/**
 * useAiLoop — 通用乐观更新 + 撤销 hook。
 *
 * 设计:把"观察 → 计划 → 确认 → 执行 → 回执 → 撤销"封装成可复用的状态机,
 * 每个 AI 行动 plan 一次。
 *
 * 关键不变量:
 *   - receipts 永远在 promise resolve 后才更新 — UI 不会"乐观成功"导致撤销失败。
 *   - undo 30s 窗口 — 用 createdAt 校验。
 *   - 重入安全 — acceptPlan 在 in-flight 时拒绝。
 */
import { useCallback, useRef, useState } from "react";
import type {
  AiAction,
  AiActionDecision,
  AiActionPlan,
  AiActionReceipt,
  AsyncPhase,
  UndoEntry,
} from "../types";
import { phaseError, phaseIdle, phaseLoading, phaseReady } from "../types";

export interface UseAiLoopArgs {
  /** 计划阶段 — 由 AI provider 实现;返回一组拟执行的 action。 */
  planner: (prompt: string, threadIds: string[]) => Promise<AiAction[]>;
  /** 执行阶段 — 用户确认后逐条执行,产出 receipt。 */
  executor: (accepted: AiAction[]) => Promise<AiActionReceipt[]>;
  /** 撤销阶段 — 30s 窗口内可撤销。 */
  undoer?: (receipts: AiActionReceipt[]) => Promise<void>;
  /** 撤销窗口(默认 30s)。 */
  undoWindowMs?: number;
}

export interface UseAiLoopResult {
  plan: AiActionPlan | null;
  decisions: Record<string, AiActionDecision>;
  planning: AsyncPhase<AiAction[]>;
  accepting: boolean;
  undoEntry: UndoEntry | null;
  propose: (prompt: string, threadIds: string[]) => Promise<void>;
  setDecision: (actionId: string, decision: AiActionDecision) => void;
  bulkDecide: (decision: AiActionDecision) => void;
  acceptPlan: () => Promise<void>;
  cancelPlan: () => void;
  triggerUndo: () => Promise<void>;
  dismissUndo: () => void;
  reset: () => void;
}

function phaseIsReadyValue<T>(phase: AsyncPhase<T>): phase is { status: "ready"; value: T } {
  return phase.status === "ready";
}

function cryptoRandomId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useAiLoop({
  planner,
  executor,
  undoer,
  undoWindowMs = 30_000,
}: UseAiLoopArgs): UseAiLoopResult {
  const [plan, setPlan] = useState<AiActionPlan | null>(null);
  const [decisions, setDecisions] = useState<Record<string, AiActionDecision>>({});
  const [planning, setPlanning] = useState<AsyncPhase<AiAction[]>>(phaseIdle());
  const [accepting, setAccepting] = useState(false);
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);
  const acceptingRef = useRef(false);

  const reset = useCallback(() => {
    setPlan(null);
    setDecisions({});
    setPlanning(phaseIdle());
    setAccepting(false);
    acceptingRef.current = false;
  }, []);

  const propose = useCallback(
    async (prompt: string, threadIds: string[]) => {
      setPlan(null);
      setDecisions({});
      setUndoEntry(null);
      setPlanning(phaseLoading());
      try {
        const actions = await planner(prompt, threadIds);
        const seeded: Record<string, AiActionDecision> = {};
        for (const action of actions) {
          seeded[action.id] = action.confidence >= 0.6 ? "accepted" : "pending";
        }
        setDecisions(seeded);
        setPlanning(phaseReady(actions));
        setPlan({
          id: cryptoRandomId(),
          prompt,
          createdAt: new Date().toISOString(),
          phase: phaseIdle(),
        });
      } catch (err) {
        setPlanning(phaseError(err instanceof Error ? err.message : String(err)));
      }
    },
    [planner],
  );

  const setDecision = useCallback((actionId: string, decision: AiActionDecision) => {
    setDecisions((current) => ({ ...current, [actionId]: decision }));
  }, []);

  const bulkDecide = useCallback((decision: AiActionDecision) => {
    setDecisions((current) => {
      const next: Record<string, AiActionDecision> = {};
      for (const id of Object.keys(current)) next[id] = decision;
      return next;
    });
  }, []);

  const acceptPlan = useCallback(async () => {
    if (!plan || acceptingRef.current) return;
    if (!phaseIsReadyValue(planning)) return;
    acceptingRef.current = true;
    setAccepting(true);
    const accepted = planning.value.filter(
      (action) => decisions[action.id] !== "rejected",
    );
    try {
      const receipts = await executor(accepted);
      const failedCount = receipts.filter((r) => r.status === "failed").length;
      setPlan({ ...plan, phase: phaseReady({ accepted, receipts }) });
      if (undoer && failedCount < receipts.length) {
        const createdAt = Date.now();
        setUndoEntry({
          id: cryptoRandomId(),
          planId: plan.id,
          receipts,
          createdAt,
          undo: async () => {
            if (Date.now() - createdAt > undoWindowMs) return;
            await undoer(receipts);
          },
        });
      }
    } catch (err) {
      setPlan({
        ...plan,
        phase: phaseError(err instanceof Error ? err.message : String(err)),
      });
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  }, [plan, planning, decisions, executor, undoer, undoWindowMs]);

  const cancelPlan = useCallback(() => {
    reset();
  }, [reset]);

  const triggerUndo = useCallback(async () => {
    if (!undoEntry) return;
    if (Date.now() - undoEntry.createdAt > undoWindowMs) return;
    await undoEntry.undo();
    setUndoEntry(null);
  }, [undoEntry, undoWindowMs]);

  const dismissUndo = useCallback(() => setUndoEntry(null), []);

  return {
    plan,
    decisions,
    planning,
    accepting,
    undoEntry,
    propose,
    setDecision,
    bulkDecide,
    acceptPlan,
    cancelPlan,
    triggerUndo,
    dismissUndo,
    reset,
  };
}
