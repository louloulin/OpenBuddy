import {
  createEngineHandlers as createHandlers,
  type EngineOptions,
} from "./handlers.js";
export async function createEngineHandlers(
  options: Omit<EngineOptions, "userDataDir"> & { userData: string },
) {
  const { handlers, dispose, previewRoots, exportHtml, notificationsEnabled } = await createHandlers({
    ...options,
    userDataDir: options.userData,
  });
  return { handlers, shutdown: dispose, previewRoots, exportHtml, notificationsEnabled };
}
