import { OpenBuddyService, type Context } from "@openbuddy/cordis";
import { Script } from "node:vm";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { HarnessPlugin } from "@openbuddy/plugin-host";
import { createWorkflowWorkerHost, type WorkflowWorkerRun } from "../collaboration/workflow-worker";
import * as piResources from "../agent/pi-resources";
import { createShellTerminalBackend, createTerminalService, terminalCwd, terminalOwner, type TerminalRuntime, type TerminalSignal } from "./terminal-runtime";
import { SandboxPolicyService, SandboxRuntime, SubprocessRuntime } from "./subprocess-runtime";
import { closeStorage, createPlatformSecretStore, CredentialStore, openStorage, SettingsDocumentStore, type OpenStorageResult } from "@openbuddy/storage";

type GenericMethod = (...args: unknown[]) => unknown;
type GenericJob = {
  id: string;
  label: string;
  status: "running" | "completed" | "failed" | "killed";
  output: string;
  error?: string;
  controller: AbortController;
  sessionId?: string;
};

type PromptSection = { name: string; order: number; text: string | (() => string); complete?: boolean };
type PromptContext = { name: string; order: number; text: string | (() => string) };
type PromptToolProvider = () => { schemas: unknown[]; knownNames?: string[] };
type SettingsRegistration = {
  schema?: unknown;
  base: Record<string, unknown>;
  user: Record<string, unknown>;
  applies: "live" | "restart";
  revision: number;
  watchers: Set<(next: unknown, previous: unknown) => void | Promise<void>>;
  ready: Promise<void>;
};
type CredentialRecord = { kind: "api-key"; key?: string; env?: Record<string, string> } | { kind: "grant"; payload: unknown };
type WorkflowResult = { value: unknown; stopReason: "completed" | "cancelled" | "error"; error?: string; agentsStarted: number };
type WorkflowRun = { id: string; meta: WorkflowMeta; result: Promise<WorkflowResult>; cancel: (reason?: string) => void; dispose: () => Promise<void> };
type PiUi = {
  select?: (title: string, options: string[]) => Promise<string | undefined>;
  confirm?: (title: string, message: string) => Promise<boolean>;
  input?: (title: string, placeholder?: string) => Promise<string | undefined>;
};

export type DeepSeekGenericService = Record<string, unknown>;

const sharedServiceKeys: readonly [RegExp, string][] = [
  [/^@deepseek-ai\/dsh-tools$/, "tools"],
  [/^@deepseek-ai\/dsh-system-prompt$/, "systemPrompt"],
  [/^@deepseek-ai\/dsh-settings(?:-|$)/, "settings"],
  [/^@deepseek-ai\/dsh-credentials(?:-|$)/, "credentials"],
  [/^@deepseek-ai\/dsh-web$/, "web"],
  [/^@deepseek-ai\/dsh-fs(?:-|$)/, "fs"],
  [/^@deepseek-ai\/dsh-subagent(?:-|$)/, "subagents"],
  [/^@deepseek-ai\/dsh-workflow(?:-|$)/, "workflowEngine"],
  [/^@deepseek-ai\/dsh-tool-workflow$/, "workflowEngine"],
  [/^@deepseek-ai\/dsh-skill(?:-|$)/, "skills"],
  [/^@deepseek-ai\/dsh-jobs(?:-|$)/, "jobs"],
  [/^@deepseek-ai\/dsh-sandbox-policy$/, "sandboxPolicy"],
  [/^@deepseek-ai\/dsh-user-approval$/, "approval"],
  [/^@deepseek-ai\/dsh-user-questions$/, "userQuestions"],
  [/^@deepseek-ai\/dsh-agent-instructions$/, "agentInstructions"],
  [/^@deepseek-ai\/dsh-agent-presets$/, "agentPresets"],
  [/^@deepseek-ai\/dsh-terminal$/, "terminals"],
  [/^@deepseek-ai\/dsh-subprocess(?:-|$)/, "subprocess"],
  [/^@deepseek-ai\/dsh-sandbox(?:-|$)/, "sandbox"],
  [/^@deepseek-ai\/dsh-plan-mode$/, "plan"],
  [/^@deepseek-ai\/dsh-tool-session-query$/, "sessionQuery"],
];

const explicitDeepSeekPackages = new Set(["@deepseek-ai/dsh-session-query"]);

const delegateKeys: Record<string, readonly string[]> = {
  tools: ["toolRegistry"],
  fs: ["fsLocal", "fs"],
  subagents: ["subagent", "teamRunner"],
  jobs: ["task", "automation"],
  approval: ["permission"],
  // openbuddy-plan removed; pi-plan-mode owns the plan capability. Keep the
  // delegateKeys entry so capability-detect still names "plan" if a pi-plan
  // adapter is wired in via passthrough.
  plan: ["plan"],
  skills: ["piResources", "skills"],
  settings: ["piResources", "settings"],
  credentials: ["mcpResources", "credentials"],
  userQuestions: ["agentHost", "pi"],
  agentInstructions: ["piResources"],
  agentPresets: ["piResources"],
  terminals: [],
  workflowEngine: ["teamRunner", "subagent"],
  sessionQuery: ["sessionQuery"],
};

const jobStores = new WeakMap<object, Map<string, GenericJob>>();

function jobsFor(ctx: Context): Map<string, GenericJob> {
  const owner = ctx.root;
  const existing = jobStores.get(owner);
  if (existing) return existing;
  const jobs = new Map<string, GenericJob>();
  jobStores.set(owner, jobs);
  return jobs;
}

type HostJobs = {
  register: (job: { id: string; kind: string; label: string; status: "running" | "stopping" | "completed" | "killed" | "failed"; startedAt: number; sessionId?: string; controller?: AbortController; stop?: (reason?: string) => void; output?: string; error?: string }) => () => void;
  update: (id: string, patch: { status?: "running" | "stopping" | "completed" | "killed" | "failed"; finishedAt?: number; detail?: string; output?: string; error?: string }) => void;
  list: (sessionId?: string) => readonly Record<string, unknown>[];
  get: (id: string) => { id: string; status: string; controller?: AbortController; stop?: (reason?: string) => void; output?: string; error?: string } | undefined;
};

function hostJobs(ctx: Context): HostJobs | undefined {
  const host = ctx.get("agentHost") as { jobs?: HostJobs } | undefined;
  return host?.jobs;
}

function packageBase(specifier: string): string {
  return specifier.replace(/\/(?:client|remote|types|invariant|grammar|brand|protocol|loader|list-agents)$/u, "");
}

