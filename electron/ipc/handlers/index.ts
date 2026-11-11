import {
  createEngineHandlers as createHandlers,
  type EngineOptions,
} from "./agent.js";
export async function createEngineHandlers(
  options: Omit<EngineOptions, "userDataDir"> & { userData: string },
) {
  const { handlers, dispose } = await createHandlers({
    ...options,
    userDataDir: options.userData,
  });
  return { handlers, shutdown: dispose };
}
