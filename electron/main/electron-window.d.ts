export {};

declare global {
  interface Window {
    api: {
      invoke<T = any>(channel: string, args?: unknown): Promise<T>;
    };
  }
}
