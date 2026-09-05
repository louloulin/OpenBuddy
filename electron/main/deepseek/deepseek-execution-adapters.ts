import { SandboxPolicyService, SandboxRuntime, SubprocessRuntime } from "./subprocess-runtime";

type AdapterContext = {
  get?: (name: string, strict?: boolean) => unknown;
  set?: (name: string, value: unknown) => unknown;
  provide?: (name: string, value: unknown) => unknown;
};

export const DEEPSEEK_EXECUTION_PACKAGES = new Set([
  "@deepseek-ai/dsh-subprocess-local",
  "@deepseek-ai/dsh-sandbox-local",
  "@deepseek-ai/dsh-sandbox-policy",
]);

export type DeepSeekExecutionServices = {
  subprocess: SubprocessRuntime;
  sandboxPolicy: SandboxPolicyService;
  sandbox: SandboxRuntime;
  owned?: boolean;
};

function moduleName(packageName: string): string {
  return packageName.replace(/^@deepseek-ai\//u, "");
}

export function createDeepSeekExecutionServices(options: { cwd: string; mode?: string }): DeepSeekExecutionServices {
  const mode = options.mode === "read-only" || options.mode === "danger-full-access" || options.mode === "workspace-write"
    ? options.mode
    : undefined;
  const sandboxPolicy = new SandboxPolicyService({ mode, workspaceRoot: options.cwd });
  return {
    subprocess: new SubprocessRuntime(),
    sandboxPolicy,
    sandbox: new SandboxRuntime(sandboxPolicy),
    owned: true,
  };
}

export function provideDeepSeekExecutionServices(context: AdapterContext, services: DeepSeekExecutionServices): () => Promise<void> {
  const disposers: Array<() => unknown> = [];
  let ownsSubprocess = false;
  const provide = (name: keyof DeepSeekExecutionServices, value: unknown): void => {
    if (context.get?.(name) !== undefined) return;
    const restore = context.provide?.(name, value);
    if (typeof restore === "function") disposers.push(() => restore());
    if (name === "subprocess") ownsSubprocess = true;
  };
  provide("subprocess", services.subprocess);
  provide("sandboxPolicy", services.sandboxPolicy);
  provide("sandbox", services.sandbox);
  return async () => {
    for (const dispose of disposers.reverse()) await dispose();
    if (ownsSubprocess && services.owned !== false) await services.subprocess.dispose();
  };
}

export function createDeepSeekExecutionAdapter(packageName: string, services: DeepSeekExecutionServices) {
  if (!DEEPSEEK_EXECUTION_PACKAGES.has(packageName)) return undefined;
  return {
    name: packageName,
    async apply(context: AdapterContext): Promise<() => Promise<void>> {
      const cleanup = provideDeepSeekExecutionServices(context, services);
      return async () => {
        await cleanup();
      };
    },
    package: moduleName(packageName),
  };
}
