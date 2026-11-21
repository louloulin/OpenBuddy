import { join } from "node:path";
import type { HostModuleFactory } from "../module.js";
import { UpdateService, type UpdateChannel } from "@openbuddy/services/update/update";

/**
 * 更新检查 (A3): a real manifest fetch, never a silent install. The feed comes from the desktop
 * (`OPENBUDDY_UPDATE_FEED`); without one the renderer shows 未配置更新源. `update_download` fetches
 * the installer into `<userData>/updates` and verifies size + sha256 before revealing it.
 */
export const updateModule: HostModuleFactory = (ctx) => {
  const service = new UpdateService({
    currentVersion: ctx.options.appVersion ?? "0.0.0-dev",
    ...(ctx.options.updateFeed ? { feedUrl: ctx.options.updateFeed } : {}),
    ...(ctx.options.fetchImpl ? { fetchImpl: ctx.options.fetchImpl } : {}),
  });
  return {
    id: "update",
    commands: {
      update_check: (payload) => {
        const feedUrl = typeof payload.feedUrl === "string" && payload.feedUrl.trim() ? payload.feedUrl.trim() : undefined;
        const channel = payload.channel === "beta" ? "beta" : payload.channel === "stable" || payload.channel === undefined ? "stable" : undefined;
        if (!channel) throw new Error("invalid_payload: channel");
        return service.check({ ...(feedUrl ? { feedUrl } : {}), channel: channel as UpdateChannel });
      },
      update_download: (payload) =>
        service.download({
          url: typeof payload.url === "string" ? payload.url : "",
          ...(typeof payload.sha256 === "string" ? { sha256: payload.sha256 } : {}),
          ...(typeof payload.size === "number" ? { size: payload.size } : {}),
          dir: join(ctx.options.userDataDir ?? process.cwd(), "updates"),
        }),
    },
  };
};
