// Real Electron Main capability-surface audit.
// This runner deliberately excludes filesystem smoke. It talks to the live
// Harness RPC endpoint, so the checks cross Electron Main and the typed RPC
// boundary instead of replacing it with renderer mocks.
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const baseUrl = (process.env.OPENBUDDY_HARNESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.OPENBUDDY_HARNESS_TOKEN ?? "";
const apiKey = process.env.OPENBUDDY_E2E_API_KEY ?? "";
const providerBaseUrl = process.env.OPENBUDDY_E2E_BASE_URL ?? "";
const modelId = process.env.OPENBUDDY_E2E_MODEL_ID ?? "";
if (process.env.OPENBUDDY_E2E_REQUIRED !== "1" || !apiKey || !providerBaseUrl || !modelId || !baseUrl || !token) {
  console.error("real-capability-surface requires complete Electron Harness and provider configuration");
  process.exit(2);
}

const digest = (value) => typeof value === "string" && value
  ? createHash("sha256").update(value).digest("hex").slice(0, 12)
  : null;
const encoded = (value) => {
  try { return JSON.stringify(value); } catch { return String(value); }
};
const safeError = (error) => String(error?.message ?? error ?? "unknown error")
  .split(apiKey).join("[redacted-api-key]")
  .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]")
  .slice(0, 400);

function rpc(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}/api/${method}`);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const body = JSON.stringify({ type: "client-request", rpcId: `surface-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, method, payload });
    const request = transport(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, connection: "close" }, agent: false }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(text)); } catch { reject(new Error(`non-JSON response from ${method}`)); }
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function value(response, label) {
  if (!response?.result?.ok) throw new Error(`${label} failed: ${response?.result?.error?.message ?? "unknown RPC error"}`);
  return response.result.value;
}

function admin(action, payload = {}) {
  return rpc("capability.collaboration-admin", { action, ...payload });
}

async function check(name, run) {
  try { return { name, ok: true, result: await run() }; }
  catch (error) { return { name, ok: false, error: safeError(error), errorDigest: digest(safeError(error)) }; }
}

const checks = [];
checks.push(await check("runtime-descriptor", async () => {
  const descriptor = value(await rpc("host.describe"), "host.describe");
  if (descriptor.product !== "OpenBuddy" || descriptor.runtime !== "pi") throw new Error("unexpected runtime descriptor");
  return { product: descriptor.product, runtime: descriptor.runtime, pluginHost: descriptor.pluginHost };
}));

checks.push(await check("plugin-readiness", async () => {
  const readiness = value(await rpc("capability.plugins", { action: "readiness" }), "agent.plugin-readiness");
  if (!readiness || typeof readiness.phase !== "string" || !Number.isInteger(readiness.generation)) throw new Error("invalid plugin readiness projection");
  return { phase: readiness.phase, generation: readiness.generation, hasError: Boolean(readiness.error) };
}));

checks.push(await check("clipboard-chinese-multiline-large", async () => {
  const text = `OpenBuddy 粘贴验证\n第二行\n${"长文本-".repeat(512)}`;
  value(await rpc("capability.clipboard", { action: "write", text }), "clipboard.write");
  const read = value(await rpc("capability.clipboard", { action: "read" }), "clipboard.read");
  if (read !== text) throw new Error("clipboard round-trip changed text");
  return { length: text.length, digest: digest(text), chinese: read.includes("粘贴"), multiline: read.includes("\n") };
}));

