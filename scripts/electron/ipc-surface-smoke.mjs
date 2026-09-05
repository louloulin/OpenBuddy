import { _electron as electron } from "playwright";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-ipc-surface-smoke-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), JSON.stringify({ providers: {} }, null, 2) + "\n", { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), "{}\n", { mode: 0o600 });

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const safeError = (error) => String(error?.message ?? error ?? "unknown error").slice(0, 500);
const checks = [];
let app;
let passed = false;

// Machine-readable coverage for the dynamic invoke wrapper below. The surface
// audit consumes this declaration instead of guessing from the wrapper call.
const ipcSurfaceChannels = [
  "agent:init",
  "agent:plugin-readiness",
  "collaboration:propose-task",
  "collaboration:ack-inbox",
  "collaboration:organization-member",
  "collaboration:propose",
  "collaboration:room-member-add",
  "collaboration:room-member-remove",
  "collaboration:delegation-grant",
  "collaboration:delegation-revoke",
  "collaboration:approval-request",
  "collaboration:approval-decide",
  "collaboration:side-effect-create",
  "collaboration:side-effect-approve",
  "collaboration:side-effect-complete",
  "collaboration:side-effect-cancel",
  "collaboration:task-control",
  "collaboration:workflow-propose",
  "collaboration:workflow-status",
  "collaboration:workflow-execute",
  "collaboration:snapshot",
  "collaboration:network-peer",
  "collaboration:network-trust",
  "collaboration:network-trust-root-add",
  "collaboration:network-trust-root-revoke",
  "collaboration:network-offer",
  "collaboration:network-proposal",
  "collaboration:network-negotiate",
  "collaboration:network-agreement-revoke",
];

async function check(name, run) {
  try {
    checks.push({ name, ok: true, result: await run() });
  } catch (error) {
    checks.push({ name, ok: false, error: safeError(error), errorDigest: digest(safeError(error)) });
  }
}

