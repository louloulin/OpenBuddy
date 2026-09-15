/**
 * defineExtension — 第三方插件作者入口
 *
 * 用法:
 *   export default defineExtension({
 *     manifest: {
 *       name: "my-plugin",
 *       version: "1.0.0",
 *       description: "...",
 *       contributes: { slots: [...] }
 *     },
 *     setup: (api) => {
 *       api.registerSlot("home.scene.tab", "list", "root", {...});
 *       return () => api.unregisterAll();
 *     }
 *   });
 */

import { z } from "zod";

export interface ExtensionApi {
  registerSlot(name: string, kind: "list" | "keyed", scope: "root" | "session", payload: unknown): void;
  unregisterSlot(name: string, payloadId?: string): void;
  registerCommand(id: string, label: string, onExecute: (ctx?: { args?: string }) => void): void;
  unregisterAll(): void;
}

const PluginManifestShape = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  author: z.string().optional(),
  contributes: z.record(z.any()).optional(),
});

export type PluginManifest = z.infer<typeof PluginManifestShape>;

export interface ExtensionConfig {
  manifest: PluginManifest;
  setup: (api: ExtensionApi) => void | (() => void);
}

export interface Extension {
  manifest: PluginManifest;
  dispose: () => void;
}

export function defineExtension(config: ExtensionConfig): Extension {
  const parsed = PluginManifestShape.safeParse(config.manifest);
  if (!parsed.success) {
    throw new Error(
      `[defineExtension] invalid manifest: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }

  const registered: Array<() => void> = [];

  const api: ExtensionApi = {
    registerSlot(name, kind, scope, payload) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("openbuddy:register-slot", { detail: { name, kind, scope, payload } })
        );
      }
      registered.push(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openbuddy:unregister-slot", { detail: { name } }));
        }
      });
    },
    unregisterSlot(name) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("openbuddy:unregister-slot", { detail: { name } }));
      }
    },
    registerCommand(id, _label, onExecute) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("openbuddy:register-command", { detail: { id, onExecute } }));
      }
      registered.push(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openbuddy:unregister-command", { detail: { id } }));
        }
      });
    },
    unregisterAll() {
      for (const r of registered) r();
      registered.length = 0;
    },
  };

  const userCleanup = config.setup(api);

  return {
    manifest: parsed.data,
    dispose: () => {
      if (typeof userCleanup === "function") userCleanup();
      api.unregisterAll();
    },
  };
}
