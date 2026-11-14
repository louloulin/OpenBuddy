import { createSettings } from "@openbuddy/services/settings/settings";
import { PiEngine } from "@openbuddy/engine/pi-engine";
import type { Emit } from "@openbuddy/engine/permissions/permissions";
import type { EngineOptions, Handler, HostContext } from "./module.js";
import { HOST_MODULES } from "./modules/index.js";
export type { EngineOptions, Handler, HostContext, HostModule } from "./module.js";
export async function createEngineHandlers(options: EngineOptions) {
  const settings = createSettings(options.userDataDir, options.safeStorage);
  const emit: Emit = (event, payload) =>
    options.emit(event, settings.secrets.redact(payload));
  const engine = new PiEngine(
    settings,
    emit,
    (url) => options.shell.openExternal(url),
    options.extensionFactories,
  );
  await engine.initialize();
  const update = (fn: (c: ReturnType<typeof settings.config.read>) => void) => {
    const c = settings.config.read();
    fn(c);
    settings.config.write(c);
  };
  // The commands live in the §5.3 modules (modules/*.ts), assembled in HOST_MODULES order.
  const ctx: HostContext = { options, settings, emit, engine, update };
  const handlers: Record<string, Handler> = {};
  for (const hostModule of HOST_MODULES.map((create) => create(ctx)))
    Object.assign(handlers, hostModule.commands);
  // Redact every successful IPC return; failures never include provider response bodies or keys.
  for (const [name, handler] of Object.entries(handlers))
    handlers[name] = async (p) => {
      try {
        return settings.secrets.redact(await handler(p));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw Error(String(settings.secrets.redact(message)));
      }
    };
  return { handlers, dispose: () => engine.shutdown(), previewRoots: () => engine.previewRoots(), exportHtml: (id: string, path: string) => engine.exportHtml(id, path), notificationsEnabled: () => settings.config.read().notifyPrefs?.system !== false };
}
