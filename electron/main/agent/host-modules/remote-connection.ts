export type ConnectionDispatchContext = {
  authority?: string;
};

export type ConnectionService = {
  dispatch: (
    method: string,
    payload: unknown,
    signal: AbortSignal,
    request: ConnectionDispatchContext,
  ) => Promise<{ handled: boolean; value?: unknown }>;
};

export type ConnectionContext = {
  get?: (key: string) => unknown;
} | null;

export async function invokeConnection(
  context: ConnectionContext,
  method: string,
  payload: unknown,
  request: ConnectionDispatchContext = { authority: "loopback" },
): Promise<{ handled: boolean; value?: unknown }> {
  const connection = context?.get?.("connection") as ConnectionService | undefined;
  if (!connection?.dispatch) return { handled: false };
  return connection.dispatch(method, payload, new AbortController().signal, request);
}
