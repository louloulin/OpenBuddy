import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BuddyIdentity } from "@openbuddy/collaboration-protocol";

export interface BuddyIdentityFile {
  id: string;
  handle: string;
  displayName: string;
  ownerUserId: string;
  organizationId: string;
  trustLevel: "local" | "org" | "known_peer" | "public";
  status: "idle" | "working" | "offline";
  createdAt: string;
  updatedAt: string;
}

export interface BuddyIdentityPatch {
  handle?: string;
  displayName?: string;
  organizationId?: string;
  status?: "idle" | "working" | "offline";
}

const STORE_FILENAME = "buddy-identity.json";
const DEFAULT_ORG_ID = "local-organization";

/**
 * Main-owned persistent Buddy identity store.
 *
 * - On first launch, mints a stable UUID and persists it under
 *   `${app.getPath("userData")}/openbuddy/buddy-identity.json`.
 * - On subsequent launches, loads the existing identity so the user's
 *   personal handle/display name/ownerUserId survives restarts and
 *   reinstalls of the same userData directory.
 * - `updateIdentity` writes atomically (write to .tmp, rename) and
 *   bumps `updatedAt`; `id` and `ownerUserId` are immutable.
 */
export class BuddyIdentityStore {
  private readonly filePath: string;
  private cache: BuddyIdentityFile | null = null;
  private loadPromise: Promise<void> | null = null;
  private readonly pendingWrites: Promise<void>[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(app.getPath("userData"), "openbuddy", STORE_FILENAME);
  }

  fileLocation(): string {
    return this.filePath;
  }