function serviceKeyFor(packageName: string): string {
  for (const [pattern, serviceKey] of sharedServiceKeys) {
    if (pattern.test(packageName)) return serviceKey;
  }
  const stem = packageName.replace(/^@deepseek-ai\//u, "").replace(/^dsh-/u, "").replace(/[^A-Za-z0-9]+(.)/gu, (_match, character: string) => character.toUpperCase());
  return `dsh${stem.slice(0, 1).toUpperCase()}${stem.slice(1)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contextService(ctx: Context, serviceKey: string): Record<string, unknown> | undefined {
  const value = ctx.get(serviceKey);
  return isObject(value) ? value : undefined;
}

function delegatedService(ctx: Context, serviceKey: string): Record<string, unknown> | undefined {
  for (const key of [serviceKey, ...(delegateKeys[serviceKey] ?? [])]) {
    const value = contextService(ctx, key);
    if (value) return value;
  }
  return undefined;
}

function listFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObject(value) && typeof value.list === "function") {
    const result = (value.list as () => unknown)();
    return Array.isArray(result) ? result : [];
  }
  return [];
}

function dshStorePath(file: string): string {
  const root = process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? process.env.HOME ?? process.cwd(), ".pi", "agent");
  return join(root, file);
}

function plainRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? { ...value } : {};
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isObject(result[key]) && isObject(value)) result[key] = mergeRecords(result[key] as Record<string, unknown>, value);
    else result[key] = value;
  }
  return result;
}

async function readJsonDocument(filename: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filename, "utf8"));
    return plainRecord(parsed);
  } catch {
    return {};
  }
}

async function writeJsonDocument(filename: string, value: unknown): Promise<void> {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filename);
}

function schemaResolve(schema: unknown, value: unknown): unknown {
  if (typeof schema === "function") return (schema as (input: unknown) => unknown)(value);
  if (isObject(schema) && typeof schema.resolve === "function") return (schema.resolve as (input: unknown) => unknown).call(schema, value);
  return value;
}

function createSettingsService(ctx: Context): DeepSeekGenericService {
  const registrations = new Map<string, SettingsRegistration>();
  const filename = dshStorePath("dsh-settings.json");
  let documentPromise: Promise<Record<string, unknown>> | undefined;
  let rawDocument: Record<string, unknown> = {};
  let storagePromise: Promise<{ result: OpenStorageResult; store: SettingsDocumentStore }> | undefined;
  const storage = () => storagePromise ??= openStorage({ filePath: dshStorePath("openbuddy.sqlite"), appVersion: "openbuddy-deepseek-settings" }).then(async (result) => {
    const store = new SettingsDocumentStore(result.driver);
    await store.importLegacy(filename);
    return { result, store };
  });
  const document = () => documentPromise ??= storage().then(async ({ store }) => {
    const value = store.list();
    if (Object.keys(value).length > 0) return value;
    return readJsonDocument(filename);
  }).then((value) => {
    rawDocument = value;
    return value;
  });
  const loadInto = async (): Promise<void> => {
    const raw = await document();
    for (const [namespace, registration] of registrations) {
      registration.user = plainRecord(raw[namespace]);
    }
  };
  const persist = async (namespace: string, registration: SettingsRegistration): Promise<void> => {
    await document();
    rawDocument[namespace] = registration.user;
    const { store } = await storage();
    store.set(namespace, registration.user);
    await writeJsonDocument(filename, rawDocument);
  };
  const valueFor = (namespace: string, registration: SettingsRegistration): unknown => schemaResolve(registration.schema, mergeRecords(registration.base, registration.user));
  const register = (namespace: string, schema: unknown, options?: { base?: Record<string, unknown>; applies?: "live" | "restart" }) => {
    if (registrations.has(namespace)) throw new Error(`settings namespace "${namespace}" is already registered`);
    const registration: SettingsRegistration = { schema, base: plainRecord(options?.base), user: plainRecord(rawDocument[namespace]), applies: options?.applies ?? "live", revision: 0, watchers: new Set(), ready: Promise.resolve() };
    registrations.set(namespace, registration);
    registration.ready = loadInto();
    const scope = {
      get: () => valueFor(namespace, registration),
      watch: (callback: (next: unknown, previous: unknown) => void | Promise<void>) => { registration.watchers.add(callback); return () => registration.watchers.delete(callback); },
      update: async (patch: unknown) => {
        await registration.ready;
        const previous = valueFor(namespace, registration);
        registration.user = mergeRecords(registration.user, plainRecord(patch));
        await persist(namespace, registration);
        registration.revision += 1;
        const next = valueFor(namespace, registration);
        for (const watcher of registration.watchers) await watcher(next, previous);
        ctx.emit("settings/updated", namespace);
      },
      replace: async (section: unknown) => {
        await registration.ready;
        const previous = valueFor(namespace, registration);
        registration.user = plainRecord(section);
        await persist(namespace, registration);
        registration.revision += 1;
        const next = valueFor(namespace, registration);
        for (const watcher of registration.watchers) await watcher(next, previous);
        ctx.emit("settings/updated", namespace);
      },
    };
    return scope;
  };
  const service: DeepSeekGenericService = {
    name: "settings",
    package: "@deepseek-ai/dsh-settings-file",
    writable: true,
    register,
    get: (namespace: string) => {
      const registration = registrations.get(namespace);
      return registration ? valueFor(namespace, registration) : undefined;
    },
    describe: () => [...registrations].map(([ns, registration]) => ({ ns, value: valueFor(ns, registration), user: registration.user, base: registration.base, revision: registration.revision, applies: registration.applies })),
    update: async (namespace: string, patch: unknown) => (registrations.get(namespace) ? registerExistingUpdate(namespace, patch, false) : undefined),
    replace: async (namespace: string, section: unknown) => (registrations.get(namespace) ? registerExistingUpdate(namespace, section, true) : undefined),
    prepareDocument: async () => { await document(); await writeJsonDocument(filename, await document()); return filename; },
    documentPath: filename,
    ready: loadInto(),
    dispose: () => {
      registrations.clear();
      if (storagePromise) void storagePromise.then(({ result }) => closeStorage(Promise.resolve(result)));
    },
  };
  async function registerExistingUpdate(namespace: string, patch: unknown, replace: boolean): Promise<void> {
    const registration = registrations.get(namespace);
    if (!registration) throw new Error(`settings namespace "${namespace}" is not registered`);
    const scope = registerScopeMethods(namespace, registration);
    await (replace ? scope.replace(patch) : scope.update(patch));
  }
  function registerScopeMethods(namespace: string, registration: SettingsRegistration) {
    return {
      update: async (patch: unknown) => {
        const previous = valueFor(namespace, registration);
        registration.user = mergeRecords(registration.user, plainRecord(patch));
        await persist(namespace, registration);
        registration.revision += 1;
        const next = valueFor(namespace, registration);
        for (const watcher of registration.watchers) await watcher(next, previous);
        ctx.emit("settings/updated", namespace);
      },
      replace: async (section: unknown) => {
        const previous = valueFor(namespace, registration);
        registration.user = plainRecord(section);
        await persist(namespace, registration);
        registration.revision += 1;
        const next = valueFor(namespace, registration);
        for (const watcher of registration.watchers) await watcher(next, previous);
        ctx.emit("settings/updated", namespace);
      },
    };
  }
  void loadInto;
  return service;
}

function createCredentialsService(ctx: Context): DeepSeekGenericService {
  const filename = dshStorePath("dsh-credentials.json");
  let loaded: Promise<{ refs: Record<string, string>; records: Record<string, CredentialRecord> }> | undefined;
  let secure: Promise<CredentialStore | undefined> | undefined;
  const store = () => loaded ??= readJsonDocument(filename).then((raw) => ({ refs: plainRecord(raw.refs) as Record<string, string>, records: plainRecord(raw.records) as Record<string, CredentialRecord> }));
  const save = async (value: { refs: Record<string, string>; records: Record<string, CredentialRecord> }) => writeJsonDocument(filename, value);
  const secureStore = () => secure ??= Promise.resolve(new CredentialStore({
    databasePath: dshStorePath("openbuddy.sqlite"),
    legacyPath: filename,
    secretStore: createPlatformSecretStore({ service: "OpenBuddy" }),
  }));
  const secureOrFallback = async (): Promise<CredentialStore | undefined> => {
    const value = await secureStore();
    if (!value) return undefined;
    try { await value.importLegacy(); return value; } catch { await value.close(); secure = Promise.resolve(undefined); return undefined; }
  };
  const service: DeepSeekGenericService = {
    name: "credentials",
    package: "@deepseek-ai/dsh-credentials-local",
    resolve: async (ref: string) => {
      const environment = process.env[ref];
      if (typeof environment === "string" && environment.length > 0) return { value: environment, source: "env" };
      const secureStore = await secureOrFallback();
      if (secureStore) {
        const value = await secureStore.resolve(ref);
        if (value) return { value, source: "keychain" };
      }
      const value = (await store()).refs[ref];
      return typeof value === "string" && value.length > 0 ? { value, source: "file" } : undefined;
    },
    describe: async (ref: string) => {
      if (typeof process.env[ref] === "string" && process.env[ref]) return { configured: true, source: "env", writable: false };
      const secureStore = await secureOrFallback();
      if (secureStore && await secureStore.resolve(ref)) return { configured: true, source: "keychain", writable: true };
      return (await store()).refs[ref] ? { configured: true, source: "file", writable: true } : { configured: false, writable: true };
    },
    set: async (ref: string, value: string) => {
      if (!value) throw new Error(`credentials: empty value for ${ref}`);
      if (process.env[ref]) throw new Error(`credentials: ${ref} is shadowed by the environment`);
      const secureStore = await secureOrFallback();
      if (secureStore) await secureStore.setRef(ref, value);
      else throw new Error(`credentials: secure provider unavailable for ${ref}; legacy credential files are read-only`);
      ctx.emit("credentials/reference-updated", ref);
    },
    unset: async (ref: string) => { const secureStore = await secureOrFallback(); if (!secureStore) throw new Error(`credentials: secure provider unavailable for ${ref}; legacy credential files are read-only`); await secureStore.unsetRef(ref); ctx.emit("credentials/reference-updated", ref); },
    readRecord: async (key: string) => { const secureStore = await secureOrFallback(); return secureStore ? secureStore.readRecord(key) : (await store()).records[key]; },
    describeRecord: async (key: string) => { const secureStore = await secureOrFallback(); const record = secureStore ? await secureStore.readRecord(key) : (await store()).records[key]; return record ? { configured: true, kind: record.kind, writable: true } : { configured: false, writable: true }; },
    listRecords: async () => { const secureStore = await secureOrFallback(); return secureStore ? secureStore.listRecords() : Object.entries((await store()).records).map(([key, record]) => ({ key, kind: record.kind })); },
    modifyRecord: async (key: string, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => { const secureStore = await secureOrFallback(); if (!secureStore) throw new Error(`credentials: secure provider unavailable for ${key}; legacy credential files are read-only`); const next = await secureStore.modifyRecord(key, mutate); ctx.emit("credentials/record-updated", key); return next; },
    deleteRecord: async (key: string) => { const secureStore = await secureOrFallback(); if (!secureStore) throw new Error(`credentials: secure provider unavailable for ${key}; legacy credential files are read-only`); await secureStore.deleteRecord(key); ctx.emit("credentials/record-updated", key); },
    ready: Promise.all([store().then(() => undefined), secureOrFallback().then(() => undefined)]).then(() => undefined),
    dispose: () => { loaded = undefined; void secure?.then((value) => value?.close()); secure = undefined; },
  };
  return service;
}

function createSystemPromptService(ctx: Context): DeepSeekGenericService {
  const sections = new Map<string, PromptSection>();
  const contexts = new Map<string, PromptContext>();
  const variables = new Map<string, () => string | undefined>();
  const tools: PromptToolProvider[] = [];
  let runtimeContextSuppressed = false;
  const renderSections = (): string => {
    const values = Object.fromEntries([...variables].map(([name, provider]) => [name, provider()]));
    const sectionValues = [...sections.values()]
      .sort((left, right) => left.order - right.order)
      .map((section) => {
        const text = typeof section.text === "function" ? section.text() : section.text;
        return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/gu, (_match, name: string) => {
          const value = values[name];
          if (value === undefined) throw new Error(`systemPrompt: variable ${name} is not defined`);
          return value;
        });
      })
      .filter(Boolean);
    return sectionValues.join("\n\n");
  };
  const renderContext = (): string => {
    const contextValues = runtimeContextSuppressed ? [] : [...contexts.values()]
      .sort((left, right) => left.order - right.order)
      .map((entry) => typeof entry.text === "function" ? entry.text() : entry.text)
      .filter(Boolean);
    return contextValues.join("\n\n");
  };
  const disposeEntry = (collection: Map<string, unknown>, name: string) => () => { collection.delete(name); };
  const service: DeepSeekGenericService = {
    name: "systemPrompt",
    package: "@deepseek-ai/dsh-system-prompt",
    section: (section: PromptSection) => { sections.set(section.name, section); return disposeEntry(sections, section.name); },
    context: (entry: PromptContext) => { contexts.set(entry.name, entry); return disposeEntry(contexts, entry.name); },
    tools: (provider: PromptToolProvider) => { tools.push(provider); return () => { const index = tools.indexOf(provider); if (index >= 0) tools.splice(index, 1); }; },
    suppressRuntimeContext: () => { runtimeContextSuppressed = true; return () => { runtimeContextSuppressed = false; }; },
    variable: (name: string, provider: () => string | undefined) => { variables.set(name, provider); return disposeEntry(variables, name); },
    assemble: async () => ({ sections: [...sections.values()].map((section) => ({ name: section.name, text: typeof section.text === "function" ? section.text() : section.text })), contexts: [...contexts.values()].map((entry) => ({ name: entry.name, text: typeof entry.text === "function" ? entry.text() : entry.text })), tools: tools.flatMap((provider) => provider().schemas), variables: Object.fromEntries([...variables].map(([name, provider]) => [name, provider()])) }),
    render: renderSections,
    renderContext,
    list: () => [...sections.values()],
    dispose: () => undefined,
  };
  void ctx;
  return service;
}

function createWorkflowEngineService(ctx: Context): DeepSeekGenericService {
  const runner = ctx.get("teamRunner") as { runMember: (input: { teamId: string; memberId: string; role: string; goal: string; provider?: string; model?: string; schema?: unknown }, signal: AbortSignal) => Promise<unknown> } | undefined;
  const active = new Map<string, WorkflowRun>();
  const emit = (event: string, ...args: unknown[]) => {
    try { ctx.emit(event, ...args); } catch (error) { console.warn(`[openbuddy] workflow: ${event} listener failed`, error); }
  };
  const workerHost = runner ? createWorkflowWorkerHost({
    runner,
    emit,
    disposeGraceMs: 5000,
  }) : undefined;
  const start = (request: { script: string; meta: unknown; args?: unknown; parent?: unknown; signal?: AbortSignal; maxTotalAgents?: number; subagentProvider?: string }): WorkflowRun => {
    if (typeof request.script !== "string" || !request.script.trim()) throw new Error("workflow: script must be non-empty");
    const meta = validateWorkflowMeta(request.meta);
    if (/^\s*export\s+const\s+meta\b/u.test(request.script)) throw new Error("workflow meta must be passed in the meta request field, not declared in the script");
    try {
      void new Script(`(async () => {\n${request.script}\n})()`, { filename: `workflow:${meta.name}`, lineOffset: -1 });
    } catch (error) {
      throw new Error(`workflow script does not parse: ${String(error)}`);
    }
    if (!workerHost) throw new Error("workflow: Pi team runner is unavailable");
    const runId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maxAgents = typeof request.maxTotalAgents === "number" ? Math.max(1, Math.floor(request.maxTotalAgents)) : 32;
    const workerRun = workerHost.start({
      type: "start",
      id: runId,
      script: request.script,
      meta,
      ...(request.args === undefined ? {} : { args: request.args }),
      ...(request.subagentProvider === undefined ? {} : { subagentProvider: request.subagentProvider }),
      signal: request.signal,
      limits: { maxTotalAgents: maxAgents, maxItems: 4096, syncTimeoutMs: 5000 },
    });
    const run: WorkflowRun = workerRun as WorkflowWorkerRun;
    run.result = workerRun.result.then((result) => result);
    active.set(runId, run);
    const registry = hostJobs(ctx);
    const unregister = registry?.register({ id: runId, kind: "workflow", label: meta.name, status: "running", startedAt: Date.now(), sessionId: currentSessionId(ctx), stop: (reason) => run.cancel(reason ?? "job killed") });
    void run.result.then((result) => {
      registry?.update(runId, { status: result.stopReason === "cancelled" ? "killed" : result.stopReason === "error" ? "failed" : "completed", finishedAt: Date.now(), ...(result.error ? { detail: result.error } : {}) });
    }).finally(() => { active.delete(runId); void unregister; }).catch(() => undefined);
    return run;
  };
  return {
    name: "workflowEngine",
    package: "@deepseek-ai/dsh-workflow",
    start,
    get: (id: string) => active.get(id),
    list: () => [...active.values()].map((run) => ({ id: run.id, meta: run.meta })),
    stop: (id: string, reason?: string) => { const run = active.get(id); run?.cancel(reason); return Boolean(run); },
    dispose: async () => { for (const run of [...active.values()]) { run.cancel("workflow engine disposed"); await run.dispose(); } },
  };
}

function piUi(ctx: Context): PiUi | undefined {
  const value = ctx.get("piUi");
  return isObject(value) ? value as PiUi : undefined;
}

function createUserQuestionsService(ctx: Context): DeepSeekGenericService {
  return {
    name: "userQuestions",
    ask: async (request: { questions?: unknown[]; signal?: AbortSignal }) => {
      const ui = piUi(ctx);
      if (!ui) throw Object.assign(new Error("dsh-user-questions: no UI provider is registered"), { code: "NO_PROVIDER" });
      const questions = Array.isArray(request?.questions) ? request.questions : [];
      if (questions.length === 0) throw Object.assign(new Error("dsh-user-questions: at least one question is required"), { code: "EMPTY_QUESTIONS" });
      const answers: Array<{ id: string; selected: string[]; custom?: string }> = [];
      for (const item of questions) {
        if (request.signal?.aborted) throw Object.assign(new Error("dsh-user-questions: request was aborted"), { code: "ASK_ABORTED" });
        if (!isObject(item) || typeof item.id !== "string" || typeof item.question !== "string") {
          throw Object.assign(new Error("dsh-user-questions: question is invalid"), { code: "INVALID_QUESTION" });
        }
        const options = Array.isArray(item.options)
          ? item.options.filter((option): option is { label: string } => isObject(option) && typeof option.label === "string")
          : [];
        const title = typeof item.header === "string" && item.header ? `${item.header}: ${item.question}` : item.question;
        if (item.multiSelect === true) {
          const custom = await ui.input?.(title, options.length ? `输入选项（可用逗号分隔）：${options.map((option) => option.label).join(", ")}` : undefined);
          answers.push({ id: item.id, selected: custom ? custom.split(",").map((value) => value.trim()).filter(Boolean) : [], ...(custom ? { custom } : {}) });
          continue;
        }
        const selected = options.length > 0 ? await ui.select?.(title, options.map((option) => option.label)) : await ui.input?.(title);
        answers.push({ id: item.id, selected: selected ? [selected] : [] });
      }
      return { answers };
    },
  };
}

function createAgentInstructionsService(ctx: Context, config?: unknown): DeepSeekGenericService {
  const resources = contextService(ctx, "piResources");
  const configured = isObject(config) ? { ...config } : {};
  const currentCwd = (): string | undefined => {
    const cwd = resources?.getCwd;
    const value = typeof cwd === "function" ? cwd() : undefined;
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  const read = async (request?: { cwd?: string; maxBytes?: number; maxSourceBytes?: number; dshHome?: string; projectRootMarkers?: string[]; instructionFileCandidates?: string[]; localInstructionFileCandidates?: string[] }) => {
    const input = request ?? {};
    return piResources.readWorkspaceInstructions(input.cwd ?? currentCwd(), input.maxBytes ?? (typeof configured.maxBytes === "number" ? configured.maxBytes : 128 * 1024), {
      dshHome: input.dshHome ?? (typeof configured.dshHome === "string" ? configured.dshHome : undefined),
      maxSourceBytes: input.maxSourceBytes ?? (typeof configured.maxSourceBytes === "number" ? configured.maxSourceBytes : undefined),
      projectRootMarkers: input.projectRootMarkers ?? (Array.isArray(configured.projectRootMarkers) ? configured.projectRootMarkers.filter((value): value is string => typeof value === "string") : undefined),
      instructionFileCandidates: input.instructionFileCandidates ?? (Array.isArray(configured.instructionFileCandidates) ? configured.instructionFileCandidates.filter((value): value is string => typeof value === "string") : undefined),
      localInstructionFileCandidates: input.localInstructionFileCandidates ?? (Array.isArray(configured.localInstructionFileCandidates) ? configured.localInstructionFileCandidates.filter((value): value is string => typeof value === "string") : undefined),
    });
  };
  return {
    name: "agentInstructions",
    package: "@deepseek-ai/dsh-agent-instructions",
    config: configured,
    load: read,
    read,
    render: read,
    getCwd: currentCwd,
    ready: Promise.resolve(),
    dispose: () => undefined,
  };
}

function createAgentPresetsService(ctx: Context): DeepSeekGenericService {
  const resources = contextService(ctx, "piResources");
  const cwd = (): string | undefined => {
    const getCwd = resources?.getCwd;
    const value = typeof getCwd === "function" ? getCwd() : undefined;
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  return {
    name: "agentPresets",
    package: "@deepseek-ai/dsh-agent-presets",
    defaultId: async () => (await (typeof resources?.readAgentPresetDefaults === "function" ? resources.readAgentPresetDefaults() : piResources.readAgentPresetDefaults())).default,
    list: async () => typeof resources?.listAgentPresets === "function" ? resources.listAgentPresets(cwd()) : piResources.listAgentPresets(cwd()),
    resolve: async (id?: string) => {
      const wanted = id ?? (await (typeof resources?.readAgentPresetDefaults === "function" ? resources.readAgentPresetDefaults() : piResources.readAgentPresetDefaults())).default;
      if (!wanted) throw new Error("agent-presets: no default preset is configured");
      const preset = (await (typeof resources?.listAgentPresets === "function" ? resources.listAgentPresets(cwd()) : piResources.listAgentPresets(cwd()))).find((entry: piResources.PiAgentPreset) => entry.id === wanted);
      if (!preset) throw new Error(`agent-presets: preset "${wanted}" not found`);
      return preset;
    },
    readComposition: (id: string) => typeof resources?.readAgentPreset === "function" ? resources.readAgentPreset(id, cwd()) : piResources.readAgentPreset(id, cwd()),
    setDefault: (id?: string) => typeof resources?.writeAgentPresetDefault === "function" ? resources.writeAgentPresetDefault(id) : piResources.writeAgentPresetDefault(id),
    ready: Promise.resolve(),
    dispose: () => undefined,
  };
}

function createApprovalService(ctx: Context, config?: unknown): DeepSeekGenericService {
  const policy = isObject(config) && config.policy === "never" ? "never" : "ask";
  return {
    name: "approval",
    policy,
    request: async (request: { toolName?: string; reason?: string; signal?: AbortSignal }) => {
      if (request.signal?.aborted) return "cancelled";
      if (policy === "never") return "rejected";
      const ui = piUi(ctx);
      if (!ui?.confirm) return "unavailable";
      try {
        return await ui.confirm(request.toolName ?? "需要确认", request.reason ?? "此操作需要用户确认") ? "allowed-once" : "rejected";
      } catch {
        return "unavailable";
      }
    },
  };
}

function createGenericService(ctx: Context, packageName: string, serviceKey: string, config?: unknown): DeepSeekGenericService {
  if (serviceKey === "systemPrompt") return createSystemPromptService(ctx);
  if (serviceKey === "settings") return createSettingsService(ctx);
  if (serviceKey === "credentials") return createCredentialsService(ctx);
  if (serviceKey === "workflowEngine") return createWorkflowEngineService(ctx);
  if (serviceKey === "userQuestions") return createUserQuestionsService(ctx);
  if (serviceKey === "agentInstructions") return createAgentInstructionsService(ctx, config);
  if (serviceKey === "agentPresets") return createAgentPresetsService(ctx);
  if (serviceKey === "approval") return createApprovalService(ctx);
  if (serviceKey === "subprocess") {
    const existing = ctx.get("subprocess");
    if (existing && typeof existing === "object") return existing as DeepSeekGenericService;
    return new SubprocessRuntime() as unknown as DeepSeekGenericService;
  }
  if (serviceKey === "sandboxPolicy") {
    const existing = ctx.get("sandboxPolicy");
    if (existing && typeof existing === "object") return existing as DeepSeekGenericService;
    return new SandboxPolicyService(isObject(config) ? {
      mode: config.mode === "read-only" || config.mode === "danger-full-access" || config.mode === "workspace-write" ? config.mode : undefined,
      workspaceRoot: typeof config.workspaceRoot === "string" ? config.workspaceRoot : undefined,
    } : undefined) as unknown as DeepSeekGenericService;
  }
  if (serviceKey === "sandbox") {
    const existing = ctx.get("sandbox");
    if (existing && typeof existing === "object") return existing as DeepSeekGenericService;
    const policy = ctx.get("sandboxPolicy");
    return new SandboxRuntime(policy instanceof SandboxPolicyService ? policy : new SandboxPolicyService()) as unknown as DeepSeekGenericService;
  }
  const values = new Map<string, unknown>();
  const existing = delegatedService(ctx, serviceKey);
  const toolRegistry = contextService(ctx, "toolRegistry");
  let service: DeepSeekGenericService;
  const invoke = (method: string, args: unknown[]): unknown => {
    const delegated = existing?.[method];
    if (typeof delegated === "function") return delegated.apply(existing, args);
    if (method === "list") {
      if (serviceKey === "tools" && typeof toolRegistry?.list === "function") return toolRegistry.list();
      return [...values.values()];
    }
    if (method === "register" || method === "registerTool" || method === "add") {
      const item = args[0];
      const name = isObject(item) && typeof item.name === "string" ? item.name : undefined;
      if (serviceKey === "tools" && name && typeof toolRegistry?.registerTool === "function") {
        return (toolRegistry.registerTool as (tool: unknown) => unknown)(item);
      }
      if (name) values.set(name, item);
      return () => { if (name) values.delete(name); };
    }
    if (method === "get" || method === "resolve") return typeof args[0] === "string" ? values.get(args[0]) : existing;
    if (method === "set" || method === "update" || method === "configure") {
      if (isObject(args[0])) for (const [key, value] of Object.entries(args[0])) values.set(key, value);
      else if (typeof args[0] === "string") values.set(args[0], args[1]);
      return Object.fromEntries(values);
    }
    if (method === "execute" && serviceKey === "tools") {
      const name = typeof args[0] === "string" ? args[0] : isObject(args[0]) && typeof args[0].name === "string" ? args[0].name : undefined;
      const tool = name && listFrom(toolRegistry).find((candidate) => isObject(candidate) && candidate.name === name);
      if (isObject(tool) && typeof tool.execute === "function") return tool.execute(...args.slice(1));
    }
    if (method === "invoke" || method === "run" || method === "start") throw new Error(`${serviceKey}.${method} is not implemented by ${packageName}`);
    return undefined;
  };
  service = {
    name: serviceKey,
    package: packageName,
    serviceKey,
    list: () => invoke("list", []),
    get: (key: unknown) => invoke("get", [key]),
    register: (item: unknown) => invoke("register", [item]),
    registerTool: (item: unknown) => invoke("registerTool", [item]),
    execute: (...args: unknown[]) => invoke("execute", args),
    invoke: (...args: unknown[]) => invoke("invoke", args),
    configure: (config: unknown) => invoke("configure", [config]),
    dispose: () => undefined,
  };
  const methodNames = ["list", "get", "register", "registerTool", "execute", "invoke", "configure", "dispose", "run", "start", "stop", "create", "update", "delete", "clear"];
  for (const method of methodNames) {
    if (!(method in service)) service[method] = (...args: unknown[]) => invoke(method, args);
  }
  return new Proxy(service, {
    get(target, property, receiver) {
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      if (property in target) return Reflect.get(target, property, receiver);
      const method: GenericMethod = (...args) => invoke(property, args);
      target[property] = method;
      return method;
    },
  });
}

function piCwd(ctx: Context): string {
  const resources = contextService(ctx, "mcpResources");
  if (typeof resources?.getCwd === "function") {
    const cwd = resources.getCwd();
    if (typeof cwd === "string" && cwd.trim()) return cwd;
  }
  return process.cwd();
}

type AnyPiTool = ToolDefinition<any, any, any>;

function terminalService(ctx: Context): TerminalRuntime | undefined {
  return ctx.get("terminals") as TerminalRuntime | undefined;
}

function terminalTools(ctx: Context, packageName: string): AnyPiTool[] {
  if (packageName !== "@deepseek-ai/dsh-tool-terminal") return [];
  const terminals = terminalService(ctx);
  if (!terminals) return [];
  const owner = () => terminalOwner(ctx);
  const cwd = () => terminalCwd(ctx);
  return [
    {
      name: "terminal_open",
      label: "Open persistent terminal",
      description: "Create a persistent owner-scoped terminal session for interactive or stateful shell work.",
      parameters: Type.Object({ type: Type.String(), name: Type.Optional(Type.String()), cwd: Type.Optional(Type.String()) }),
      execute: async (_id, raw) => {
        const args = raw as { type: string; name?: string; cwd?: string };
        const result = await terminals.open(owner(), { type: args.type, ...(args.name ? { name: args.name } : {}), cwd: args.cwd ?? cwd() });
        return resultText(JSON.stringify(result), result);
      },
    },
    {
      name: "terminal_send",
      label: "Send terminal input",
      description: "Send text to a persistent terminal and wait for bounded idle or exit.",
      parameters: Type.Object({ sessionId: Type.String(), text: Type.String(), submit: Type.Optional(Type.Boolean()), run_in_background: Type.Optional(Type.Boolean()) }),
      execute: async (_id, raw, signal) => {
        const args = raw as { sessionId: string; text: string; submit?: boolean; run_in_background?: boolean };
        if (args.run_in_background !== true) {
          const result = await terminals.send(owner(), args.sessionId, args.text, args.submit ?? true, signal);
          return resultText(JSON.stringify(result), result);
        }
        const jobs = jobsFor(ctx);
        const id = `dsh-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const controller = new AbortController();
        const job: GenericJob = { id, label: `terminal_send:${args.sessionId}`, status: "running", output: "", controller, sessionId: currentSessionId(ctx) };
        jobs.set(id, job);
        const unregister = hostJobs(ctx)?.register({
          id,
          kind: "terminal",
          label: job.label,
          status: "running",
          startedAt: Date.now(),
          sessionId: currentSessionId(ctx),
          controller,
          stop: (reason) => controller.abort(reason ?? "job killed"),
        });
        const onAbort = () => controller.abort(signal?.reason ?? "terminal job cancelled");
        signal?.addEventListener("abort", onAbort, { once: true });
        void terminals.send(owner(), args.sessionId, args.text, args.submit ?? true, controller.signal)
          .then((result) => {
            job.output = JSON.stringify(result);
            job.status = "completed";
            hostJobs(ctx)?.update(id, { status: "completed", finishedAt: Date.now(), output: job.output });
          })
          .catch((error) => {
            job.error = String(error);
            job.status = controller.signal.aborted ? "killed" : "failed";
            hostJobs(ctx)?.update(id, { status: job.status, finishedAt: Date.now(), detail: job.error, error: job.error });
          })
          .finally(() => signal?.removeEventListener("abort", onAbort));
        void unregister;
        return resultText(`started background terminal job ${id}`, { kind: "background", jobId: id });
      },
    },
    {
      name: "terminal_read",
      label: "Read terminal output",
      description: "Read a bounded page of retained terminal scrollback.",
      parameters: Type.Object({ sessionId: Type.String(), offset: Type.Optional(Type.Number()), count: Type.Optional(Type.Number()) }),
      execute: async (_id, raw) => {
        const args = raw as { sessionId: string; offset?: number; count?: number };
        const result = terminals.read(owner(), args.sessionId, args.offset, args.count);
        return resultText(JSON.stringify(result), result);
      },
    },
    {
      name: "terminal_signal",
      label: "Signal terminal process",
      description: "Send an allowed signal to the foreground process group of a terminal.",
      parameters: Type.Object({ sessionId: Type.String(), signal: Type.Union([Type.Literal("SIGINT"), Type.Literal("SIGTERM"), Type.Literal("SIGKILL"), Type.Literal("SIGTSTP"), Type.Literal("SIGHUP")]) }),
      execute: async (_id, raw) => {
        const args = raw as { sessionId: string; signal: TerminalSignal };
        const result = terminals.signal(owner(), args.sessionId, args.signal);
        return resultText(JSON.stringify(result), result);
      },
    },
    {
      name: "terminal_close",
      label: "Close terminal",
      description: "Close a persistent terminal and its owned process tree.",
      parameters: Type.Object({ sessionId: Type.String() }),
      execute: async (_id, raw) => {
        const sessionId = (raw as { sessionId: string }).sessionId;
        const closed = await terminals.close(owner(), sessionId, "model request");
        const result = { sessionId, outcome: closed ? "closed" : "already-closing" };
        return resultText(JSON.stringify(result), result);
      },
    },
    {
      name: "terminal_list",
      label: "List terminals",
      description: "List persistent terminals owned by the current Agent session.",
      parameters: Type.Object({}),
      execute: async () => {
        const result = terminals.list(owner());
        return resultText(JSON.stringify(result), result);
      },
    },
  ] as AnyPiTool[];
}

