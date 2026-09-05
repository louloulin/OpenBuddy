import { OpenBuddyService, type Context } from "@openbuddy/cordis";

type CapabilityMethod = (...args: any[]) => unknown;

export type DeepSeekRemoteParameter = {
  name: string;
  wire: string;
  optional?: boolean;
};

export type DeepSeekRemoteDescriptor = {
  namespace: string;
  method: string;
  implementation: string;
  service: string;
  parameters?: readonly DeepSeekRemoteParameter[];
};

export type DeepSeekRemoteContribution = {
  package: string;
  descriptors: readonly DeepSeekRemoteDescriptor[];
};

type CapabilityDefinition = {
  packageName: string;
  serviceKey: string;
  exportName: string;
  methods: readonly string[];
  descriptors: readonly DeepSeekRemoteDescriptor[];
};

const definitions: readonly CapabilityDefinition[] = [
  {
    packageName: "@deepseek-ai/dsh-commands",
    serviceKey: "commands",
    exportName: "CommandRuntime",
    methods: ["list", "find", "execute", "parseCommand"],
    descriptors: [
      { namespace: "commands", method: "list", implementation: "list", service: "commands", parameters: [{ name: "agent", wire: "agent" }] },
      { namespace: "commands", method: "find", implementation: "find", service: "commands", parameters: [{ name: "agent", wire: "agent" }, { name: "name", wire: "name" }] },
      { namespace: "commands", method: "execute", implementation: "execute", service: "commands", parameters: [{ name: "agent", wire: "agent" }, { name: "line", wire: "line" }, { name: "images", wire: "images", optional: true }] },
      { namespace: "commands", method: "parseCommand", implementation: "parseCommand", service: "commands", parameters: [{ name: "line", wire: "line" }] },
    ],
  },
  {
    packageName: "@deepseek-ai/dsh-goal",
    serviceKey: "goals",
    exportName: "GoalService",
    methods: ["create", "edit", "pause", "resume", "complete", "clear"],
    descriptors: [
      { namespace: "goals", method: "create", implementation: "create", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "request", wire: "request" }] },
      { namespace: "goals", method: "edit", implementation: "edit", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }, { name: "request", wire: "request" }] },
      { namespace: "goals", method: "pause", implementation: "pause", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }] },
      { namespace: "goals", method: "resume", implementation: "resume", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }] },
      { namespace: "goals", method: "complete", implementation: "complete", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }] },
      { namespace: "goals", method: "clear", implementation: "clear", service: "goals", parameters: [{ name: "agent", wire: "agent" }, { name: "ref", wire: "ref" }] },
    ],
  },
  {
    packageName: "@deepseek-ai/dsh-file-reference",
    serviceKey: "fileReferences",
    exportName: "FileReferenceService",
    methods: ["list"],
    descriptors: [{ namespace: "fileReferences", method: "list", implementation: "list", service: "fileReferences", parameters: [{ name: "agent", wire: "agent" }, { name: "query", wire: "query" }] }],
  },
  {
    packageName: "@deepseek-ai/dsh-host-plugin-inventory",
    serviceKey: "pluginInventory",
    exportName: "PluginInventoryGateway",
    methods: ["list"],
    descriptors: [{ namespace: "pluginInventory", method: "list", implementation: "list", service: "pluginInventory" }],
  },
  {
    packageName: "@deepseek-ai/dsh-message-feedback",
    serviceKey: "messageFeedback",
    exportName: "MessageFeedbackService",
    methods: ["list", "put", "delete"],
    descriptors: [
      { namespace: "messageFeedback", method: "list", implementation: "list", service: "messageFeedback", parameters: [{ name: "request", wire: "request" }] },
      { namespace: "messageFeedback", method: "put", implementation: "put", service: "messageFeedback", parameters: [{ name: "request", wire: "request" }] },
      { namespace: "messageFeedback", method: "delete", implementation: "delete", service: "messageFeedback", parameters: [{ name: "request", wire: "request" }] },
    ],
  },
  {
    packageName: "@deepseek-ai/dsh-session-reference",
    serviceKey: "sessionReferenceResolver",
    exportName: "SessionReferenceResolver",
    methods: ["candidates"],
    descriptors: [{ namespace: "sessionReferenceResolver", method: "candidates", implementation: "candidates", service: "sessionReferenceResolver", parameters: [{ name: "agent", wire: "agent" }, { name: "query", wire: "query" }] }],
  },
  {
    packageName: "@deepseek-ai/dsh-cordis-host-runner",
    serviceKey: "dynamicCordisRunner",
    exportName: "DynamicCordisRunnerService",
    methods: [
      "define", "undefine", "undefineFromPanel", "runHostHalf", "getClientCode",
      "resolveRequestRun", "settleUserRun", "stop", "stopFromPanel", "syncInspectManifest",
      "resolveInspectQuery", "inventory", "reportRenderFailure", "reportClientGuardFailure", "invoke",
    ],
    descriptors: [
      { namespace: "dynamicCordisRunner", method: "inventory", implementation: "inventory", service: "dynamicCordisRunner" },
      { namespace: "dynamicCordisRunner", method: "invoke", implementation: "invoke", service: "dynamicCordisRunner" },
      { namespace: "dynamicCordisRunner", method: "stopFromPanel", implementation: "stopFromPanel", service: "dynamicCordisRunner" },
      { namespace: "dynamicCordisRunner", method: "undefineFromPanel", implementation: "undefineFromPanel", service: "dynamicCordisRunner" },
    ],
  },
];