checks.push(await check("collaboration-task-inbox-ack", async () => {
  const before = value(await rpc("capability.collaboration", { action: "snapshot" }), "collaboration.snapshot.before");
  const proposed = value(await rpc("capability.collaboration", {
    action: "propose-task",
    title: "Electron capability surface",
    objective: "验证 Pi 专家协作任务在真实 Electron Main 中可观察。",
    capability: "capability-surface",
  }), "collaboration.propose-task");
  if (proposed.status !== "proposed" || !proposed.taskId || !proposed.eventId) throw new Error("task proposal was not accepted");
  const after = value(await rpc("capability.collaboration", { action: "snapshot" }), "collaboration.snapshot.after");
  if (!after.tasks.some((task) => task.taskId === proposed.taskId)) throw new Error(`proposed task missing from snapshot: ${JSON.stringify(after.tasks.slice(0, 5))}`);
  const ack = value(await rpc("capability.collaboration", { action: "ack-inbox", eventId: proposed.eventId }), "collaboration.ack-inbox");
  if (!ack.acknowledgedEventIds?.includes(proposed.eventId)) throw new Error("inbox acknowledgement was not persisted");
  return { protocol: after.protocol, rooms: after.rooms.length, task: digest(proposed.taskId), event: digest(proposed.eventId), priorTasks: before.tasks.length, acknowledged: true };
}));

checks.push(await check("organization-room-delegation-approval-control", async () => {
  const memberId = `surface-member-${Date.now()}`;
  const member = value(await admin("org-member", {
    id: memberId,
    handle: "surface-member",
    displayName: "Capability Surface Member",
    ownerUserId: "surface-owner",
    role: "member",
  }), "collaboration.organization-member");
  if (member.identity?.id !== memberId || member.active !== true) throw new Error("organization member was not created");

  const workflowSeed = value(await admin("propose", {
    mode: "organization",
    title: "Capability surface organization task",
    objective: "验证组织成员、项目房间、授权、审批和任务控制均穿过真实 Main IPC。",
    capability: "general",
    projectId: `surface-project-${Date.now()}`,
  }), "collaboration.propose");
  if (workflowSeed.status !== "proposed" || !workflowSeed.taskId || !workflowSeed.roomId) throw new Error("organization task was not proposed");

  const roomMember = value(await admin("room-add", {
    roomId: workflowSeed.roomId,
    principalId: memberId,
    role: "agent",
  }), "collaboration.room-member-add");
  if (roomMember.principalId !== memberId || roomMember.active !== true) throw new Error("room member was not added");

  const delegation = value(await admin("delegation-grant", {
    granteeId: memberId,
    taskId: workflowSeed.taskId,
    roomId: workflowSeed.roomId,
    allowedCapabilities: ["general"],
    allowedDataScopes: [`room:${workflowSeed.roomId}`],
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  }), "collaboration.delegation-grant");
  if (!delegation.id || delegation.granteeId !== memberId) throw new Error("delegation was not granted");

  const approval = value(await admin("approval-request", {
    taskId: workflowSeed.taskId,
    actions: ["external:send"],
    reason: "真实 Main IPC capability surface approval",
  }), "collaboration.approval-request");
  const decided = value(await admin("approval-decide", {
    approvalId: approval.id,
    approved: true,
    reason: "surface acceptance",
  }), "collaboration.approval-decide");
  if (decided.status !== "approved") throw new Error("approval was not approved");

  const controlled = value(await admin("task-control", {
    taskId: workflowSeed.taskId,
    control: "takeover",
    reason: "surface control transition",
  }), "collaboration.task-control");
  if (controlled.state !== "taken_over") throw new Error("task takeover was not projected");
  const revokedMember = value(await admin("room-remove", { roomId: workflowSeed.roomId, principalId: memberId }), "collaboration.room-member-remove");
  if (revokedMember.principalId !== memberId || revokedMember.active !== false) throw new Error("room member was not removed");
  const revokedDelegation = value(await admin("delegation-revoke", { delegationId: delegation.id }), "collaboration.delegation-revoke");
  if (!revokedDelegation.revokedAt) throw new Error("delegation revocation was not persisted");
  return { member: digest(memberId), task: digest(workflowSeed.taskId), room: digest(workflowSeed.roomId), approval: digest(approval.id), delegation: digest(delegation.id), transitions: ["member-added", "room-added", "delegated", "approved", "taken-over", "room-removed", "delegation-revoked"] };
}));

