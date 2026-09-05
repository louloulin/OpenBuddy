declare module "ws" {
  class WebSocket {
    constructor(url: string);
    static readonly OPEN: number;
    static readonly CONNECTING: number;
    readonly OPEN: number;
    readonly CONNECTING: number;
    readonly readyState: number;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }

  class WebSocketServer {
    constructor(options?: { noServer?: boolean });
    handleUpgrade(request: any, socket: any, head: Buffer, callback: (socket: WebSocket) => void): void;
    close(callback?: (error?: Error) => void): void;
  }

  export { WebSocketServer };
  export default WebSocket;
}
