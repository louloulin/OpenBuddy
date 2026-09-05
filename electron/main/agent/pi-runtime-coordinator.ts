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
}

export class PiRuntimeCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: PiRuntimeCoordinatorOptions) {}

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
      return;
    }
    await this.options.getResourceLoader()?.reload();
  }
}
