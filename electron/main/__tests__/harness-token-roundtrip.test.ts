import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultHarnessTokenPath,
  resolveHarnessAuthToken,
} from "../harness/harness-token";
import {
  HarnessRpcRevisionConflict,
  HarnessRpcStore,
  defaultHarnessRpcCachePath,
  harnessRpcIdentity,
} from "../harness/harness-rpc-store";
import {
  issueHarnessRecoveryClaim,
  verifyHarnessRecoveryClaim,
} from "../harness/harness-recovery-token";

let tempDir = "";

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "agent-harness-roundtrip-"));
  process.env.PI_CODING_AGENT_DIR = tempDir;
  process.env.PI_HOME = tempDir;
});

afterAll(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_HOME;
  await rm(tempDir, { recursive: true, force: true });
});

describe("Agent harness token + RPC store + recovery claim roundtrip", () => {
  let nextEnvOverride: string | undefined;

  beforeEach(() => {
    nextEnvOverride = undefined;
  });
  afterEach(() => {
    delete process.env.OPENBUDDY_HARNESS_TOKEN;
    nextEnvOverride = undefined;
  });

  it("issues a fresh identity token when no env override or persisted file exists", async () => {
    const token = await resolveHarnessAuthToken({ path: join(tempDir, "agent-tokens", "openbuddy-harness-token") });
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,256}$/);
    const stat1 = await stat(join(tempDir, "agent-tokens", "openbuddy-harness-token"));
    const mode = stat1.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("reuses the same token across invocations of resolveHarnessAuthToken", async () => {
    const path = join(tempDir, "reuse", "openbuddy-harness-token");
    const first = await resolveHarnessAuthToken({ path });
    const second = await resolveHarnessAuthToken({ path });
    expect(first).toBe(second);
  });

  it("env token overrides persisted identity", async () => {
    const path = join(tempDir, "env-override", "openbuddy-harness-token");
    await resolveHarnessAuthToken({ path });
    const envToken = "env-token-override-1234567890";
    const observed = await resolveHarnessAuthToken({ envToken, path });
    expect(observed).toBe(envToken);
  });

  it("persists tokens with 0o600 mode even on subsequent writes", async () => {
    const path = join(tempDir, "perm", "openbuddy-harness-token");
    await resolveHarnessAuthToken({ path });
    await writeFile(path, "short", { encoding: "utf8", mode: 0o644 });
    await chmod(path, 0o644);
    const recovered = await resolveHarnessAuthToken({ path });
    expect(recovered).toMatch(/^[A-Za-z0-9_-]{20,256}$/);
    expect(recovered).not.toBe("short");
    const stat2 = await stat(path);
    expect(stat2.mode & 0o777).toBe(0o600);
  });

  it("defaultHarnessTokenPath returns a stable location inside PI_CODING_AGENT_DIR", () => {
    const path = defaultHarnessTokenPath();
    expect(path.startsWith(tempDir)).toBe(true);
    expect(path).toMatch(/openbuddy-harness-token$/);
  });

  it("defaultHarnessRpcCachePath also resolves into PI_CODING_AGENT_DIR", () => {
    const path = defaultHarnessRpcCachePath();
    expect(path.startsWith(tempDir)).toBe(true);
    expect(path).toMatch(/openbuddy-harness-rpc-cache\.json$/);
  });

  it("harnessRpcIdentity is deterministic and stable", () => {
    const a = harnessRpcIdentity("token-a");
    const b = harnessRpcIdentity("token-a");
    const c = harnessRpcIdentity("token-b");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("HarnessRpcStore persists entries atomically and reads them back", async () => {
    const path = join(tempDir, "rpc-cache-1.json");
    const store = new HarnessRpcStore(path, harnessRpcIdentity("token-a"));
    const expiresAt = Date.now() + 60_000;
    await store.write([{ rpcId: "rpc-1", fingerprint: "fp-1", expiresAt, result: { ok: true, value: { answer: 42 } } }]);
    const read = await store.read();
    expect(read).toEqual([{ rpcId: "rpc-1", fingerprint: "fp-1", expiresAt: expect.any(Number), result: { ok: true, value: { answer: 42 } } }]);
    // Also verify the file exists with mode 0o600
    const fileStat = await stat(path);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it("HarnessRpcStore drops expired entries on read", async () => {
    const path = join(tempDir, "rpc-cache-expired.json");
    const store = new HarnessRpcStore(path, harnessRpcIdentity("token-a"));
    const past = Date.now() - 1;
    await store.write([{ rpcId: "rpc-old", fingerprint: "fp", expiresAt: past, result: { ok: true, value: 1 } }]);
    const read = await store.read();
    expect(read).toEqual([]);
  });

  it("HarnessRpcStore refuses writes that conflict with the current revision", async () => {
    const path = join(tempDir, "rpc-cache-rev.json");
    const store = new HarnessRpcStore(path, harnessRpcIdentity("token-a"), { lockTtlMs: 1000, lockRetryMs: 5, lockWaitMs: 1000 });
    const initialRevision = await store.writeState([], []);
    await store.writeState([{ rpcId: "rpc-a", fingerprint: "fp", expiresAt: Date.now() + 60_000, result: { ok: true, value: 1 } }], []);
    const revisionNow = await store.readState();
    expect(revisionNow.revision).toBe(initialRevision + 1);
    await expect(store.writeState(
      [{ rpcId: "rpc-b", fingerprint: "fp", expiresAt: Date.now() + 60_000, result: { ok: true, value: 2 } }],
      [],
      initialRevision,
    )).rejects.toBeInstanceOf(HarnessRpcRevisionConflict);
  });

  it("HarnessRpcStore writeState increments revision monotonically across calls", async () => {
    const path = join(tempDir, "rpc-cache-mono.json");
    const store = new HarnessRpcStore(path, harnessRpcIdentity("token-mono"));
    const r1 = await store.writeState([], []);
    const r2 = await store.writeState([], []);
    const r3 = await store.writeState([], []);
    expect(r2).toBe(r1 + 1);
    expect(r3).toBe(r2 + 1);
  });

  it("harness recovery claim survives a full sign/verify cycle alongside the RPC store", async () => {
    const identity = harnessRpcIdentity("token-recovery");
    const rpcStorePath = join(tempDir, "rpc-cache-recovery.json");
    const store = new HarnessRpcStore(rpcStorePath, identity);
    const expiresAt = Date.now() + 60_000;
    await store.write([{ rpcId: "rpc-recover", fingerprint: "fp-recover", expiresAt, result: { ok: true, value: { hello: "world" } } }]);
    const cached = await store.read();
    expect(cached).toHaveLength(1);
    const claimToken = issueHarnessRecoveryClaim("secret-shared-with-claimant", identity, {
      rpcId: cached[0]!.rpcId,
      fingerprint: cached[0]!.fingerprint,
      claimant: "loopback-ui",
      authority: "loopback",
    }, 60_000);
    const claim = verifyHarnessRecoveryClaim(claimToken, "secret-shared-with-claimant", identity, Date.now() + 1_000, "loopback");
    expect(claim).toMatchObject({
      rpcId: "rpc-recover",
      fingerprint: "fp-recover",
      claimant: "loopback-ui",
      authority: "loopback",
    });
  });

  it("rejects recovery claims forged with a wrong shared secret", async () => {
    const identity = harnessRpcIdentity("token-forge");
    const claimToken = issueHarnessRecoveryClaim("real-secret", identity, {
      rpcId: "rpc-forge",
      fingerprint: "fp",
      claimant: "ui",
      authority: "loopback",
    }, 60_000);
    expect(verifyHarnessRecoveryClaim(claimToken, "wrong-secret", identity, Date.now() + 1_000)).toBeUndefined();
  });
});
