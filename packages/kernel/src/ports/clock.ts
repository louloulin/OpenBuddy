/** Time source port (§9). Not wired yet: lets hosts and tests control "now" once callers take it. */
export interface Clock {
  /** Milliseconds since the epoch, like `Date.now()`. */
  now(): number;
}
