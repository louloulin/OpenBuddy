/** Generation fencing for asynchronous plugin/runtime work.
 *
 * A reload advances the generation. Work started by an older generation may
 * still resolve, but callers must check `isCurrent` before applying its
 * result. This keeps stale Pi/plugin events from mutating the new graph.
 */
export interface GenerationGate {
  readonly current: () => number;
  readonly advance: () => number;
  readonly isCurrent: (generation: number) => boolean;
  readonly capture: () => GenerationToken;
}

export interface GenerationToken {
  readonly generation: number;
  readonly isCurrent: () => boolean;
}

export function createGenerationGate(initialGeneration = 0): GenerationGate {
  if (!Number.isSafeInteger(initialGeneration) || initialGeneration < 0) {
    throw new RangeError("initial generation must be a non-negative safe integer");
  }
  let generation = initialGeneration;
  return {
    current: () => generation,
    advance: () => {
      if (generation === Number.MAX_SAFE_INTEGER) {
        throw new RangeError("generation exhausted");
      }
      generation += 1;
      return generation;
    },
    isCurrent: (candidate) => candidate === generation,
    capture: () => {
      const captured = generation;
      return { generation: captured, isCurrent: () => captured === generation };
    },
  };
}

/** Execute a callback only if its captured generation is still current. */
export function applyIfCurrent<T>(
  gate: GenerationGate,
  token: GenerationToken,
  apply: () => T,
): T | undefined {
  return token.isCurrent() ? apply() : undefined;
}
