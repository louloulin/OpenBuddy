/** Logging port (§9). Not wired yet: the desktop host would back it with `console`. */
export interface Logger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}
