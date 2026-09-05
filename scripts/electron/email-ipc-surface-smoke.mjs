import { _electron as electron } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "openbuddy-email-ipc-smoke-"));
const piAgentDir = join(userData, "pi-agent");
const downloadDir = join(userData, "downloads");
const evidenceRoot = process.env.OPENBUDDY_EVIDENCE_DIR?.trim();
const checks = [];
let app;

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const safeError = (error) => String(error?.message ?? error ?? "unknown error").replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted-api-key]").slice(0, 500);
const runComputerUse = async (...args) => execFileAsync("agent-cu", args, { cwd: root, timeout: 10_000, maxBuffer: 2_000_000 });

const ipcSurfaceChannels = [
  "agent:init", "mcp:status", "email:provider-diagnostics", "email:accounts", "email:threads", "email:threads-page", "email:thread", "email:labels",
  "email:prepare-processing-plan", "email:confirm-processing-plan", "email:execute-processing-plan", "email:cancel-processing-plan", "email:processing-plans",
  "email:prepare-schedule-send", "email:schedule-send", "email:cancel-scheduled-send", "email:scheduled-sends", "email:pending-sends", "email:cancel-pending-send",
  "email:create-draft", "email:drafts", "email:prepare-send", "email:queue-send", "email:send-draft", "email:unsubscribe", "email:sender-policy",
  "email:save-analysis", "email:create-reminders-from-analysis", "email:analyses", "email:audit", "email:attachments", "email:attachment-download", "email:action-center-query", "email:contact-projection", "email:action-center-create-reminders",
  "dialog:open", "dialog:save", "dialog:ask", "dialog:confirm", "dialog:message", "window:close",
];

mkdirSync(piAgentDir, { recursive: true });
mkdirSync(downloadDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), JSON.stringify({ providers: {} }, null, 2) + "\n", { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), "{}\n", { mode: 0o600 });
writeFileSync(join(piAgentDir, "mcp.json"), JSON.stringify({
  mcpServers: { "mail-e2e": { command: process.execPath, args: [join(root, "evals", "node", "echo", "email-mcp-server.mjs")], reconnect: { enabled: false } } },
}, null, 2) + "\n", { mode: 0o600 });

async function check(name, run) {
  try { checks.push({ name, ok: true, result: await run() }); }
  catch (error) { checks.push({ name, ok: false, error: safeError(error), errorDigest: digest(error) }); }
}

async function nativeButton(preferredApps, names, requiredText) {
  const apps = preferredApps;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const appName of [...new Set(apps)]) {
      let snapshot;
      try {
        snapshot = (await runComputerUse("snapshot", "--app", appName, "--no-cdp", "-d", "15")).stdout;
      } catch { continue; }
      if (requiredText && !snapshot.toLocaleLowerCase().includes(requiredText.toLocaleLowerCase())) {
        if (process.env.OPENBUDDY_EMAIL_IPC_DEBUG === "1" && snapshot.toLocaleLowerCase().includes("sheet")) {
          const excerpt = snapshot.split("\n").filter((line) => /sheet|action-button|button /.test(line)).slice(-12).join(" ").replace(/\s+/g, " ");
          console.error(`[email-ipc] sheet missing required=${requiredText} app=${appName} excerpt=${excerpt.slice(0, 600)}`);
        }
        continue;
      }
      for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = snapshot.match(new RegExp(`\\[(@e\\d+)\\] (?:button|menuitem) "${escaped}"(?: id=([^\\s]+))?`));
        if (!match) continue;
        try {
          if (process.env.OPENBUDDY_EMAIL_IPC_DEBUG === "1") console.error(`[email-ipc] native app=${appName} name=${name} ref=${match[1]} id=${match[2] ?? ""} sheet=${(snapshot.match(/sheet[\\s\\S]{0,320}/)?.[0] ?? "").replace(/\\s+/g, " ")}`);
          await runComputerUse("click", match[1], "--app", appName, "--no-cdp");
          return { app: appName, name, ref: match[1], ...(match[2] ? { id: match[2] } : {}) };
        } catch { continue; }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`native button not found: ${names.join(", ")}`);
}

async function confirmNative(page, channel, args, answer = "确定", requiredText) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pendingIdle = await runComputerUse("snapshot", "--app", "Electron", "--no-cdp", "-d", "8")
      .then(({ stdout }) => !/role=(?:dialog|sheet)|(?:^|\\n)\\s*(?:dialog|sheet) /.test(stdout))
      .catch(() => true);
    if (pendingIdle) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const pending = page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });
  const outcome = pending.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
  await new Promise((resolve) => setTimeout(resolve, 600));
  const button = await nativeButton(["OpenBuddy", "Electron"], [answer, answer === "确定" ? "OK" : "Cancel"], requiredText);
  const result = await outcome;
  if (!result.ok) throw result.error;
  return { value: result.value, button };
}

