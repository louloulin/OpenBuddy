import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredObject {
  hash: string;
  sizeBytes: number;
  mediaType?: string;
  relativePath: string;
}

export class ContentAddressedObjectStore {
  constructor(private readonly root: string) {}

  private async verify(path: string, hash: string): Promise<void> {
    const existing = await readFile(path);
    const existingHash = createHash("sha256").update(existing).digest("hex");
    if (existingHash !== hash) throw new Error(`Object store corruption detected for ${hash}`);
  }

  async put(data: Uint8Array, mediaType?: string): Promise<StoredObject> {
    const hash = createHash("sha256").update(data).digest("hex");
    const relativePath = join(hash.slice(0, 2), hash.slice(2, 4), hash);
    const absolutePath = join(this.root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    try {
      await stat(absolutePath);
      await this.verify(absolutePath, hash);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
      const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, data, { flag: "wx", mode: 0o600 });
      try { await rename(temporaryPath, absolutePath); } catch (error) {
        // 目标已存在说明另一个并发写入者赢了。POSIX 抛 EEXIST,Windows 上
        // 覆盖已存在文件的 rename 抛的是 EPERM/EACCES —— 只认 EEXIST 会让
        // 并发写同一个对象在 Windows 上直接失败(macOS 上从不复现)。
        // 内容是按 hash 寻址的,赢家的字节必然与我们要写的一致,后面那次
        // verify() 会最终确认,所以这里可以把"目标已存在"一律当成功。
        try { await writeFile(absolutePath, data, { flag: "wx", mode: 0o600 }); } catch { /* another writer won */ }
        try { await unlink(temporaryPath); } catch { /* cleanup best effort */ }
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") throw error;
      }
    }
    await this.verify(absolutePath, hash);
    const info = await stat(absolutePath);
    return { hash, sizeBytes: info.size, mediaType, relativePath };
  }

  async get(hash: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Invalid object hash");
    const path = join(this.root, hash.slice(0, 2), hash.slice(2, 4), hash);
    const data = await readFile(path);
    await this.verify(path, hash);
    return data;
  }

  pathFor(hash: string): string {
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Invalid object hash");
    return join(this.root, hash.slice(0, 2), hash.slice(2, 4), hash);
  }
}