function capabilityMethod(ctx: Context, serviceKey: string, method: string, args: readonly unknown[]): unknown {
  const remotes = ctx.get("dshRemotes") as Record<string, CapabilityMethod> | undefined;
  const suffix = `${method[0]!.toUpperCase()}${method.slice(1)}`;
  const implementation = remotes?.[`${serviceKey}${suffix}`] ?? remotes?.[method];
  if (typeof implementation !== "function") throw new Error(`deepseek-compat: ${serviceKey}.${method} is unavailable`);
  return implementation(...args);
}

function createCapabilityService(definition: CapabilityDefinition): new (ctx: Context, config?: unknown) => unknown {
  class CapabilityService extends OpenBuddyService {
    static override provide = definition.serviceKey;
    static inject = ["dshRemotes"];
    readonly typertRemote = Object.freeze({
      service: this,
      serviceKey: definition.serviceKey,
      namespace: definition.descriptors[0]?.namespace ?? definition.serviceKey,
    });

    constructor(ctx: Context, _config?: unknown) {
      super(ctx, definition.serviceKey);
    }
  }
  for (const method of definition.methods) {
    Object.defineProperty(CapabilityService.prototype, method, {
      configurable: true,
      value(this: OpenBuddyService, ...args: unknown[]) {
        if (definition.serviceKey === "dynamicCordisRunner" && method === "stop" && args.length === 0) return undefined;
        return capabilityMethod(this.ctx, definition.serviceKey, method, args);
      },
    });
  }
  for (const descriptor of definition.descriptors) {
    if (descriptor.implementation === descriptor.method) continue;
    Object.defineProperty(CapabilityService.prototype, descriptor.implementation, {
      configurable: true,
      value(this: OpenBuddyService, ...args: unknown[]) {
        return capabilityMethod(this.ctx, definition.serviceKey, descriptor.method, args);
      },
    });
  }
  return CapabilityService;
}

const services = new Map(definitions.map((definition) => [definition.packageName, createCapabilityService(definition)]));

export const deepSeekCapabilityDefinitions = definitions;

export function deepSeekCapabilityModule(packageName: string): Record<string, unknown> | undefined {
  const definition = definitions.find((candidate) => candidate.packageName === packageName);
  const service = services.get(packageName);
  if (!definition || !service) return undefined;
  return {
    name: definition.serviceKey,
    default: service,
    [definition.exportName]: service,
  };
}

export function deepSeekCapabilityRemote(packageName: string): DeepSeekRemoteContribution | undefined {
  const definition = definitions.find((candidate) => candidate.packageName === packageName);
  if (!definition) return undefined;
  return { package: definition.packageName, descriptors: definition.descriptors };
}

export function deepSeekCapabilityPackageForService(serviceKey: string): string | undefined {
  return definitions.find((definition) => definition.serviceKey === serviceKey)?.packageName;
}

export function deepSeekCapabilitySubmodule(specifier: string): Record<string, unknown> | undefined {
  const match = /^(.*)\/(remote|typert|invariant|types|client|brand|grammar)$/.exec(specifier);
  if (!match) return undefined;
  const packageName = match[1]!;
  const moduleName = match[2]!;
  const main = deepSeekCapabilityModule(packageName);
  if (!main) return undefined;
  if (moduleName === "remote") {
    const remote = deepSeekCapabilityRemote(packageName);
    return remote ? { default: remote, TYPERT_REMOTE: remote } : undefined;
  }
  if (moduleName === "invariant") return { name: `${main.name}-invariant`, inject: ["invariants"], apply: () => undefined };
  if (moduleName === "client") return { ...main, apply: () => undefined };
  if (moduleName === "brand" && packageName === "@deepseek-ai/dsh-commands") {
    return { CommandId: (value: string) => value };
  }
  if (moduleName === "grammar" && packageName === "@deepseek-ai/dsh-file-reference") {
    return {
      activeAtToken: (line: string, cursorCol: number) => {
        const beforeCursor = line.slice(0, cursorCol);
        const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor);
        if (quoted?.[1] !== undefined && quoted[2] !== undefined) return { prefix: quoted[1], query: quoted[2], quoted: true };
        const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor);
        return plain?.[1] && plain[2] !== undefined ? { prefix: plain[1], query: plain[2], quoted: false } : undefined;
      },
      formatFileMention: (candidate: { path: string; kind: "file" | "directory" }, preserveQuote: boolean) => {
        const path = candidate.kind === "directory" ? `${candidate.path}/` : candidate.path;
        if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return undefined;
        const quoted = preserveQuote || /\s/u.test(path);
        if (!quoted) return `@${path}`;
        return candidate.kind === "directory" ? `@"${path}` : `@"${path}"`;
      },
    };
  }
  return main;
}
