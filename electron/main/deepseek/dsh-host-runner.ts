export type DshHostRunner = {
  inventory: () => Promise<unknown> | unknown;
  invoke: (request: unknown) => Promise<unknown>;
  stopFromPanel: (request: unknown) => Promise<unknown>;
  undefineFromPanel: (request: unknown) => Promise<unknown>;
};

export type DshHostRunnerDependencies = {
  inventory: () => Promise<unknown> | unknown;
  invoke: (request: unknown) => Promise<unknown>;
  stop: (id: string) => Promise<unknown>;
  undefine: (id: string) => Promise<unknown>;
};

function requestValue(request: unknown): Record<string, unknown> | undefined {
  return request && typeof request === "object" && !Array.isArray(request)
    ? request as Record<string, unknown>
    : undefined;
}

function nestedRequest(request: unknown): unknown {
  const value = requestValue(request);
  return value && value.request !== undefined ? value.request : request;
}

function requestId(request: unknown, label: string): string {
  if (typeof request === "string" && request.trim()) return request.trim();
  const value = requestValue(request);
  const nested = requestValue(nestedRequest(request));
  const candidate = value?.taskId ?? value?.runId ?? value?.id ?? value?.package ?? value?.name
    ?? nested?.taskId ?? nested?.runId ?? nested?.id ?? nested?.package ?? nested?.name;
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  throw new Error(`dsh-host-runner: ${label} is required`);
}

export function createDshHostRunner(dependencies: DshHostRunnerDependencies): DshHostRunner {
  return {
    inventory: () => dependencies.inventory(),
    invoke: (request) => dependencies.invoke(nestedRequest(request)),
    stopFromPanel: async (request) => dependencies.stop(requestId(request, "task id")),
    undefineFromPanel: async (request) => dependencies.undefine(requestId(request, "definition id")),
  };
}
