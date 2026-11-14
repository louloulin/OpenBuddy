// @openbuddy/kernel public API (20261115-md R2): ports the host implements, plus payload validators.
export type { Emit, EventSink } from "./ports/events.js";
export type { HostShell } from "./ports/shell.js";
export type { SafeStorage } from "./ports/secrets.js";
export type { Clock } from "./ports/clock.js";
export type { Logger } from "./ports/logger.js";
export { object, text, bool, unsupported } from "./validate.js";
