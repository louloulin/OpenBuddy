import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Context } from "@openbuddy/cordis";
import { HarnessPluginLoader, type PluginEntryOptions } from "@openbuddy/plugin-host";
import { pathToFileURL } from "node:url";
import { RemoteDispatcher } from "../harness/remote-dispatch";

export interface PresetToolRegistry {
  registerTool: (tool: ToolDefinition) => () => void;
  list: () => ToolDefinition[];
  listLocal?: () => ToolDefinition[];
}

export interface PresetSessionRuntimeOptions {
  hostContext: Context;
  hostLoader: HarnessPluginLoader;
  toolRegistry: PresetToolRegistry;
  cwd: string;
}

type PromptSection = { name: string; order: number; text: string | (() => string) };
type PromptContext = { name: string; order: number; text: string | (() => string) };

function createPromptService(): Record<string, unknown> {
  const sections = new Map<string, PromptSection>();
  const contexts = new Map<string, PromptContext>();
  const variables = new Map<string, () => string | undefined>();
  const tools: Array<() => { schemas: unknown[]; knownNames?: string[] }> = [];
  let suppressRuntimeContext = false;
  const value = (text: string | (() => string)): string => typeof text === "function" ? text() : text;
  const renderSections = (): string => {
    const resolvedVariables = Object.fromEntries([...variables].map(([name, provider]) => [name, provider()]));
    return [...sections.values()]
      .sort((left, right) => left.order - right.order)
      .map((section) => value(section.text).replace(/\{\{([a-z][a-z0-9_]*)\}\}/gu, (_match, name: string) => {
        const replacement = resolvedVariables[name];
        if (replacement === undefined) throw new Error(`systemPrompt: variable ${name} is not defined`);
        return replacement;
      }))
      .filter(Boolean)
      .join("\n\n");
  };
  const renderContext = (): string => suppressRuntimeContext
    ? ""
    : [...contexts.values()]
      .sort((left, right) => left.order - right.order)
      .map((entry) => value(entry.text))
      .filter(Boolean)
      .join("\n\n");
  const remove = <T>(collection: Map<string, T>, name: string) => () => { collection.delete(name); };
  return {
    name: "systemPrompt",
    package: "@deepseek-ai/dsh-system-prompt",
    section: (section: PromptSection) => { sections.set(section.name, section); return remove(sections, section.name); },
    context: (entry: PromptContext) => { contexts.set(entry.name, entry); return remove(contexts, entry.name); },
    variable: (name: string, provider: () => string | undefined) => { variables.set(name, provider); return remove(variables, name); },
    tools: (provider: () => { schemas: unknown[]; knownNames?: string[] }) => { tools.push(provider); return () => { const index = tools.indexOf(provider); if (index >= 0) tools.splice(index, 1); }; },
    suppressRuntimeContext: () => { suppressRuntimeContext = true; return () => { suppressRuntimeContext = false; }; },
    assemble: async () => ({
      sections: [...sections.values()].map((section) => ({ name: section.name, text: value(section.text) })),
      contexts: [...contexts.values()].map((entry) => ({ name: entry.name, text: value(entry.text) })),
      tools: tools.flatMap((provider) => provider().schemas),
      variables: Object.fromEntries([...variables].map(([name, provider]) => [name, provider()])),
    }),
    render: renderSections,
    renderContext,
    list: () => [...sections.values()],
    dispose: () => undefined,
  };
}

export interface PresetSessionMountOptions {
  id: string;
  source: string;
  path: string;
  scope?: Record<string, unknown>;
}

export class PresetSessionRuntime {
  private readonly options: PresetSessionRuntimeOptions;
  private context: Context | null = null;
  private loader: HarnessPluginLoader | null = null;
  private mountedId: string | null = null;
  private mountedPath: string | null = null;
  private readonly localTools = new Map<string, ToolDefinition>();
  private readonly localRemotes = new RemoteDispatcher();

  constructor(options: PresetSessionRuntimeOptions) {
    this.options = options;
  }

  get id(): string | null {
    return this.mountedId;
  }

  get tools(): ToolDefinition[] {
    const merged = new Map(this.options.toolRegistry.list().map((tool) => [tool.name, tool] as const));
    for (const tool of this.localTools.values()) merged.set(tool.name, tool);
    return [...merged.values()];
  }

  get modelFacingTools(): ToolDefinition[] {
    return this.tools;
  }

  get loaderStatus(): ReturnType<HarnessPluginLoader["list"]> {
    return this.loader?.list() ?? [];
  }