function concretePiTools(packageName: string, cwd: string): AnyPiTool[] {
  switch (packageName) {
    case "@deepseek-ai/dsh-tool-bash": return [createBashToolDefinition(cwd) as AnyPiTool];
    case "@deepseek-ai/dsh-tool-pwsh": return [createPowerShellToolDefinition(cwd) as AnyPiTool];
    case "@deepseek-ai/dsh-tool-fs": return [createReadToolDefinition(cwd), createWriteToolDefinition(cwd), createEditToolDefinition(cwd)] as AnyPiTool[];
    case "@deepseek-ai/dsh-tool-fs-search": return [createGrepToolDefinition(cwd), createFindToolDefinition(cwd), createLsToolDefinition(cwd)] as AnyPiTool[];
    default: return [];
  }
}

function resultText(text: string, details: unknown = undefined) {
  return { content: [{ type: "text" as const, text }], details };
}

function currentSessionId(ctx: Context): string {
  const pi = ctx.get("pi") as { getSession?: () => { sessionId?: string } | null } | undefined;
  const sessionId = pi?.getSession?.()?.sessionId;
  if (typeof sessionId === "string" && sessionId) return sessionId;
  const host = ctx.get("agentHost") as { getSessionId?: () => string | undefined } | undefined;
  return host?.getSessionId?.() ?? "current";
}