checks.push(await check("workflow-propose-execute-control", async () => {
  const workflow = value(await admin("workflow-propose", {
    title: "Capability surface workflow",
    mode: "personal",
    nodes: [{ id: "surface-node", title: "Surface node", objective: "执行真实个人 Buddy 能力节点" }],
  }), "collaboration.workflow-propose");
  if (workflow.status !== "proposed" || workflow.nodes?.length !== 1) throw new Error("workflow was not proposed");
  const status = value(await admin("workflow-status", { workflowId: workflow.workflowId }), "collaboration.workflow-status");
  if (status.workflowId !== workflow.workflowId) throw new Error("workflow status lookup mismatch");
  const executed = value(await admin("workflow-execute", { workflowId: workflow.workflowId }), "collaboration.workflow-execute");
  if (executed.workflowId !== workflow.workflowId || !["accepted", "failed", "blocked"].includes(executed.status)) throw new Error("workflow execution returned an invalid terminal state");
  return { workflow: digest(workflow.workflowId), nodeCount: workflow.nodes.length, proposed: status.status, terminal: executed.status };
}));

checks.push(await check("network-peer-trust-offer-bid-award", async () => {
  const snapshot = value(await admin("snapshot"), "collaboration.snapshot.network");
  const peerId = `surface-peer-${Date.now()}`;
  const capabilityId = `surface-research-${Date.now()}`;
  const peerCapability = {
    id: capabilityId,
    providerId: peerId,
    description: "公开 capability surface research",
    inputSchema: {},
    outputSchema: {},
    procedure: [],
    allowedDataScopes: ["public:brief"],
    forbiddenDataScopes: ["private:vault"],
    allowedActions: ["read:public", "write:artifact"],
    forbiddenActions: ["external:send"],
    acceptanceTests: [],
    requiredApproval: "never",
    allowDelegation: false,
    maxDelegationDepth: 0,
    visibility: "directory",
  };
  await admin("network-peer", {
    identity: { id: peerId, handle: "surface-peer", displayName: "Surface Peer", ownerUserId: "surface-peer-owner", organizationId: snapshot.identity.organizationId, trustLevel: "known_peer", status: "idle" },
    capabilities: [peerCapability],
  });
  await admin("network-trust", { peerId, trust: "trusted" });
  const validUntil = new Date(Date.now() + 60 * 60_000).toISOString();
  await admin("network-offer", { providerId: peerId, capabilityId, title: "Surface offer", description: "公开验证服务", acceptedDataScopes: ["public:brief"], acceptedArtifactTypes: ["brief"], approval: "never", validUntil, visibility: "known_peers" });
  const networkProposalMutation = value(await admin("network-proposal", { capabilityId, objective: "公开 capability surface network proposal", dataScopes: ["public:brief"], artifactTypes: ["brief"], expiresAt: validUntil }), "collaboration.network-proposal");
  const networkProposal = networkProposalMutation?.value ?? networkProposalMutation;
  const networkState = value(await admin("snapshot"), "collaboration.snapshot.network-after-proposal").network;
  const offer = networkState.offers.find((candidate) => candidate.providerId === peerId && candidate.capabilityId === capabilityId);
  if (!offer) throw new Error("network offer was not projected");
  await admin("network-bid", { offerId: offer.id, proposalId: networkProposal.id, providerId: peerId, message: "surface bid", acceptedDataScopes: ["public:brief"], validUntil });
  const withBid = value(await admin("snapshot"), "collaboration.snapshot.network-after-bid").network;
  const bid = withBid.bids.find((candidate) => candidate.offerId === offer.id && candidate.proposalId === networkProposal.id);
  if (!bid) throw new Error("network bid was not projected");
  const awarded = value(await admin("network-award", { bidId: bid.id }), "collaboration.network-award");
  if (awarded.awardStatus !== "awarded" || !["pending_delivery", "delivered", "failed"].includes(awarded.status)) throw new Error("network award returned an invalid delivery state");
  return { peer: digest(peerId), capability: digest(capabilityId), offer: digest(offer.id), proposal: digest(networkProposal.id), bid: digest(bid.id), delivery: awarded.status };
}));