  get contextValue(): Context | null {
    return this.context;
  }

  renderSystemPrompt(): string {
    const service = this.context?.get("systemPrompt") as { render?: () => string } | undefined;
    return service?.render?.() ?? "";
  }

  get modelFacingSystemPrompt(): string {
    return this.renderSystemPrompt();
  }

  private createLocalToolRegistry(): PresetToolRegistry {
    return {
      registerTool: (tool) => {
        if (!tool?.name) throw new Error("openbuddy-tool: name is required");
        this.localTools.set(tool.name, tool);
        return () => {
          if (this.localTools.get(tool.name) !== tool) return false;
          return this.localTools.delete(tool.name);
        };
      },
      list: () => this.tools,
      listLocal: () => [...this.localTools.values()],
    };
  }

  private createLocalAgentPresets(id: string): Record<string, unknown> {
    const resources = this.options.hostContext.get("piResources") as Record<string, unknown> | undefined;
    const cwd = this.options.cwd;
    const list = () => typeof resources?.listAgentPresets === "function" ? resources.listAgentPresets(cwd) : [];
    const read = (presetId: string) => typeof resources?.readAgentPreset === "function" ? resources.readAgentPreset(presetId, cwd) : Promise.reject(new Error("agent-presets: resource service unavailable"));
    return {
      name: "agentPresets",
      package: "@deepseek-ai/dsh-agent-presets",
      currentId: id,
      defaultId: async () => id,
      list,
      resolve: async (requestedId?: string) => {
        const wanted = requestedId ?? id;
        const entry = (await list()).find((candidate: { id?: string }) => candidate.id === wanted);
        if (!entry) throw new Error(`agent-presets: preset "${wanted}" not found`);
        return entry;
      },
      readComposition: read,
      setDefault: (nextId?: string) => typeof resources?.writeAgentPresetDefault === "function" ? resources.writeAgentPresetDefault(nextId) : Promise.resolve({}),
      ready: Promise.resolve(),
      dispose: () => undefined,
    };
  }

  async mount(options: PresetSessionMountOptions): Promise<void> {
    if (this.loader) throw new Error("preset-session: a preset is already mounted");
    const context = this.options.hostContext
      .isolate("loader")
      .isolate("pluginLoader")
      .isolate("toolRegistry")
      .isolate("systemPrompt")
      .isolate("dshRemote")
      .isolate("agentPresets");
    context.set("toolRegistry", this.createLocalToolRegistry());
    context.set("systemPrompt", createPromptService());
    context.set("dshRemote", {
      register: (contribution: unknown) => {
        const result = this.localRemotes.register(contribution, context);
        return () => this.localRemotes.unregister(result.package);
      },
      unregister: (packageName: unknown) => this.localRemotes.unregister(packageName),
      invoke: (request: unknown) => this.localRemotes.invoke(request, context),
      list: () => this.localRemotes.list(),
      get: (endpoint: string) => this.localRemotes.describe(endpoint),
      descriptors: () => this.localRemotes.describeAll(),
    });
    context.set("agentPresets", this.createLocalAgentPresets(options.id));
    context.set("presetSessionRuntime", this);
    const loader = this.options.hostLoader.createScopedLoader(context);
    try {
      await loader.loadCordisComposition(options.source, {
        parentContext: context,
        baseUrl: pathToFileURL(options.path).href,
        scope: {
          cwd: this.options.cwd,
          DSH_CWD: this.options.cwd,
          presetId: options.id,
          process: { env: { ...process.env, DSH_CWD: this.options.cwd } },
          ...(options.scope ?? {}),
        },
      });
      this.context = context;
      this.loader = loader;
      this.mountedId = options.id;
      this.mountedPath = options.path;
    } catch (error) {
      await loader.dispose().catch(() => undefined);
      throw new Error(`preset-session: failed to mount "${options.id}" from ${options.path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async dispose(): Promise<void> {
    const loader = this.loader;
    this.loader = null;
    this.context = null;
    this.mountedId = null;
    this.mountedPath = null;
    await loader?.dispose();
    this.localTools.clear();
    this.localRemotes.clear();
  }
}

export function dedupeTools(tools: readonly ToolDefinition[]): ToolDefinition[] {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) if (tool?.name) byName.set(tool.name, tool);
  return [...byName.values()];
}

export function presetEntryIds(entries: readonly PluginEntryOptions[]): string[] {
  return entries.map((entry) => entry.id);
}