try {
  const electronPath = process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron");
  app = await electron.launch({
    args: [root, `--user-data-dir=${userData}`],
    executablePath: electronPath,
    cwd: root,
    timeout: 30_000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "",
      PI_CODING_AGENT_DIR: piAgentDir,
      OPENBUDDY_DEBUG_UI: "0",
      OPENBUDDY_FILESYSTEM_SMOKE: "0",
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  const invoke = (channel, args) => page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });

  const init = await invoke("agent:init");
  if (init?.ok !== true) throw new Error("agent:init failed");

  await check("plugin-readiness", async () => {
    const readiness = await invoke("agent:plugin-readiness");
    if (!readiness || typeof readiness.phase !== "string" || !Number.isInteger(readiness.generation)) throw new Error("invalid plugin readiness");
    return { phase: readiness.phase, generation: readiness.generation, hasError: Boolean(readiness.error) };
  });

  await check("task-inbox-ack", async () => {
    const proposed = await invoke("collaboration:propose-task", {
      title: "IPC surface task",
      objective: "验证协作任务经由真实 preload IPC 生命周期",
      capability: "ipc-surface",
    });
    if (proposed.status !== "proposed" || !proposed.taskId || !proposed.eventId) throw new Error("task proposal failed");
    const acknowledged = await invoke("collaboration:ack-inbox", { eventId: proposed.eventId });
    if (!acknowledged.acknowledgedEventIds?.includes(proposed.eventId)) throw new Error("inbox acknowledgement failed");
    return { task: digest(proposed.taskId), event: digest(proposed.eventId), acknowledged: true };
  });

  await check("side-effect-intent-boundary", async () => {
    const pending = await invoke("collaboration:side-effect-create", {
      capability: "ipc-surface",
      action: "external:send",
      summary: "IPC surface approved side effect",
      fingerprint: `ipc-surface-approved-${Date.now()}`,
    });
    if (pending.status !== "pending" || !pending.intentId || !pending.approvalId) throw new Error("pending side-effect intent failed");
    try {
      await invoke("collaboration:side-effect-approve", { intentId: pending.intentId });
      throw new Error("side-effect intent approved without organization approval");
    } catch (error) {
      if (!/approval is not granted/i.test(String(error?.message ?? error))) throw error;
    }
    await invoke("collaboration:approval-decide", { approvalId: pending.approvalId, approved: true, reason: "IPC surface accepted" });
    const approved = await invoke("collaboration:snapshot");
    if (!approved.sideEffectIntents?.some((intent) => intent.intentId === pending.intentId && intent.status === "approved")) throw new Error("side-effect approval state missing");
    try {
      await invoke("collaboration:side-effect-complete", { intentId: pending.intentId, receipt: "not-consumed" });
      throw new Error("unconsumed side-effect intent completed");
    } catch (error) {
      if (!/cannot complete|consumed|status/i.test(String(error?.message ?? error))) throw error;
    }
    const cancellable = await invoke("collaboration:side-effect-create", {
      capability: "ipc-surface",
      action: "external:send",
      summary: "IPC surface cancellable side effect",
      fingerprint: `ipc-surface-pending-${Date.now()}`,
    });
    if (cancellable.status !== "pending" || !cancellable.intentId) throw new Error("cancellable side-effect intent failed");
    const cancelled = await invoke("collaboration:side-effect-cancel", { intentId: cancellable.intentId, reason: "IPC surface cleanup" });
    if (cancelled.status !== "cancelled") throw new Error("side-effect cancellation failed");
    return { approved: digest(pending.intentId), completedBeforeConsume: false, cancelled: digest(cancelled.intentId) };
  });

  await check("organization-room-delegation-approval-control", async () => {
    const memberId = `ipc-surface-member-${Date.now()}`;
    const member = await invoke("collaboration:organization-member", {
      id: memberId,
      handle: "ipc-surface-member",
      displayName: "IPC Surface Member",
      ownerUserId: "ipc-surface-owner",
      role: "member",
    });
    const task = await invoke("collaboration:propose", {
      mode: "organization",
      title: "IPC organization task",
      objective: "验证组织授权与审批的真实 IPC 生命周期",
      capability: "ipc-surface",
      projectId: `ipc-surface-project-${Date.now()}`,
    });
    const roomMember = await invoke("collaboration:room-member-add", { roomId: task.roomId, principalId: memberId, role: "agent" });
    const delegation = await invoke("collaboration:delegation-grant", {
      granteeId: memberId,
      taskId: task.taskId,
      roomId: task.roomId,
      allowedCapabilities: ["ipc-surface"],
      allowedDataScopes: [`room:${task.roomId}`],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const approval = await invoke("collaboration:approval-request", { taskId: task.taskId, actions: ["external:send"], reason: "IPC surface approval" });
    const decided = await invoke("collaboration:approval-decide", { approvalId: approval.id, approved: true, reason: "IPC surface accepted" });
    const controlled = await invoke("collaboration:task-control", { taskId: task.taskId, action: "takeover", reason: "IPC surface control" });
    const removed = await invoke("collaboration:room-member-remove", { roomId: task.roomId, principalId: memberId });
    const revoked = await invoke("collaboration:delegation-revoke", { delegationId: delegation.id });
    if (member.identity?.id !== memberId || roomMember.active !== true || decided.status !== "approved" || controlled.state !== "taken_over" || removed.active !== false || !revoked.revokedAt) {
      throw new Error("organization lifecycle assertion failed");
    }
    return { member: digest(memberId), task: digest(task.taskId), room: digest(task.roomId), approval: digest(approval.id), delegated: true, revoked: true };
  });

  await check("workflow-propose-status-execute", async () => {
    const workflow = await invoke("collaboration:workflow-propose", {
      title: "IPC surface workflow",
      mode: "personal",
      nodes: [{ id: "surface-node", title: "Surface node", objective: "验证工作流节点经由 preload IPC" }],
    });
    const status = await invoke("collaboration:workflow-status", { workflowId: workflow.workflowId });
    const executed = await invoke("collaboration:workflow-execute", { workflowId: workflow.workflowId });
    if (workflow.status !== "proposed" || status.workflowId !== workflow.workflowId || executed.workflowId !== workflow.workflowId || !["accepted", "failed", "blocked"].includes(executed.status)) throw new Error("workflow lifecycle assertion failed");
    return { workflow: digest(workflow.workflowId), nodeCount: workflow.nodes.length, terminal: executed.status };
  });

  await check("network-peer-trust-and-roots", async () => {
    const snapshot = await invoke("collaboration:snapshot");
    const peerId = `ipc-surface-peer-${Date.now()}`;
    const capabilityId = `ipc-surface-capability-${Date.now()}`;
    const validUntil = new Date(Date.now() + 3_600_000).toISOString();
    const capability = {
      id: capabilityId,
      providerId: peerId,
      description: "IPC surface capability",
      inputSchema: {},
      outputSchema: {},
      procedure: [],
      allowedDataScopes: ["public:brief"],
      forbiddenDataScopes: ["private:vault"],
      allowedActions: ["read:public"],
      forbiddenActions: ["external:send"],
      acceptanceTests: [],
      requiredApproval: "never",
      allowDelegation: false,
      maxDelegationDepth: 0,
      visibility: "directory",
    };
    await invoke("collaboration:network-peer", { identity: { id: peerId, handle: "ipc-surface-peer", displayName: "IPC Surface Peer", ownerUserId: peerId, organizationId: snapshot.identity.organizationId, trustLevel: "known_peer", status: "idle" }, capabilities: [capability] });
    await invoke("collaboration:network-trust", { peerId, trust: "trusted" });
    await invoke("collaboration:network-offer", { providerId: peerId, capabilityId, title: "IPC surface offer", description: "IPC surface network lifecycle", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil, visibility: "known_peers" });
    const proposalMutation = await invoke("collaboration:network-proposal", { capabilityId, objective: "IPC surface network proposal", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: validUntil });
    const proposal = proposalMutation.value ?? proposalMutation;
    const afterProposal = await invoke("collaboration:snapshot");
    const offer = afterProposal.network?.offers?.find((entry) => entry.providerId === peerId && entry.capabilityId === capabilityId);
    if (!offer) throw new Error("network offer missing");
    const negotiatedMutation = await invoke("collaboration:network-negotiate", { offerId: offer.id, proposalId: proposal.id, providerId: peerId });
    const agreement = negotiatedMutation.value ?? negotiatedMutation;
    const revokedMutation = await invoke("collaboration:network-agreement-revoke", { agreementId: agreement.id, reason: "IPC surface cleanup" });
    const revoked = revokedMutation.value ?? revokedMutation;
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const root = await invoke("collaboration:network-trust-root-add", { publicKeyPem });
    const roots = await invoke("collaboration:network-trust-root-revoke", { keyRef: root.keyRef });
    if (agreement.status !== "accepted" || revoked.status !== "revoked" || !roots.some((entry) => entry.keyRef === root.keyRef && entry.revokedAt)) throw new Error(`network lifecycle assertion failed: ${JSON.stringify({ agreement, revoked, root, roots })}`);
    return { peer: digest(peerId), capability: digest(capabilityId), offer: digest(offer.id), agreement: digest(agreement.id), trustRoot: digest(root.keyRef), revoked: true };
  });

  const failed = checks.filter((check) => !check.ok);
  const report = {
    framework: "openbuddy-electron-ipc-surface-smoke",
    schema: "openbuddy.redacted-evidence.v1",
    evidenceLevel: "real-local",
    runtime: "electron+pi",
    realE2E: true,
    capabilities: ["plugin-readiness", "collaboration", "organization", "workflow", "network"],
    filesystem: "not-run-by-policy",
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
  const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR;
  const evidenceArtifact = evidenceRoot ? join(evidenceRoot, "ipc-surface.json") : null;
  if (evidenceArtifact) {
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(evidenceArtifact, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  passed = failed.length === 0;
  console.log(JSON.stringify({ ...report, evidenceArtifact }, null, 2));
  process.exit(passed ? 0 : 1);
} catch (error) {
  console.error(`[ipc-surface] ${safeError(error)}`);
  process.exit(1);
} finally {
  await Promise.race([app?.close?.(), new Promise((resolve) => setTimeout(resolve, 3_000))]).catch(() => undefined);
  try { rmSync(userData, { recursive: true, force: true }); } catch {}
}
