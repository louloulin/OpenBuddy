// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import WebSocket, { WebSocketServer } from "ws";
import { attachRemoteRelayWebSocket, RemoteRelayServer, verifyRelayCapabilityToken } from "@openbuddy/collaboration-network";
import type { BuddyIdentity } from "@openbuddy/collaboration-protocol";

type WorkerMessage = { type: string; [key: string]: unknown };
type WorkerHandle = { child: ChildProcess; messages: WorkerMessage[]; waitFor: (type: string, timeoutMs?: number) => Promise<WorkerMessage> };
const execFileAsync = promisify(execFile);

const scope = { communityId: "process-community", organizationId: "process-organization", roomId: "process-room" };
const requester: BuddyIdentity = { id: "process-requester", handle: "process-requester", displayName: "Process Requester", ownerUserId: "requester-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
const provider: BuddyIdentity = { id: "process-provider", handle: "process-provider", displayName: "Process Provider", ownerUserId: "provider-user", organizationId: scope.organizationId, trustLevel: "org", status: "idle" };
const relayCapabilitySecret = "process-relay-capability-secret";

async function buildWorker(outDir: string): Promise<string> {
  await execFileAsync(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "build", "--config", resolve("electron/collaboration-process.vite.config.ts")], {
    cwd: process.cwd(),
    env: { ...process.env, OPENBUDDY_PROCESS_WORKER_OUT: outDir },
    maxBuffer: 10 * 1024 * 1024,
  });
  const workerPath = join(outDir, "collaboration-process-worker.mjs");
  if (!existsSync(workerPath)) throw new Error(`worker bundle missing: ${workerPath}`);
  await symlink(resolve("node_modules"), join(outDir, "node_modules"), "junction");
  return workerPath;
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("relay server did not expose a port");
  return address.port;
}

function spawnWorker(workerPath: string, config: unknown, workspace: string): WorkerHandle {
  const child = spawn(process.execPath, [workerPath, JSON.stringify(config)], { cwd: process.cwd(), env: { ...process.env, PI_CODING_AGENT_DIR: workspace }, stdio: ["ignore", "pipe", "pipe"] });
  const messages: WorkerMessage[] = [];
  let buffer = "";
  const waiters = new Map<string, Array<(message: WorkerMessage) => void>>();
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    for (const line of buffer.split(/\r?\n/u).slice(0, -1)) {
      try {
        const message = JSON.parse(line) as WorkerMessage;
        messages.push(message);
        for (const resolveMessage of waiters.get(message.type) ?? []) resolveMessage(message);
        waiters.delete(message.type);
      } catch {
        throw new Error(`worker emitted invalid JSON: ${line}`);
      }
    }
    buffer = buffer.split(/\r?\n/u).at(-1) ?? "";
  });
  const stderr: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  const waitFor = (type: string, timeoutMs = 10_000): Promise<WorkerMessage> => {
    const existing = messages.find((message) => message.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise<WorkerMessage>((resolveMessage, reject) => {
      const timer = setTimeout(() => reject(new Error(`worker timed out waiting for ${type}; messages=${JSON.stringify(messages)} stderr=${stderr.join("")}`)), timeoutMs);
      const resolveOnce = (message: WorkerMessage) => { clearTimeout(timer); resolveMessage(message); };
      const pending = waiters.get(type) ?? [];
      pending.push(resolveOnce);
      waiters.set(type, pending);
    });
  };
  return { child, messages, waitFor };
}

describe("independent Buddy Runtime processes", () => {
  it("completes discovery, award, relay delivery, evidence, and redaction over real WebSocket", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-process-relay-"));
    const workerPath = await buildWorker(join(root, "bundle"));
    const credentials = new Map([["requester-process-token", requester.id], ["provider-process-token", provider.id]]);
    const relayServer = new RemoteRelayServer({
      now: () => "2026-08-30T12:00:00.000Z",
      authorize: (credential) => { if (credentials.get(credential.token) !== credential.subject) throw new Error("invalid process credential"); },
      authorizeScope: (credential, requestedScope) => { if (credentials.get(credential.token) !== credential.subject || requestedScope.communityId !== scope.communityId || requestedScope.organizationId !== scope.organizationId || requestedScope.roomId !== scope.roomId) throw new Error("invalid process scope"); },
      verifyCapability: (token, expected) => verifyRelayCapabilityToken(token, relayCapabilitySecret, expected, "2026-08-30T12:00:00.000Z"),
    });
    const http = createServer();
    const sockets = new WebSocketServer({ noServer: true });
    const cleanups: Array<() => void> = [];
    let providerWorker: WorkerHandle | undefined;
    let requesterWorker: WorkerHandle | undefined;
    http.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, (webSocket) => { cleanups.push(attachRemoteRelayWebSocket(webSocket, relayServer)); }));
    const port = await listen(http);
    const relayUrl = `http://127.0.0.1:${port}`;
    try {
      providerWorker = spawnWorker(workerPath, { role: "provider", relayUrl, relayCapabilitySecret, credential: { subject: provider.id, token: "provider-process-token", expiresAt: "2026-08-30T13:00:00.000Z" }, scope, storagePath: join(root, "provider.events.jsonl"), identity: provider }, join(root, "provider-home"));
      await providerWorker.waitFor("ready");
      requesterWorker = spawnWorker(workerPath, { role: "requester", relayUrl, relayCapabilitySecret, credential: { subject: requester.id, token: "requester-process-token", expiresAt: "2026-08-30T13:00:00.000Z" }, scope, storagePath: join(root, "requester.events.jsonl"), identity: requester, providerIdentity: provider }, join(root, "requester-home"));
      const awarded = await requesterWorker.waitFor("awarded");
      const verified = await providerWorker.waitFor("verified");
      expect(awarded.delivery).toMatchObject({ status: "delivered", providerId: provider.id });
      expect(awarded.executionRef).toMatchObject({ taskId: awarded.taskId, workflowId: `workflow:${awarded.taskId}`, stepId: `step:${awarded.taskId}:root`, memberId: provider.id });
      expect(verified.identity).toBe(provider.id);
      expect(verified.executionRef).toMatchObject({ taskId: awarded.taskId, memberId: provider.id, executionId: `execution:${awarded.taskId}` });
      expect(JSON.stringify(awarded.relayEvents)).not.toContain("private requester objective");
      expect(JSON.stringify(await relayServer.query({ ...scope, taskId: String(awarded.taskId) }))).not.toContain("private requester objective");
      expect(await readFile(join(root, "provider.events.jsonl"), "utf8")).not.toContain("private requester objective");
    } finally {
      providerWorker?.child.kill("SIGTERM");
      requesterWorker?.child.kill("SIGTERM");
      cleanups.forEach((cleanup) => cleanup());
      sockets.close();
      await new Promise<void>((resolvePromise) => http.close(() => resolvePromise()));
    }
  }, 60_000);
});
