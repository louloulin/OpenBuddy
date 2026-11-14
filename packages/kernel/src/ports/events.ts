/** Event port: how the engine and services push events to the host (moved from engine/permissions, R2). */
export type Emit = (event: string, payload: unknown) => void;
/** The §9 name for the same port. */
export type EventSink = Emit;