type SessionQueryService = {
  searchSessions: (request: { query: string; limit?: number; cursor?: string }) => Promise<{ items: unknown[]; nextCursor?: string }>;
  searchEvents: (request: { sessionId: string; query: string; limit?: number; cursor?: string }) => Promise<{ items: unknown[]; nextCursor?: string }>;
  traceSession: (sessionId: string) => Promise<unknown>;
  readSurface: (sessionId: string) => Promise<unknown>;
  traceEvent: (request: { sessionId: string; seq: number }) => Promise<unknown>;
  readEvent: (request: { sessionId: string; seq: number; before?: number; after?: number }) => Promise<unknown>;
  listEvents: (sessionId: string) => Promise<unknown[]>;
};

function concreteSessionQueryTools(ctx: Context, packageName: string): AnyPiTool[] {
  if (packageName !== "@deepseek-ai/dsh-tool-session-query") return [];
  const service = ctx.get("sessionQuery") as SessionQueryService | undefined;
  if (!service) return [];
  const queryParameters = Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number()), cursor: Type.Optional(Type.String()) });
  return [
    {
      name: "session_search",
      label: "Search sessions",
      description: "Search prior Pi sessions and return matching session records.",
      parameters: queryParameters,
      execute: async (_toolCallId, rawArgs) => {
        const args = rawArgs as { query: string; limit?: number; cursor?: string };
        const result = await service.searchSessions(args);
        return resultText(JSON.stringify(result, null, 2), result);
      },
    },
    {
      name: "session_event_search",
      label: "Search session events",
      description: "Search events within one prior Pi session.",
      parameters: Type.Object({ session_id: Type.String(), query: Type.String(), limit: Type.Optional(Type.Number()), cursor: Type.Optional(Type.String()) }),
      execute: async (_toolCallId, rawArgs) => {
        const args = rawArgs as { session_id: string; query: string; limit?: number; cursor?: string };
        const result = await service.searchEvents({ sessionId: args.session_id, query: args.query, limit: args.limit, cursor: args.cursor });
        return resultText(JSON.stringify(result, null, 2), result);
      },
    },
    {
      name: "session_trace",
      label: "Trace session",
      description: "Read the known parent and child lineage of a prior Pi session.",
      parameters: Type.Object({ session_id: Type.String() }),
      execute: async (_toolCallId, rawArgs) => {
        const result = await service.traceSession((rawArgs as { session_id: string }).session_id);
        return resultText(JSON.stringify(result, null, 2), result);
      },
    },
    {
      name: "session_event_trace",
      label: "Trace session events",
      description: "Read the event history for a prior Pi session.",
      parameters: Type.Object({ session_id: Type.String(), seq: Type.Number() }),
      execute: async (_toolCallId, rawArgs) => {
        const args = rawArgs as { session_id: string; seq: number };
        const result = await service.traceEvent({ sessionId: args.session_id, seq: args.seq });
        return resultText(JSON.stringify(result, null, 2), result);
      },
    },
    {
      name: "session_event_read",
      label: "Read session events",
      description: "Read exact persisted event records for a prior Pi session.",
      parameters: Type.Object({ session_id: Type.String(), seq: Type.Number(), before: Type.Optional(Type.Number()), after: Type.Optional(Type.Number()) }),
      execute: async (_toolCallId, rawArgs) => {
        const args = rawArgs as { session_id: string; seq: number; before?: number; after?: number };
        const result = await service.readEvent({ sessionId: args.session_id, seq: args.seq, before: args.before, after: args.after });
        return resultText(JSON.stringify(result, null, 2), result);
      },
    },
    {
      name: "session_surface_read",
      label: "Read session surface",
      description: "Read the current model-visible surface of a prior Pi session.",
      parameters: Type.Object({ session_id: Type.String() }),
      execute: async (_toolCallId, rawArgs) => {
        const result = await service.readSurface((rawArgs as { session_id: string }).session_id);
        return resultText(JSON.stringify(result, null, 2), result);
      },
    },
  ] as AnyPiTool[];
}

