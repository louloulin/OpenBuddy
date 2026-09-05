import { Worker } from "node:worker_threads";

export type WorkflowWorkerResult = {
  value: unknown;
  stopReason: "completed" | "cancelled" | "error";
  error?: string;
  agentsStarted: number;
};

export type WorkflowWorkerMeta = {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: Array<{ title: string; detail?: string; provider?: string; model?: string }>;
};

export type WorkflowWorkerRun = {
  id: string;
  meta: WorkflowWorkerMeta;
  result: Promise<WorkflowWorkerResult>;
  cancel: (reason?: string) => void;
  dispose: () => Promise<void>;
};

type WorkflowWorkerRunner = {
  runMember: (
    input: {
      teamId: string;
      memberId: string;
      role: string;
      goal: string;
      provider?: string;
      model?: string;
      schema?: unknown;
    },
    signal: AbortSignal,
  ) => Promise<unknown>;
};

type WorkflowWorkerHostOptions = {
  runner: WorkflowWorkerRunner;
  emit: (event: string, ...args: unknown[]) => void;
  disposeGraceMs: number;
};

type WorkerStartMessage = {
  type: "start";
  id: string;
  script: string;
  meta: WorkflowWorkerMeta;
  args?: unknown;
  subagentProvider?: string;
  limits: { maxTotalAgents: number; maxItems: number; syncTimeoutMs: number };
};

type WorkflowAgentInput = {
  teamId: string;
  memberId: string;
  role: string;
  goal: string;
  provider?: string;
  model?: string;
  schema?: unknown;
};

type WorkerMessage =
  | { type: "event"; event: string; args: unknown[] }
  | { type: "agent"; requestId: string; input: WorkflowAgentInput }
  | { type: "result"; result: WorkflowWorkerResult };