checks.push(await check("network-trust-root-lifecycle", async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const added = value(await admin("network-trust-root-add", { publicKeyPem }), "collaboration.network-trust-root-add");
  if (!added.keyRef) throw new Error("trust root was not added");
  const revoked = value(await admin("network-trust-root-revoke", { keyRef: added.keyRef }), "collaboration.network-trust-root-revoke");
  if (!revoked.some((root) => root.keyRef === added.keyRef && root.revokedAt)) throw new Error("trust root was not revoked");
  return { keyRef: digest(added.keyRef), added: true, revoked: true };
}));

checks.push(await check("a2a-submit-get-and-security", async () => {
  const snapshot = value(await admin("snapshot"), "collaboration.snapshot.a2a");
  const card = value(await admin("a2a-card"), "collaboration.a2a-agent-card");
  if (card.metadata?.openbuddy?.identityId !== snapshot.identity.id) throw new Error("A2A card identity mismatch");
  const id = `surface-a2a-${Date.now()}`;
  const request = { id, skillId: "surface-research", objective: "A2A public capability surface request", sender: snapshot.identity, dataScopes: ["room:personal-room"], allowedActions: ["read:artifact"], approval: "never", artifactTypes: ["brief"], expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), nonce: `surface-nonce-${Date.now()}` };
  const submitted = value(await admin("a2a-submit", request), "collaboration.a2a-task-submit");
  const fetched = value(await admin("a2a-get", { taskId: submitted.runtimeTaskId }), "collaboration.a2a-task-get");
  if (fetched.id !== submitted.runtimeTaskId || submitted.view.status.state !== "submitted") throw new Error("A2A task was not persisted and readable");
  const privateRequest = await admin("a2a-submit", { ...request, id: `${id}-private`, nonce: `${request.nonce}-private`, dataScopes: ["private:notes"] });
  if (privateRequest?.result?.ok === true) throw new Error("A2A private scope was accepted");
  return { cardSkills: card.skills.length, task: digest(submitted.runtimeTaskId), state: submitted.view.status.state, privateScopeRejected: true };
}));

checks.push(await check("boundary-rejection", async () => {
  const invalidClipboard = await rpc("capability.clipboard", { action: "write", text: 42 });
  if (invalidClipboard?.result?.ok === true) throw new Error("invalid clipboard payload was accepted");
  const unknown = await rpc("capability.not-a-real-method", {});
  if (unknown?.result?.ok === true) throw new Error("unknown RPC method was accepted");
  const unknownField = await rpc("capability.clipboard", { action: "read", unexpected: true });
  if (unknownField?.result?.ok === true) throw new Error("unknown typed RPC field was accepted");
  return { invalidClipboardRejected: true, unknownMethodRejected: true, unknownFieldRejected: true };
}));

const failed = checks.filter((check) => !check.ok);
const report = {
  framework: "openbuddy-real-capability-surface",
  schema: "openbuddy.redacted-evidence.v1",
  evidenceLevel: process.env.OPENBUDDY_E2E_EVIDENCE_LEVEL ?? (process.env.OPENBUDDY_E2E_EXTERNAL === "1" ? "real-external" : "real-local"),
  realE2E: true,
  capabilities: ["clipboard", "collaboration", "plugin-readiness", "organization", "workflow", "network", "a2a", "security-boundaries"],
  transport: "Electron Harness -> dispatchTypedRpc -> Electron Main handlers",
  provider: "custom_anthropic",
  model: modelId,
  api: "anthropic-messages",
  filesystem: "not-run-by-policy",
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
};
const evidenceDir = process.env.OPENBUDDY_EVIDENCE_DIR;
if (evidenceDir) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(`${evidenceDir}/capability-surface.json`, JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ ...report, evidenceArtifact: evidenceDir ? `${evidenceDir}/capability-surface.json` : null }, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