function concreteAskUserTools(ctx: Context, packageName: string): AnyPiTool[] {
  if (packageName !== "@deepseek-ai/dsh-tool-ask-user") return [];
  const questions = ctx.get("userQuestions") as { ask?: (request: unknown) => Promise<unknown> } | undefined;
  const ask = questions?.ask;
  if (!ask) return [];
  return [{
    name: "ask_user_question",
    label: "Ask user",
    description: "Ask the user one or more questions before continuing.",
    parameters: Type.Object({ questions: Type.Array(Type.Object({ id: Type.String(), question: Type.String(), header: Type.Optional(Type.String()), options: Type.Optional(Type.Array(Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) }))), multi_select: Type.Optional(Type.Boolean()) })) }),
    execute: async (_toolCallId, rawArgs, signal) => {
      const args = rawArgs as { questions: Array<{ id: string; question: string; header?: string; options?: Array<{ label: string; description?: string }>; multi_select?: boolean }> };
      const result = await ask({ questions: args.questions.map((question) => ({ ...question, ...(question.multi_select === undefined ? {} : { multiSelect: question.multi_select }) })), signal });
      return resultText(JSON.stringify(result), result);
    },
  }] as AnyPiTool[];
}

export function concretePlanTools(_ctx: Context, packageName: string): AnyPiTool[] {
  // openbuddy-plan is removed; the plan capability is fully owned by
  // pi-plan-mode (passthrough). dsh-plan-mode still resolves here for legacy
  // callers, but returns no tools so the agent does not depend on a deleted
  // Cordis service.
  if (packageName !== "@deepseek-ai/dsh-plan-mode") return [];
  return [];
}

type OpenBuddyFs = {
  stat: (path: string, cwd?: string | null) => Promise<{ exists: boolean; kind: string; absolute: string }>;
  readTextFile: (path: string, cwd?: string | null, maxBytes?: number) => Promise<string>;
  writeTextFile: (path: string, content: string, workspaceRoot: string) => Promise<string>;
  listDir: (path: string, cwd?: string | null, maxEntries?: number) => Promise<Array<{ name: string; path: string; kind: string }>>;
};

function openBuddyFs(ctx: Context): OpenBuddyFs | undefined {
  const value = ctx.get("fsLocal") ?? ctx.get("fs");
  return isObject(value) ? value as unknown as OpenBuddyFs : undefined;
}

function absoluteEditorPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || !value.startsWith("/")) throw new Error("str_replace_editor: path must be an absolute path");
  return value;
}

function lineView(content: string, range: unknown): string {
  const lines = content.split("\n");
  if (!Array.isArray(range)) return lines.map((line, index) => `${index + 1}\t${line}`).join("\n");
  const start = Number(range[0]);
  const end = Number(range[1]);
  if (!Number.isInteger(start) || start < 1 || (!Number.isInteger(end) && end !== -1) || (end !== -1 && end < start)) throw new Error("str_replace_editor: invalid view_range");
  const last = end === -1 ? lines.length : Math.min(end, lines.length);
  return lines.slice(start - 1, last).map((line, index) => `${start + index}\t${line}`).join("\n");
}