const workerSource = String.raw`
const vm = require("node:vm");
const { parentPort } = require("node:worker_threads");

let cancelled = false;
let cancelReason = "workflow cancelled";
let agentCount = 0;
let phaseName;
let defaultProvider;
const pending = new Map();

function renderError(error) {
  try { return error instanceof Error ? error.message : String(error); } catch { return "workflow failed"; }
}

function jsonSafe(value, seen = new WeakSet()) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (typeof value !== "object") return null;
  if (seen.has(value)) throw new Error("workflow result contains a circular reference");
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = jsonSafe(item, seen);
  seen.delete(value);
  return result;
}

function postEvent(event, ...args) { parentPort.postMessage({ type: "event", event, args }); }
function fatal(message) { const error = new Error(message); error.fatal = true; return error; }
function throwIfCancelled() { if (cancelled) throw new Error(cancelReason); }

function agent(prompt, options) {
  throwIfCancelled();
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("workflow: agent prompt must be non-empty");
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options))) throw fatal("workflow: agent options must be an object");
  const optionKeys = options ? Object.keys(options) : [];
  if (optionKeys.some((key) => !["label", "phase", "provider", "model", "schema"].includes(key))) throw fatal("workflow: unsupported agent option");
  if (agentCount >= limits.maxTotalAgents) throw fatal("workflow: total agent cap exceeded (" + limits.maxTotalAgents + ")");
  agentCount += 1;
  const optionRecord = options || {};
  const seq = agentCount;
  const label = typeof optionRecord.label === "string" ? optionRecord.label : prompt.slice(0, 80);
  const childId = id + "-" + seq;
  postEvent("workflow/agent-start", info, { seq, label, ...(typeof optionRecord.phase === "string" ? { phase: optionRecord.phase } : phaseName ? { phase: phaseName } : {}), childId });
  const requestId = id + ":agent:" + seq;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject, seq, label, optionRecord });
    parentPort.postMessage({ type: "agent", requestId, input: {
      teamId: id,
      memberId: childId,
      role: label,
      goal: prompt,
      ...(typeof optionRecord.provider === "string" ? { provider: optionRecord.provider } : typeof defaultProvider === "string" ? { provider: defaultProvider } : {}),
      ...(typeof optionRecord.model === "string" ? { model: optionRecord.model } : {}),
      ...(optionRecord.schema === undefined ? {} : { schema: optionRecord.schema }),
    } });
  }).then((output) => {
    postEvent("workflow/agent-end", info, { seq, label, ...(typeof optionRecord.phase === "string" ? { phase: optionRecord.phase } : phaseName ? { phase: phaseName } : {}), childId, outcome: "completed" });
    if (optionRecord.schema === undefined) return output;
    if (typeof output === "string") {
      try {
        return jsonSafe(JSON.parse(output));
      } catch {
        throw new Error("workflow: schema'd agent output must be valid JSON");
      }
    }
    return jsonSafe(output);
  }, (error) => {
    postEvent("workflow/agent-end", info, { seq, label, ...(typeof optionRecord.phase === "string" ? { phase: optionRecord.phase } : phaseName ? { phase: phaseName } : {}), childId, outcome: cancelled ? "cancelled" : "failed" });
    throw error;
  });
}

function parallel(thunks) {
  throwIfCancelled();
  if (!Array.isArray(thunks)) throw new Error("workflow: parallel expects an array");
  if (thunks.length > limits.maxItems) throw fatal("workflow: parallel item cap exceeded (" + limits.maxItems + ")");
  return Promise.all(thunks.map(async (thunk) => {
    if (typeof thunk !== "function") throw new Error("workflow: parallel entries must be functions");
    try { return await thunk(); } catch (error) { if (cancelled || error && error.fatal) throw error; return null; }
  }));
}

function pipeline(items, ...stages) {
  throwIfCancelled();
  if (!Array.isArray(items) || stages.some((stage) => typeof stage !== "function")) throw new Error("workflow: pipeline expects items and stage functions");
  if (items.length > limits.maxItems) throw fatal("workflow: pipeline item cap exceeded (" + limits.maxItems + ")");
  return Promise.all(items.map(async (item, index) => {
    let current = item;
    try { for (const stage of stages) current = await stage(current, item, index); return current; }
    catch (error) { if (cancelled || error && error.fatal) throw error; return null; }
  }));
}

let id;
let info;
let limits;

async function run(message) {
  id = message.id;
  info = { id, meta: message.meta };
  limits = message.limits;
  defaultProvider = message.subagentProvider;
  postEvent("workflow/start", info);
  const context = vm.createContext(Object.assign(Object.create(null), {
    args: message.args === undefined ? {} : message.args,
    agent,
    parallel,
    pipeline,
    phase: (title) => { if (typeof title !== "string" || !title.trim()) throw new Error("workflow: phase title must be non-empty"); phaseName = title; postEvent("workflow/phase", info, title); },
    log: (text) => { if (typeof text !== "string") throw new Error("workflow: log message must be a string"); postEvent("workflow/log", info, text); },
  }));
  try {
    throwIfCancelled();
    const value = await new vm.Script("(async () => {\n" + message.script + "\n})()", { filename: "workflow:" + message.meta.name, lineOffset: -1 }).runInContext(context, { timeout: limits.syncTimeoutMs });
    if (cancelled) throw new Error(cancelReason);
    parentPort.postMessage({ type: "result", result: { value: jsonSafe(value), stopReason: "completed", agentsStarted: agentCount } });
  } catch (error) {
    parentPort.postMessage({ type: "result", result: { value: null, stopReason: cancelled ? "cancelled" : "error", error: cancelled ? cancelReason : renderError(error), agentsStarted: agentCount } });
  }
}

parentPort.on("message", (message) => {
  if (message.type === "start") void run(message);
  if (message.type === "cancel") {
    cancelled = true;
    cancelReason = typeof message.reason === "string" ? message.reason : "workflow cancelled";
    for (const request of pending.values()) request.reject(new Error(cancelReason));
    pending.clear();
  }
  if (message.type === "agent-result") {
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (message.ok) request.resolve(message.output);
    else request.reject(new Error(message.error || "workflow agent failed"));
  }
});
`;

