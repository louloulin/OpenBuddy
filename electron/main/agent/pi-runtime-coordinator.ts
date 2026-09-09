import { createGenerationGate, type GenerationGate } from "@openbuddy/plugin-host";

export interface PiSessionLike {
  waitForIdle(): Promise<void>;
  reload(): Promise<void>;
}

export interface PiResourceLoaderLike {
  reload(): Promise<void>;
}

export interface PiRuntimeCoordinatorOptions {
  getSession: () => PiSessionLike | null;
  getResourceLoader: () => PiResourceLoaderLike | null;
  /** Shared generation fence for session listeners and RPC UI requests. */
  generationGate?: GenerationGate;
  onReload?: (generation: number, reason?: string) => void;
}

export class PiRuntimeCoordinator {
  private readonly generationGate: GenerationGate;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: PiRuntimeCoordinatorOptions) {
    this.generationGate = options.generationGate ?? createGenerationGate();
  }

  get generation(): number { return this.generationGate.current(); }

  captureGeneration(): { generation: number; isCurrent: () => boolean } {
    return this.generationGate.capture();
  }

  reload(reason: string): Promise<void> {
    return this.enqueue(() => this.reloadCurrent(reason));
  }

  reloadUntilStable(readRevision: () => number, reason: string): Promise<void> {
    return this.enqueue(async () => {
      let observedRevision = -1;
      while (observedRevision !== readRevision()) {
        observedRevision = readRevision();
        await this.reloadCurrent(reason);
        if (!this.options.getSession() && !this.options.getResourceLoader()) break;
      }
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.tail.then(operation, operation);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async reloadCurrent(_reason: string): Promise<void> {
    const session = this.options.getSession();
    if (session) {
      await session.waitForIdle();
      if (this.options.getSession() !== session) return;
      await session.reload();
      const generation = this.generationGate.advance();
      this.options.onReload?.(generation, _reason);
      return;
    }
    const loader = this.options.getResourceLoader();
    if (loader) {
      await loader.reload();
      const generation = this.generationGate.advance();
      this.options.onReload?.(generation, _reason);
    }
  }
}