async function editorList(fs: OpenBuddyFs, target: string, cwd: string, depth: number, rows: string[]): Promise<void> {
  if (depth > 2) return;
  for (const entry of await fs.listDir(target, cwd, 500)) {
    if (entry.name.startsWith(".")) continue;
    rows.push(`${entry.kind === "directory" ? "d" : "f"}\t${entry.path}`);
    if (entry.kind === "directory") await editorList(fs, entry.path, cwd, depth + 1, rows);
  }
}

function concreteEditorTools(ctx: Context, packageName: string): AnyPiTool[] {
  if (packageName !== "@deepseek-ai/dsh-tool-str-replace-editor") return [];
  const fs = openBuddyFs(ctx);
  if (!fs) return [];
  const cwd = piCwd(ctx);
  return [{
    name: "str_replace_editor",
    label: "Edit file",
    description: "View, create, insert, or uniquely replace text in a workspace file. Paths must be absolute.",
    parameters: Type.Object({
      command: Type.Union([Type.Literal("view"), Type.Literal("create"), Type.Literal("str_replace"), Type.Literal("insert")]),
      path: Type.String(),
      file_text: Type.Optional(Type.String()),
      insert_line: Type.Optional(Type.Number()),
      new_str: Type.Optional(Type.String()),
      old_str: Type.Optional(Type.String()),
      view_range: Type.Optional(Type.Array(Type.Number())),
    }),
    execute: async (_toolCallId, rawArgs) => {
      const args = rawArgs as { command: string; path: string; file_text?: string; insert_line?: number; new_str?: string; old_str?: string; view_range?: number[] };
      const path = absoluteEditorPath(args.path);
      const info = await fs.stat(path, cwd);
      if (args.command === "view") {
        if (!info.exists) throw new Error(`str_replace_editor: path does not exist: ${path}`);
        if (info.kind === "directory") {
          const rows: string[] = [`d\t${path}`];
          await editorList(fs, path, cwd, 1, rows);
          return resultText(`Here are the files and directories up to 2 levels deep in ${path}:\n${rows.sort().join("\n")}`, { path, kind: "directory" });
        }
        const content = await fs.readTextFile(path, cwd, 512 * 1024);
        return resultText(lineView(content, args.view_range), { path, kind: "file" });
      }
      if (args.command === "create") {
        if (info.exists) throw new Error(`str_replace_editor: file already exists: ${path}`);
        if (args.file_text === undefined) throw new Error("str_replace_editor: file_text is required for create");
        await fs.writeTextFile(path, args.file_text, cwd);
        return resultText(`The file ${path} has been created successfully.`, { path, command: args.command });
      }
      if (!info.exists || info.kind !== "file") throw new Error(`str_replace_editor: path is not a file: ${path}`);
      const before = await fs.readTextFile(path, cwd, 512 * 1024);
      let after: string;
      if (args.command === "str_replace") {
        if (args.old_str === undefined || !args.old_str) throw new Error("str_replace_editor: old_str is required");
        const offsets: number[] = [];
        let offset = 0;
        while ((offset = before.indexOf(args.old_str, offset)) !== -1) { offsets.push(offset); offset += args.old_str.length; }
        if (offsets.length === 0) throw new Error(`str_replace_editor: old_str was not found in ${path}`);
        if (offsets.length > 1) throw new Error(`str_replace_editor: old_str must be unique in ${path}`);
        after = before.slice(0, offsets[0]) + (args.new_str ?? "") + before.slice(offsets[0] + args.old_str.length);
      } else if (args.command === "insert") {
        if (!Number.isInteger(args.insert_line) || (args.insert_line ?? -1) < 0) throw new Error("str_replace_editor: insert_line must be a non-negative integer");
        if (args.new_str === undefined) throw new Error("str_replace_editor: new_str is required for insert");
        const lines = before.split("\n");
        if ((args.insert_line ?? 0) > lines.length) throw new Error("str_replace_editor: insert_line is outside the file");
        after = [...lines.slice(0, args.insert_line), ...args.new_str.split("\n"), ...lines.slice(args.insert_line)].join("\n");
      } else throw new Error(`str_replace_editor: unsupported command ${args.command}`);
      await fs.writeTextFile(path, after, cwd);
      return resultText(`The file ${path} has been edited successfully.`, { path, command: args.command });
    },
  } as AnyPiTool];
}

function concreteSkillTools(ctx: Context, packageName: string): AnyPiTool[] {
  if (packageName !== "@deepseek-ai/dsh-tool-skill") return [];
  const resources = contextService(ctx, "piResources");
  if (!resources || typeof resources.listSkills !== "function" || typeof resources.readSkill !== "function") return [];
  return [{
    name: "skill",
    label: "Load skill",
    description: "Load the full instructions for an available skill by its exact name before acting on a matching task.",
    parameters: Type.Object({ name: Type.String() }),
    execute: async (_toolCallId, rawArgs) => {
      const name = (rawArgs as { name: string }).name.trim();
      if (!name || /[\\/]/u.test(name)) throw new Error("skill: name must be a simple skill name");
      const skill = await (resources.readSkill as (name: string) => Promise<{ name: string; description?: string; path: string; content: string }>)(name);
      const value = { name: skill.name, ...(skill.description ? { description: skill.description } : {}), provider: "openbuddy-pi-resources", resourceBase: { kind: "directory", path: skill.path }, content: skill.content };
      return resultText(`<skill_content name="${skill.name}">\n${skill.content}\n</skill_content>`, value);
    },
  } as AnyPiTool];
}

type WorkflowMeta = { name: string; description: string; whenToUse?: string; phases?: Array<{ title: string; detail?: string; provider?: string; model?: string }> };

function validateWorkflowMeta(meta: unknown): WorkflowMeta {
  if (!isObject(meta) || typeof meta.name !== "string" || !meta.name.trim() || typeof meta.description !== "string" || !meta.description.trim()) {
    throw new Error("workflow: meta.name and meta.description are required");
  }
  if (meta.phases !== undefined && (!Array.isArray(meta.phases) || meta.phases.some((phase) => !isObject(phase) || typeof phase.title !== "string" || !phase.title.trim()))) {
    throw new Error("workflow: meta.phases must contain titled phase objects");
  }
  return meta as unknown as WorkflowMeta;
}

function jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    throw new Error("workflow: return value must be JSON serializable");
  }
}

function concreteWorkflowTools(ctx: Context, packageName: string, config?: unknown): AnyPiTool[] {
  if (packageName !== "@deepseek-ai/dsh-tool-workflow") return [];
  const engine = ctx.get("workflowEngine") as { start: (request: { script: string; meta: WorkflowMeta; args?: unknown; signal?: AbortSignal; maxTotalAgents?: number; subagentProvider?: string }) => WorkflowRun } | undefined;
  if (!engine) return [];
  const maxAgents = isObject(config) && typeof config.maxTotalAgents === "number" ? Math.max(1, Math.floor(config.maxTotalAgents)) : 32;
  const maxChars = isObject(config) && typeof config.maxResultChars === "number" ? Math.max(1, Math.floor(config.maxResultChars)) : 50_000;
  return [{
    name: isObject(config) && typeof config.toolName === "string" && config.toolName.trim() ? config.toolName : "workflow",
    label: "Workflow",
    description: "Run a JavaScript workflow script that orchestrates Pi subagents. The script receives args and can call agent(prompt, opts), parallel(thunks), pipeline(items, ...stages), phase(title), and log(message). Return JSON-serializable data.",
    parameters: Type.Object({
      script: Type.String(),
      meta: Type.Object({ name: Type.String(), description: Type.String(), whenToUse: Type.Optional(Type.String()), phases: Type.Optional(Type.Array(Type.Object({ title: Type.String(), detail: Type.Optional(Type.String()), provider: Type.Optional(Type.String()), model: Type.Optional(Type.String()) }))) }),
      args: Type.Optional(Type.Object({})),
      subagentProvider: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, rawArgs, signal) => {
      const args = rawArgs as { script: string; meta: WorkflowMeta; args?: Record<string, unknown>; subagentProvider?: string };
      if (typeof args.script !== "string" || !args.script.trim()) throw new Error("workflow: script must be non-empty");
      const meta = validateWorkflowMeta(args.meta);
      const run = engine.start({ script: args.script, meta, ...(args.args !== undefined ? { args: args.args } : {}), ...(args.subagentProvider !== undefined ? { subagentProvider: args.subagentProvider } : {}), signal, maxTotalAgents: maxAgents });
      try {
        const result = await run.result;
        if (result.stopReason === "cancelled") throw new Error(`workflow run was cancelled${result.error ? ` (${result.error})` : ""}`);
        if (result.stopReason === "error") throw new Error(`workflow run failed: ${result.error ?? "unknown error"}`);
        const rendered = JSON.stringify(result.value, null, 2);
        const clipped = rendered.length > maxChars ? `${rendered.slice(0, maxChars)}\n… [truncated]` : rendered;
        return resultText(`workflow "${meta.name}" completed (${result.agentsStarted} agents).\nReturn value:\n${clipped}`, { runId: run.id, agentsStarted: result.agentsStarted, result: result.value, meta });
      } finally {
        await run.dispose();
      }
    },
  } as AnyPiTool];
}

function concreteTodoTools(ctx: Context, packageName: string, config?: unknown): AnyPiTool[] {
  if (packageName !== "@deepseek-ai/dsh-tool-todo") return [];
  const allowParallel = isObject(config) && config.allowParallelInProgress === true;
  return [{
    name: "todo_write",
    label: "Update todo list",
    description: "Replace the complete structured task list for the current session. Mark each item pending, in_progress, or completed.",
    parameters: Type.Object({
      todos: Type.Array(Type.Object({
        content: Type.String(),
        status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
      })),
    }),
    execute: async (_toolCallId, rawArgs) => {
      const args = rawArgs as { todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }> };
      const seen = new Set<string>();
      let active = 0;
      const todos = args.todos.map((item) => {
        const content = item.content.trim();
        if (!content) throw new Error("todo_write: content must be non-empty");
        if (seen.has(content)) throw new Error(`todo_write: duplicate content ${JSON.stringify(content)}`);
        seen.add(content);
        if (item.status === "in_progress") active += 1;
        return { content, status: item.status };
      });
      if (!allowParallel && active > 1) throw new Error("todo_write: at most one item may be in_progress");
      const task = ctx.get("task") as {
        list: (sessionId: string) => Promise<Array<{ id: string }>>;
        replace?: (sessionId: string, todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>) => Promise<unknown>;
        add: (sessionId: string, content: string) => Promise<{ id: string }>;
        update: (sessionId: string, id: string, patch: { status: string; order: number }) => Promise<unknown>;
        remove: (sessionId: string, id: string) => Promise<void>;
      } | undefined;
      if (!task) throw new Error("todo_write: OpenBuddy task service is unavailable");
      const sessionId = currentSessionId(ctx);
      if (task.replace) {
        await task.replace(sessionId, todos);
      } else {
      for (const item of await task.list(sessionId)) await task.remove(sessionId, item.id);
      for (const [order, item] of todos.entries()) {
        const created = await task.add(sessionId, item.content);
        await task.update(sessionId, created.id, { status: item.status, order });
      }
      }
      const counts = {
        pending: todos.filter((item) => item.status === "pending").length,
        inProgress: todos.filter((item) => item.status === "in_progress").length,
        completed: todos.filter((item) => item.status === "completed").length,
      };
      return resultText(JSON.stringify({ todos, counts }), { todos, counts });
    },
  } as AnyPiTool];
}

