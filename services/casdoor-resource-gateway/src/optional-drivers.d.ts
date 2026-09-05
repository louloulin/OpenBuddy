declare module "pg" {
  export class Pool {
    constructor(config: { connectionString: string });
    query(sql: string, params?: unknown[]): Promise<unknown>;
    end(): Promise<void>;
  }
}

declare module "mysql2/promise" {
  export function createPool(connectionString: string): {
    query(sql: string, params?: unknown[]): Promise<unknown>;
    end(): Promise<void>;
  };
}