  loadOrCreate(now: () => Date = () => new Date()): BuddyIdentityFile {
    if (this.cache) return structuredClone(this.cache);
    // Kick off async load on first call; return a sensible fallback so the caller is not blocked.
    this.ensureLoaded(now);
    if (this.cache) return structuredClone(this.cache);
    const created: BuddyIdentityFile = {
      id: `buddy-${randomUUID()}`,
      handle: "me",
      displayName: "我的 Buddy",
      ownerUserId: `user-${randomUUID()}`,
      organizationId: DEFAULT_ORG_ID,
      trustLevel: "local",
      status: "idle",
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    this.cache = created;
    this.persist(created);
    return structuredClone(created);
  }

  private ensureLoaded(now: () => Date): void {
    if (this.loadPromise || this.cache) return;
    this.loadPromise = this.loadFromDisk(now).catch((error) => {
      console.warn("[openbuddy] failed to load buddy identity store", error);
    });
  }

  private async loadFromDisk(now: () => Date): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      // File missing: leave cache null; loadOrCreate will mint a new identity.
      return;
    }
    let parsed: Partial<BuddyIdentityFile>;
    try {
      parsed = JSON.parse(raw) as Partial<BuddyIdentityFile>;
    } catch {
      const corruptPath = `${this.filePath}.corrupt.${now().getTime()}`;
      try { await rename(this.filePath, corruptPath); } catch { /* ignore */ }
      return;
    }
    if (this.hasRequiredFields(parsed)) {
      try {
        this.cache = this.validate(parsed);
      } catch (error) {
        console.warn("[openbuddy] buddy identity validation failed", error);
        return;
      }
      return;
    }
    const corruptPath = `${this.filePath}.incomplete.${now().getTime()}`;
    try { await rename(this.filePath, corruptPath); } catch { /* ignore */ }
  }

  updateIdentity(patch: BuddyIdentityPatch, now: () => Date = () => new Date()): BuddyIdentityFile {
    const current = this.loadOrCreate(now);
    const next: BuddyIdentityFile = {
      ...current,
      ...(patch.handle !== undefined ? { handle: patch.handle.trim() || current.handle } : {}),
      ...(patch.displayName !== undefined ? { displayName: patch.displayName.trim() || current.displayName } : {}),
      ...(patch.organizationId !== undefined ? { organizationId: patch.organizationId.trim() || current.organizationId } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: now().toISOString(),
    };
    if (next.handle === current.handle && next.displayName === current.displayName && next.organizationId === current.organizationId && next.status === current.status) {
      return structuredClone(current);
    }
    this.persist(next);
    this.cache = next;
    return structuredClone(next);
  }

  toBuddyIdentity(file: BuddyIdentityFile = this.loadOrCreate()): BuddyIdentity {
    return {
      id: file.id,
      handle: file.handle,
      displayName: file.displayName,
      ownerUserId: file.ownerUserId,
      organizationId: file.organizationId,
      trustLevel: file.trustLevel,
      status: file.status,
    };
  }

  private hasRequiredFields(parsed: Partial<BuddyIdentityFile>): boolean {
    return typeof parsed.id === "string" && Boolean(parsed.id)
      && typeof parsed.handle === "string" && Boolean(parsed.handle)
      && typeof parsed.displayName === "string" && Boolean(parsed.displayName)
      && typeof parsed.ownerUserId === "string" && Boolean(parsed.ownerUserId)
      && typeof parsed.organizationId === "string" && Boolean(parsed.organizationId)
      && typeof parsed.createdAt === "string" && Boolean(parsed.createdAt)
      && typeof parsed.updatedAt === "string" && Boolean(parsed.updatedAt);
  }

  private persist(file: BuddyIdentityFile): void {
    const tmpPath = `${this.filePath}.tmp.${randomUUID()}`;
    const write = this.writeChain
      .then(() => mkdir(dirname(this.filePath), { recursive: true }))
      .then(() => writeFile(tmpPath, JSON.stringify(file, null, 2), "utf8"))
      .then(() => rename(tmpPath, this.filePath))
      .catch((error) => {
        console.warn("[openbuddy] failed to persist buddy identity", error);
      });
    this.writeChain = write;
    this.pendingWrites.push(write);
  }

  async flush(): Promise<void> {
    // Kick off load if it hasn't started yet, then wait for it to settle.
    if (!this.cache && !this.loadPromise) {
      this.loadPromise = this.loadFromDisk(() => new Date()).catch((error) => {
        console.warn("[openbuddy] failed to load buddy identity store", error);
      });
    }
    if (this.loadPromise) {
      try { await this.loadPromise; } catch { /* logged */ }
    }
    await this.writeChain;
    await Promise.all(this.pendingWrites.splice(0));
  }

  private validate(parsed: Partial<BuddyIdentityFile>): BuddyIdentityFile {
    if (typeof parsed.id !== "string" || !parsed.id) throw new Error("buddy identity: id is required");
    if (typeof parsed.handle !== "string" || !parsed.handle) throw new Error("buddy identity: handle is required");
    if (typeof parsed.displayName !== "string" || !parsed.displayName) throw new Error("buddy identity: displayName is required");
    if (typeof parsed.ownerUserId !== "string" || !parsed.ownerUserId) throw new Error("buddy identity: ownerUserId is required");
    if (typeof parsed.organizationId !== "string" || !parsed.organizationId) throw new Error("buddy identity: organizationId is required");
    if (parsed.trustLevel !== "local" && parsed.trustLevel !== "org" && parsed.trustLevel !== "known_peer" && parsed.trustLevel !== "public") {
      throw new Error("buddy identity: trustLevel is invalid");
    }
    if (parsed.status !== "idle" && parsed.status !== "working" && parsed.status !== "offline") {
      throw new Error("buddy identity: status is invalid");
    }
    if (typeof parsed.createdAt !== "string" || !parsed.createdAt) throw new Error("buddy identity: createdAt is required");
    if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) throw new Error("buddy identity: updatedAt is required");
    return {
      id: parsed.id,
      handle: parsed.handle,
      displayName: parsed.displayName,
      ownerUserId: parsed.ownerUserId,
      organizationId: parsed.organizationId,
      trustLevel: parsed.trustLevel,
      status: parsed.status,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  }
}

let sharedStore: BuddyIdentityStore | null = null;
export function sharedBuddyIdentityStore(): BuddyIdentityStore {
  if (!sharedStore) sharedStore = new BuddyIdentityStore();
  return sharedStore;
}

/** Reset the shared singleton (used in tests). */
export function resetBuddyIdentityStore(): void {
  sharedStore = null;
}