function dshAgent(ctx: Context): unknown {
  return ctx.get("piSession") ?? ctx.get("agentHost") ?? "current";
}

function goalValue(goal: unknown): unknown {
  if (!isObject(goal)) return { goal: null };
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted ?? 0,
      maxGoalRounds: goal.maxGoalRounds ?? 3,
      ...(isObject(goal.blockedReason) ? { blockedReason: goal.blockedReason } : {}),
    },
    activation: goal.activation ?? "armed",
  };
}

function concreteGoalTools(ctx: Context, packageName: string): AnyPiTool[] {
  if (packageName !== "@deepseek-ai/dsh-tool-goal") return [];
  const remotes = ctx.get("dshRemotes") as Record<string, GenericMethod> | undefined;
  if (!remotes) return [];
  const agent = () => dshAgent(ctx);
  return [
    {
      name: "get_goal",
      label: "Read current goal",
      description: "Read the current persisted completion goal, including its revision and activation state.",
      parameters: Type.Object({}),
      execute: async () => {
        const value = goalValue(await remotes.goalsGet?.(agent()));
        return resultText(JSON.stringify(value), value);
      },
    },
    {
      name: "create_goal",
      label: "Create goal",
      description: "Create one persisted completion goal for a long-running direct human request.",
      parameters: Type.Object({ objective: Type.String(), max_goal_rounds: Type.Optional(Type.Number()) }),
      execute: async (_toolCallId, rawArgs) => {
        const args = rawArgs as { objective: string; max_goal_rounds?: number };
        const created = await remotes.goalsCreate(agent(), { objective: args.objective, maxGoalRounds: args.max_goal_rounds });
        const value = goalValue(await remotes.goalsGet?.(agent()) ?? created);
        return resultText(JSON.stringify(value), value);
      },
    },
    {
      name: "update_goal",
      label: "Update goal",
      description: "Compare-and-set the current goal revision using edit, pause, resume, complete, or blocked.",
      parameters: Type.Object({
        goal_id: Type.String(),
        revision: Type.Number(),
        action: Type.Union([Type.Literal("edit"), Type.Literal("pause"), Type.Literal("resume"), Type.Literal("complete"), Type.Literal("blocked")]),
        objective: Type.Optional(Type.String()),
        max_goal_rounds: Type.Optional(Type.Number()),
        blocked_reason: Type.Optional(Type.String()),
      }),
      execute: async (_toolCallId, rawArgs) => {
        const args = rawArgs as { goal_id: string; revision: number; action: string; objective?: string; max_goal_rounds?: number; blocked_reason?: string };
        const ref = { id: args.goal_id, revision: args.revision };
        let updated: unknown;
        if (args.action === "edit") updated = await remotes.goalsEdit(agent(), ref, { objective: args.objective });
        else if (args.action === "pause") updated = await remotes.goalsPause(agent(), ref);
        else if (args.action === "resume") updated = await remotes.goalsResume(agent(), ref);
        else if (args.action === "complete") updated = await remotes.goalsComplete(agent(), ref);
        else if (args.action === "blocked") updated = await remotes.goalsBlocked?.(agent(), ref, args.blocked_reason ?? "blocked");
        else throw new Error(`update_goal: unsupported action ${args.action}`);
        const value = goalValue(updated);
        return resultText(JSON.stringify(value), value);
      },
    },
  ];
}

function concreteWebTools(_ctx: Context, packageName: string, _config?: unknown): AnyPiTool[] {
  // openbuddy-web-search is removed; the web capability is fully owned by
  // pi-web-access (passthrough). dsh-tool-web still resolves here for
  // legacy callers, but returns no tools so the agent does not depend on
  // a deleted Cordis service.
  if (packageName !== "@deepseek-ai/dsh-tool-web") return [];
  return [];
}