try {
  const electronPath = process.env.OPENBUDDY_ELECTRON_PATH ?? join(root, "node_modules", ".bin", "electron");
  app = await electron.launch({
    args: [root, `--user-data-dir=${userData}`], executablePath: electronPath, cwd: root, timeout: 30_000,
    env: { ...process.env, ELECTRON_RENDERER_URL: "", PI_CODING_AGENT_DIR: piAgentDir, OPENBUDDY_DEBUG_UI: "0", OPENBUDDY_FILESYSTEM_SMOKE: "0" },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });
  const invoke = (channel, args) => page.evaluate(({ channel, args }) => window.api.invoke(channel, args), { channel, args });
  const init = await invoke("agent:init");
  if (init?.ok !== true) throw new Error("agent:init failed");

  await check("native-dialogs", async () => {
    const confirm = await confirmNative(page, "dialog:confirm", { message: "OpenBuddy IPC native confirm" });
    const ask = await confirmNative(page, "dialog:ask", { title: "OpenBuddy IPC ask", message: "继续真实 native ask？", cancelLabel: "取消", okLabel: "确定" });
    const messagePending = page.evaluate(() => window.api.invoke("dialog:message", { message: "OpenBuddy IPC native message" }));
    const messageButton = await nativeButton(["Electron"], ["确定", "OK"], "OpenBuddy IPC native message");
    await messagePending;
    if (confirm.value !== true || ask.value !== true) throw new Error(`native dialog result mismatch: ${JSON.stringify({ confirm: confirm.value, ask: ask.value })}`);
    return { confirm: confirm.button, ask: ask.button, message: messageButton };
  });

  await check("file-dialogs-cancel", async () => {
    const openPending = page.evaluate(() => window.api.invoke("dialog:open", { title: "OpenBuddy IPC open", properties: ["openFile"] }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const openButton = await nativeButton(["OpenBuddy", "Electron"], ["取消", "Cancel"], "openbuddy ipc open");
    const open = await openPending;
    const savePending = page.evaluate(() => window.api.invoke("dialog:save", { title: "OpenBuddy IPC save", defaultPath: "/tmp/openbuddy-ipc.txt" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const saveButton = await nativeButton(["OpenBuddy", "Electron"], ["取消", "Cancel"], "openbuddy ipc save");
    const save = await savePending;
    if (open !== null || save !== null) throw new Error(`file dialog cancellation mismatch: ${JSON.stringify({ open, save })}`);
    return { open: openButton, save: saveButton, cancelled: true };
  });

  await check("email-provider-and-read", async () => {
    let statuses = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      statuses = await invoke("mcp:status");
      if (statuses?.some((entry) => entry.serverName === "mail-e2e" && entry.status === "ready")) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const diagnostics = await invoke("email:provider-diagnostics");
    const accounts = await invoke("email:accounts");
    const accountId = accounts?.[0]?.id;
    const threads = await invoke("email:threads", { accountId, query: "真实 MCP" });
    const pageResult = await invoke("email:threads-page", { accountId, limit: 10 });
    const thread = await invoke("email:thread", { accountId, threadId: "thread-1" });
    const labels = await invoke("email:labels", { accountId });
    if (!accountId || diagnostics?.readiness !== "ready" || threads.length !== 1 || pageResult.items?.length !== 1 || thread.messages?.length !== 1 || labels.length < 2) throw new Error("email read lifecycle failed");
    return { account: digest(accountId), readiness: diagnostics.readiness, threads: threads.length, labels: labels.length };
  });

  const accounts = await invoke("email:accounts");
  const accountId = accounts?.[0]?.id;
  if (!accountId) throw new Error("email account unavailable after readiness check");
  const draft = await invoke("email:create-draft", { accountId, draftId: `ipc-draft-${Date.now()}`, to: [{ address: "smoke@example.test" }], subject: "IPC lifecycle draft", body: "redacted IPC lifecycle body" });
  const analysis = await invoke("email:save-analysis", { accountId, threadId: "thread-1", kind: "actions", confidence: 0.9, summary: "IPC action analysis", facts: [{ statement: "IPC smoke source message", citations: [{ messageId: "message-1" }] }], actions: [{ content: "Review message", dueAt: new Date(Date.now() + 3_600_000).toISOString(), citations: [{ messageId: "message-1" }] }], risks: [] });

  await check("processing-plan-confirm-execute-cancel", async () => {
    const plan = await invoke("email:prepare-processing-plan", { operations: [{ accountId, threadIds: ["thread-1"], kind: "mark-read", rationale: "IPC plan" }] });
    const confirmed = await confirmNative(page, "email:confirm-processing-plan", { planId: plan.id });
    const executed = await invoke("email:execute-processing-plan", { planId: plan.id, confirmationToken: confirmed.value });
    const cancelledPlan = await invoke("email:prepare-processing-plan", { operations: [{ accountId, threadIds: ["thread-1"], kind: "star", value: true, rationale: "IPC cancel" }] });
    const cancelled = await invoke("email:cancel-processing-plan", { planId: cancelledPlan.id });
    if (executed.status !== "executed" || cancelled.status !== "cancelled") throw new Error(`processing plan lifecycle failed: ${JSON.stringify({ executed: executed.status, cancelled: cancelled.status })}`);
    return { plan: digest(plan.id), executed: executed.status, cancelled: cancelled.status };
  });

  await check("scheduled-send-confirm-and-cancel", async () => {
    const scheduledDraft = await invoke("email:create-draft", { accountId, draftId: `ipc-scheduled-${Date.now()}`, to: [{ address: "smoke@example.test" }], subject: "IPC scheduled", body: "scheduled" });
    const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
    const token = await confirmNative(page, "email:prepare-schedule-send", { draftId: scheduledDraft.id, scheduledAt });
    const scheduled = await invoke("email:schedule-send", { draftId: scheduledDraft.id, scheduledAt, confirmationToken: token.value });
    await invoke("email:cancel-scheduled-send", { scheduleId: scheduled.id });
    return { draft: digest(scheduledDraft.id), schedule: digest(scheduled.id), cancelled: true };
  });

  await check("pending-send-undo", async () => {
    const pendingDraft = await invoke("email:create-draft", { accountId, draftId: `ipc-pending-${Date.now()}`, to: [{ address: "smoke@example.test" }], subject: "IPC pending", body: "pending" });
    const token = await confirmNative(page, "email:prepare-send", { draftId: pendingDraft.id });
    const pending = await invoke("email:queue-send", { draftId: pendingDraft.id, confirmationToken: token.value, undoWindowMs: 1_000 });
    await invoke("email:cancel-pending-send", { pendingId: pending.id });
    return { draft: digest(pendingDraft.id), pending: digest(pending.id), cancelled: true };
  });

  await check("send-unsubscribe-policy-and-reminders", async () => {
    const sendDraft = await invoke("email:create-draft", { accountId, draftId: `ipc-send-${Date.now()}`, to: [{ address: "smoke@example.test" }], subject: "IPC send", body: "send" });
    const sendToken = await confirmNative(page, "email:prepare-send", { draftId: sendDraft.id }, "确定", "确认发送邮件");
    const sent = await invoke("email:send-draft", { draftId: sendDraft.id, confirmationToken: sendToken.value });
    const policySignal = await invoke("email:sender-policy", { accountId, senderEmail: "sender@example.test", policy: "signal" });
    const policyBlock = await confirmNative(page, "email:sender-policy", { accountId, senderEmail: "sender@example.test", policy: "block" }, "确定", "确认阻断发件人");
    const unsubscribed = await confirmNative(page, "email:unsubscribe", { accountId, messageId: "message-1", threadId: "thread-1" }, "确定", "确认退订邮件列表");
    const reminders = await confirmNative(page, "email:create-reminders-from-analysis", { analysisId: analysis.id }, "确定", "创建为跟进");
    if (sent.ok !== true || policySignal.ok !== true || policyBlock.value?.ok !== true || unsubscribed.value?.ok !== true || reminders.value?.reminders?.length !== 1) throw new Error("email confirmation lifecycle failed");
    return { sent: true, policy: true, unsubscribed: true, reminders: reminders.value.reminders.length };
  });

  const report = { framework: "openbuddy-electron-email-ipc-surface-smoke", schema: "openbuddy.redacted-evidence.v1", evidenceLevel: "real-local", runtime: "electron+pi+mcp", realE2E: true, capabilities: ["email", "native-dialogs", "desktop-dialogs"], filesystem: "not-run-by-policy", passed: checks.filter((entry) => entry.ok).length, failed: checks.filter((entry) => !entry.ok).length, checks };
  if (evidenceRoot) { mkdirSync(evidenceRoot, { recursive: true }); writeFileSync(join(evidenceRoot, "email-ipc-surface.json"), JSON.stringify(report, null, 2) + "\n", "utf8"); }
  console.log(JSON.stringify({ ...report, evidenceArtifact: evidenceRoot ? join(evidenceRoot, "email-ipc-surface.json") : null }, null, 2));
  process.exit(report.failed === 0 ? 0 : 1);
} catch (error) {
  console.error(`[email-ipc-surface] ${safeError(error)}`);
  process.exit(1);
} finally {
  await Promise.race([app?.close?.(), new Promise((resolve) => setTimeout(resolve, 3_000))]).catch(() => undefined);
  try { rmSync(userData, { recursive: true, force: true }); } catch {}
}