export function createWorkflowWorkerHost(options: WorkflowWorkerHostOptions) {
  const active = new Set<WorkflowWorkerRun>();

  const start = (request: WorkerStartMessage & { signal?: AbortSignal }): WorkflowWorkerRun => {
    const worker = new Worker(workerSource, { eval: true });
    const pendingControllers = new Map<string, AbortController>();
    let settled = false;
    let cancelled = false;
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveResult!: (result: WorkflowWorkerResult) => void;
    let agentsStarted = 0;
    const liveAgents = new Map<number, Record<string, unknown>>();
    const result = new Promise<WorkflowWorkerResult>((resolve) => { resolveResult = resolve; });
    const info = { id: request.id, meta: request.meta };
    const emitStrandedAgentEnds = (): void => {
      for (const agent of liveAgents.values()) {
        options.emit("workflow/agent-end", info, { ...agent, outcome: "cancelled" });
      }
      liveAgents.clear();
    };
    const finish = (value: WorkflowWorkerResult): void => {
      if (settled) return;
      settled = true;
      if (cancellationTimer) clearTimeout(cancellationTimer);
      for (const controller of pendingControllers.values()) controller.abort("workflow settled");
      pendingControllers.clear();
      emitStrandedAgentEnds();
      resolveResult(value);
      void worker.terminate();
      active.delete(run);
    };
    const cancel = (reason = "workflow cancelled"): void => {
      if (cancelled || settled) return;
      cancelled = true;
      for (const controller of pendingControllers.values()) controller.abort(reason);
      worker.postMessage({ type: "cancel", reason });
      cancellationTimer = setTimeout(() => finish({ value: null, stopReason: "cancelled", error: reason, agentsStarted }), options.disposeGraceMs);
    };
    const run: WorkflowWorkerRun = {
      id: request.id,
      meta: request.meta,
      result,
      cancel,
      dispose: async () => { cancel("workflow disposed"); await result; },
    };
    worker.on("message", (message: WorkerMessage) => {
      if (settled) return;
      if (message.type === "event") {
        if (message.event === "workflow/agent-start") {
          agentsStarted += 1;
          const agent = message.args[1];
          if (agent && typeof agent === "object") {
            const sequence = Number((agent as { seq?: unknown }).seq);
            if (Number.isSafeInteger(sequence)) liveAgents.set(sequence, agent as Record<string, unknown>);
          }
        } else if (message.event === "workflow/agent-end") {
          const agent = message.args[1];
          if (agent && typeof agent === "object") {
            const sequence = Number((agent as { seq?: unknown }).seq);
            if (Number.isSafeInteger(sequence)) liveAgents.delete(sequence);
          }
        }
        options.emit(message.event, ...message.args);
        return;
      }
      if (message.type === "agent") {
        agentsStarted = Math.max(agentsStarted, Number(message.input.memberId.split("-").at(-1)) || agentsStarted);
        const controller = new AbortController();
        pendingControllers.set(message.requestId, controller);
        void Promise.resolve().then(() => options.runner.runMember(message.input, controller.signal)).then(
          (output) => { pendingControllers.delete(message.requestId); if (!settled) worker.postMessage({ type: "agent-result", requestId: message.requestId, ok: true, output }); },
          (error) => { pendingControllers.delete(message.requestId); if (!settled) worker.postMessage({ type: "agent-result", requestId: message.requestId, ok: false, error: String(error) }); },
        );
        return;
      }
      if (message.type === "result") finish(message.result);
    });
    worker.on("error", (error) => finish({ value: null, stopReason: cancelled ? "cancelled" : "error", error: String(error), agentsStarted }));
    worker.on("exit", (code) => { if (!settled && code !== 0) finish({ value: null, stopReason: cancelled ? "cancelled" : "error", error: `workflow worker exited with code ${code}`, agentsStarted }); });
    active.add(run);
    const onAbort = () => cancel(typeof request.signal?.reason === "string" ? request.signal.reason : "workflow signal aborted");
    request.signal?.addEventListener("abort", onAbort, { once: true });
    result.finally(() => request.signal?.removeEventListener("abort", onAbort)).catch(() => undefined);
    const { signal: _signal, ...workerRequest } = request;
    void _signal;
    worker.postMessage(workerRequest);
    return run;
  };

  return {
    start,
    dispose: async () => { for (const run of [...active]) { run.cancel("workflow engine disposed"); await run.result; } },
  };
}