function concreteDelegationTools(ctx: Context, packageName: string, config?: unknown): AnyPiTool[] {
  const askUserTools = concreteAskUserTools(ctx, packageName);
  if (askUserTools.length) return askUserTools;
  const sessionQueryTools = concreteSessionQueryTools(ctx, packageName);
  if (sessionQueryTools.length) return sessionQueryTools;
  const planTools = concretePlanTools(ctx, packageName);
  if (planTools.length) return planTools;
  const editorTools = concreteEditorTools(ctx, packageName);
  if (editorTools.length) return editorTools;
  const skillTools = concreteSkillTools(ctx, packageName);
  if (skillTools.length) return skillTools;
  const workflowTools = concreteWorkflowTools(ctx, packageName, config);
  if (workflowTools.length) return workflowTools;
  const todoTools = concreteTodoTools(ctx, packageName, config);
  if (todoTools.length) return todoTools;
  const goalTools = concreteGoalTools(ctx, packageName);
  if (goalTools.length) return goalTools;
  const webTools = concreteWebTools(ctx, packageName, config);
  if (webTools.length) return webTools;
  const terminalToolsResult = terminalTools(ctx, packageName);
  if (terminalToolsResult.length) return terminalToolsResult;
  if (packageName === "@deepseek-ai/dsh-tool-subagent") {
    return [{
      name: "subagent",
      label: "Subagent",
      description: "Delegate a focused task to a Pi-backed subagent. Use run_in_background for long-running work.",
      parameters: Type.Object({
        description: Type.String(),
        prompt: Type.String(),
        run_in_background: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, rawArgs, signal) => {
        const args = rawArgs as { description: string; prompt: string; run_in_background?: boolean };
        const runner = ctx.get("teamRunner") as { runMember: (input: { teamId: string; memberId: string; role: string; goal: string; provider?: string; model?: string; schema?: unknown; persist?: boolean }, signal: AbortSignal) => Promise<unknown> } | undefined;
        if (!runner) throw new Error("dsh-tool-subagent: Pi team runner is unavailable");
        const jobs = jobsFor(ctx);
        const id = `dsh-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const controller = new AbortController();
        const job: GenericJob = { id, label: args.description, status: "running", output: "", controller };
        jobs.set(id, job);
        const unregister = hostJobs(ctx)?.register({ id, kind: "subagent", label: args.description, status: "running", startedAt: Date.now(), sessionId: currentSessionId(ctx), controller, stop: () => controller.abort("job killed") });
        const run = runner.runMember({ teamId: "dsh-subagent", memberId: id, role: args.description, goal: args.prompt, persist: args.run_in_background === true }, controller.signal)
          .then((output) => { job.output = typeof output === "string" ? output : JSON.stringify(output); job.status = "completed"; hostJobs(ctx)?.update(id, { status: "completed", finishedAt: Date.now(), output: job.output }); return job.output; })
          .catch((error) => { job.error = String(error); job.status = controller.signal.aborted ? "killed" : "failed"; hostJobs(ctx)?.update(id, { status: job.status, finishedAt: Date.now(), detail: job.error, error: job.error }); throw error; });
        if (args.run_in_background === true) {
          void run.catch(() => undefined);
          return resultText(`started background subagent job ${id}`, { kind: "background", jobId: id });
        }
        try {
          const output = await run;
          return resultText(output, { kind: "foreground", runId: id, output });
        } finally {
          jobs.delete(id);
          unregister?.();
        }
      },
    } as ToolDefinition];
  }
  if (packageName === "@deepseek-ai/dsh-tool-jobs") {
    const jobs = jobsFor(ctx);
    const registry = hostJobs(ctx);
    return [
      {
        name: "job_list",
        label: "List jobs",
        description: "List Pi-backed background jobs.",
        parameters: Type.Object({}),
        execute: async () => {
          const listed = registry?.list(currentSessionId(ctx)) ?? [...jobs.values()].map(({ controller, ...job }) => job);
          return resultText(JSON.stringify(listed), listed);
        },
      },
      {
        name: "job_output",
        label: "Job output",
        description: "Read output from a Pi-backed background job.",
        parameters: Type.Object({ job_id: Type.String() }),
        execute: async (_toolCallId, rawArgs) => {
          const args = rawArgs as { job_id: string };
          const hostJob = registry?.get(args.job_id);
          const job = hostJob ?? jobs.get(args.job_id);
          if (!job) return resultText(`job ${args.job_id} not found`, { ok: false });
          return resultText(("output" in job && typeof job.output === "string" ? job.output : undefined)
            || ("error" in job && typeof job.error === "string" ? job.error : undefined)
            || `(job ${job.status})`, { job, text: "output" in job ? job.output : undefined });
        },
      },
      {
        name: "job_kill",
        label: "Stop job",
        description: "Stop a Pi-backed background job.",
        parameters: Type.Object({ job_id: Type.String() }),
        execute: async (_toolCallId, rawArgs) => {
          const args = rawArgs as { job_id: string };
          const hostJob = registry?.get(args.job_id);
          const job = hostJob ?? jobs.get(args.job_id);
          if (!job) return resultText(`job ${args.job_id} not found`, { ok: false });
          registry?.update(args.job_id, { status: "stopping", detail: "stop requested" });
          hostJob?.stop?.("job killed");
          job.controller?.abort("job killed");
          if (!hostJob) job.status = "killed";
          return resultText(JSON.stringify({ ok: true, jobId: job.id }), { ok: true, jobId: job.id });
        },
      },
    ] as AnyPiTool[];
  }
  return [];
}

function exportNameFor(serviceKey: string): string {
  return `${serviceKey.slice(0, 1).toUpperCase()}${serviceKey.slice(1)}Service`;
}

function genericRemote(packageName: string, serviceKey: string, service?: DeepSeekGenericService): { package: string; descriptors: Array<{ namespace: string; method: string; implementation: string; service: string; parameters?: Array<{ name: string; wire: string; optional?: boolean }> }> } {
  if (packageName === "@deepseek-ai/dsh-tool-session-query") return { package: packageName, descriptors: [] };
  const allowed: Record<string, readonly string[]> = {
    settings: ["list", "get", "describe", "update", "replace"],
    credentials: ["resolve", "describe", "set", "unset", "listRecords", "readRecord", "describeRecord", "deleteRecord"],
    skills: ["listSkills", "readSkill", "list", "get"],
    workflowEngine: ["list", "get", "stop"],
    // openbuddy-plan removed; pi-plan-mode (passthrough) owns the plan capability.
    agentInstructions: ["load", "read", "render", "getCwd"],
    agentPresets: ["list", "resolve", "readComposition", "defaultId", "setDefault"],
  };
  const methods = (allowed[serviceKey] ?? []).filter((method) => service === undefined || typeof service[method] === "function");
  return {
    package: packageName,
    descriptors: methods.map((method) => ({ namespace: serviceKey, method, implementation: method, service: serviceKey })),
  };
}

function genericExport(name: string, serviceKey: string): new (ctx: Context, config?: unknown) => OpenBuddyService<unknown> {
  const exported = class DeepSeekGenericExport extends OpenBuddyService<unknown> {
    static override provide = serviceKey;
    constructor(ctx: Context, config?: unknown) {
      super(ctx, serviceKey);
      void config;
    }
    static readonly exportName = name;
  };
  return exported as unknown as new (ctx: Context, config?: unknown) => OpenBuddyService<unknown>;
}

function genericPlugin(packageName: string, serviceKey: string): HarnessPlugin {
  const plugin: HarnessPlugin = {
    name: packageName,
    ...(packageName === "@deepseek-ai/dsh-terminal-bash" || packageName === "@deepseek-ai/dsh-tool-terminal"
      ? { inject: ["terminals"] }
      : packageName === "@deepseek-ai/dsh-tool-jobs"
        ? { inject: ["jobs"] }
      : {}),
    ...(["@deepseek-ai/dsh-tool-session-query", "@deepseek-ai/dsh-terminal-bash", "@deepseek-ai/dsh-tool-terminal"].includes(packageName) ? {} : { provide: serviceKey }),
    async apply(ctx: Context, config?: unknown): Promise<() => void> {
      if (packageName === "@deepseek-ai/dsh-terminal") {
        const existing = ctx.get("terminals");
        if (existing !== undefined) return () => undefined;
        const service = createTerminalService();
        const restore = ctx.set("terminals", service);
        ctx.provide("terminals");
        return async () => {
          await service.dispose();
          restore();
        };
      }
      if (packageName === "@deepseek-ai/dsh-terminal-bash") {
        const terminals = ctx.get("terminals") as TerminalRuntime | undefined;
        if (!terminals) throw new Error("dsh-terminal-bash: terminals service is unavailable");
        const backendType = isObject(config) && typeof config.backendType === "string" && config.backendType.trim()
          ? config.backendType.trim()
          : "shell";
        const backendOptions = isObject(config) ? {
          ...(typeof config.shellPath === "string" ? { shellPath: config.shellPath } : {}),
          ...(Array.isArray(config.shellArgs) ? { shellArgs: config.shellArgs.filter((value): value is string => typeof value === "string") } : {}),
          ...(isObject(config.env) ? { env: Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, typeof value === "string" ? value : undefined])) } : {}),
          ...(typeof config.timeoutMs === "number" ? { readyTimeoutMs: config.timeoutMs } : {}),
        } : {};
        const subprocess = ctx.get("subprocess") as { spawnTerminalProcess?: (spec: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal }) => ReturnType<typeof import("node:child_process").spawn> } | undefined;
        if (subprocess?.spawnTerminalProcess) Object.assign(backendOptions, { spawnProcess: subprocess.spawnTerminalProcess });
        const dispose = terminals.registerBackend(createShellTerminalBackend(backendType, backendOptions));
        return dispose;
      }
      if (packageName === "@deepseek-ai/dsh-tool-terminal") {
        const registry = contextService(ctx, "toolRegistry");
        const registerTool = registry?.registerTool;
        if (typeof registerTool !== "function") throw new Error("dsh-tool-terminal: tool registry is unavailable");
        const tools = terminalTools(ctx, packageName);
        const toolDisposers = tools.map((tool) => (registerTool as (tool: AnyPiTool) => () => void)(tool));
        return () => { for (const dispose of toolDisposers.reverse()) dispose(); };
      }
      if (packageName === "@deepseek-ai/dsh-tool-session-query") {
        const registry = contextService(ctx, "toolRegistry");
        const registerTool = registry?.registerTool;
        const tools = typeof registerTool === "function"
          ? concreteDelegationTools(ctx, packageName, config)
          : [];
        const toolDisposers = tools.map((tool) => (registerTool as (tool: AnyPiTool) => () => void)(tool));
        return () => { for (const dispose of toolDisposers.reverse()) dispose(); };
      }
      const existing = ctx.get(serviceKey);
      const service = existing !== undefined ? contextService(ctx, serviceKey) ?? createGenericService(ctx, packageName, serviceKey, config) : createGenericService(ctx, packageName, serviceKey, config);
      const ownsService = existing === undefined;
      const serviceDispose = existing === undefined ? ctx.set(serviceKey, service) : () => undefined;
      if (existing === undefined) ctx.provide(serviceKey);
      if (isObject(service) && service.ready && typeof (service.ready as Promise<unknown>).then === "function") await service.ready;
      const remoteRegistry = contextService(ctx, "dshRemote");
      const remote = genericRemote(packageName, serviceKey, service);
      const registeredEndpoints = typeof remoteRegistry?.list === "function" ? listFrom(remoteRegistry.list()) : [];
      const remoteAlreadyRegistered = remote.descriptors.some((descriptor) => registeredEndpoints.includes(`${descriptor.namespace}/${descriptor.method}`));
      const remoteDispose = remote.descriptors.length > 0 && !remoteAlreadyRegistered && typeof remoteRegistry?.register === "function"
        ? (remoteRegistry.register as (contribution: unknown) => () => void)(remote)
        : () => undefined;
      const registry = contextService(ctx, "toolRegistry");
      const registerTool = registry?.registerTool;
      const tools = typeof registerTool === "function"
        ? [...concretePiTools(packageName, piCwd(ctx)), ...concreteDelegationTools(ctx, packageName, config)]
        : [];
      const toolDisposers = tools.map((tool) => (registerTool as (tool: AnyPiTool) => () => void)(tool));
      return async () => {
        for (const dispose of toolDisposers.reverse()) dispose();
        remoteDispose();
        serviceDispose();
        if (ownsService && isObject(service) && typeof service.dispose === "function") {
          await Promise.resolve(service.dispose()).catch(() => undefined);
        }
      };
    },
  };
  return plugin;
}

export function isGenericDeepSeekSpecifier(specifier: string): boolean {
  const base = packageBase(specifier);
  return (base.startsWith("@deepseek-ai/dsh-") || base.startsWith("@deepseek-ai/cordis-plugin-"))
    && !explicitDeepSeekPackages.has(base);
}

export function resolveDeepSeekGenericModule(specifier: string): Record<string, unknown> | undefined {
  if (!isGenericDeepSeekSpecifier(specifier)) return undefined;
  const packageName = packageBase(specifier);
  const serviceKey = serviceKeyFor(packageName);
  const plugin = genericPlugin(packageName, serviceKey);
  const remote = genericRemote(packageName, serviceKey);
  const exportName = exportNameFor(serviceKey);
  const fallbackClass = genericExport(exportName, serviceKey);
  if (specifier.endsWith("/remote")) return { default: remote, TYPERT_REMOTE: remote };
  if (specifier.endsWith("/invariant")) return { name: `${packageName}-invariant`, apply: () => undefined };
  if (specifier.endsWith("/client") || specifier.endsWith("/types")) return { default: plugin, apply: plugin.apply, [exportName]: fallbackClass };
  return new Proxy({ default: plugin, name: packageName, apply: plugin.apply, [exportName]: fallbackClass }, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      if (typeof property !== "string") return undefined;
      if (property === "then" || property === "catch" || property === "finally") return undefined;
      const dynamic = (...args: unknown[]) => {
        if (args.length === 0) return undefined;
        return args[0];
      };
      target[property] = dynamic;
      return dynamic;
    },
  });
}
