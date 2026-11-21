import { createSettings } from "@openbuddy/services/settings/settings";
import { NotifyChannelsService } from "@openbuddy/services/notifications/channels";
import { PiEngine } from "@openbuddy/engine/pi-engine";
import type { Emit } from "@openbuddy/kernel";
import type { EngineOptions, Handler, HostContext } from "./module.js";
import { HOST_MODULES } from "./modules/index.js";
export type { EngineOptions, Handler, HostContext, HostModule } from "./module.js";
export async function createEngineHandlers(options: EngineOptions) {
  const settings = createSettings(options.userDataDir, options.safeStorage);
  // 通知渠道 (W4.6): approval / completion pushes leave the renderer and go out from here.
  const channels = new NotifyChannelsService(settings, { openExternal: (url) => options.shell.openExternal(url) });
  /** The session the user is reading; a turn that ends in another session still deserves a notice. */
  let currentSessionId: () => string | undefined = () => undefined;
  const emit: Emit = (event, payload) => {
    const redacted = settings.secrets.redact(payload);
    options.emit(event, redacted);
    if (event === "agent://permission" || event === "agent://session-status") channels.observe(event, redacted);
    if (event === "agent://session-status") {
      const data = (redacted ?? {}) as { sessionId?: string; status?: string };
      if (data.sessionId && data.status && data.status !== "running" && data.sessionId !== currentSessionId())
        options.emit("agent://background-notice", { sessionId: data.sessionId, status: data.status });
    }
  };
  const engine = new PiEngine(
    settings,
    emit,
    (url) => options.shell.openExternal(url),
    options.extensionFactories,
    undefined, // default pool limits
    options.shell.trash ? (path) => options.shell.trash!(path) : undefined,
  );
  await engine.initialize();
  currentSessionId = () => engine.currentSessionId;
  const update = (fn: (c: ReturnType<typeof settings.config.read>) => void) => {
    const c = settings.config.read();
    fn(c);
    settings.config.write(c);
  };
  // The commands live in the §5.3 modules (modules/*.ts), assembled in HOST_MODULES order.
  const handlers: Record<string, Handler> = {};
  const ctx: HostContext = { options, settings, emit, engine, update, servedCommands: () => Object.keys(handlers) };
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
