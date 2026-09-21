#!/usr/bin/env node
/**
 * packaged-smoke.mjs — smoke test for the *installed* desktop artifact.
 *
 * Why this exists: every other Electron smoke in `scripts/electron/` launches the
 * repo checkout (`electron .` against `out/`). None of them touch the installer,
 * so a build could pass every gate and still ship an installer whose window
 * crashes on the first navigation — which is exactly what LUM-1320 found (React
 * error #310 on every workbench route, 36 `plugin/failed` per profile load).
 *
 * Contract:
 *   1. (optional) silently install the NSIS installer into a private directory
 *      when `OPENBUDDY_INSTALLER` points at it;
 *   2. launch `<installedRoot>/OpenBuddy.exe` through Playwright's Electron driver;
 *   3. assert window + preload bridge + `agent:init` + `agent:plugin-readiness`;
 *   4. exercise the real collaboration IPC lifecycle through the preload bridge;
 *   5. click every primary navigation entry and assert none lands in the
 *      workbench ErrorBoundary;
 *   6. assert the runtime event log has no `plugin/failed` and reaches
 *      `plugin/readiness = ready`;
 *   7. assert the installed tree carries the files the runtime opens
 *      (`resources/PRIVACY.md`, `resources/app/out/main/*.js`).
 *
 * Usage (Windows):
 *   OPENBUDDY_INSTALLER=release/OpenBuddy-0.15.0-setup.exe \
 *   OPENBUDDY_INSTALLED_ROOT=C:\path\to\installed-test \
 *   pnpm test:electron:packaged
 *
 * Without `OPENBUDDY_INSTALLER` the smoke verifies an already-installed tree.
 * Evidence (JSON + screenshots) lands in `OPENBUDDY_PACKAGED_EVIDENCE_DIR`
 * (default `evidence/packaged`).
 */
import { _electron as electron } from "playwright";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const installedRoot = process.env.OPENBUDDY_INSTALLED_ROOT;
const installer = process.env.OPENBUDDY_INSTALLER;
const evidenceDir = resolve(process.env.OPENBUDDY_PACKAGED_EVIDENCE_DIR ?? "evidence/packaged");
if (!installedRoot) {
  console.error("packaged-smoke requires OPENBUDDY_INSTALLED_ROOT=<installed app directory>");
  process.exit(2);
}
const exePath = join(installedRoot, "OpenBuddy.exe");

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
const safeError = (error) => String(error?.message ?? error ?? "unknown").slice(0, 600);
const checks = [];
const screenshots = [];
const consoleErrors = [];
const pageErrors = [];

const check = async (name, run) => {
  try {
    checks.push({ name, ok: true, result: await run() });
  } catch (error) {
    checks.push({ name, ok: false, error: safeError(error) });
  }
};

/** First-run onboarding is a real modal and legitimately covers the workbench. */
const dismissOverlays = async (page) => {
  let dismissed = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.locator('[data-testid="onboarding-wizard"], [role="dialog"][aria-modal="true"]').first();
    if (!(await dialog.count())) break;
    const close = page.locator('[data-testid="onboarding-close"]').first();
    if (await close.count()) await close.click({ timeout: 5_000 }).catch(() => undefined);
    else await page.keyboard.press("Escape").catch(() => undefined);
    dismissed += 1;
    await page.waitForTimeout(500);
  }
  return dismissed;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stop leftovers that block an in-place silent install:
 *   - an OpenBuddy instance running **from this test target** (NSIS otherwise
 *     shows a modal "please close the app" dialog and /S waits forever);
 *   - a previously stalled installer started from the same installer path.
 * Both are scoped to this smoke's own paths, so unrelated sessions are safe.
 */
const stopStrayProcesses = (target, installerPath) => {
  if (process.platform !== "win32") return;
  const script = [
    `$target = '${target}'`,
    `$installer = '${installerPath ?? ""}'`,
    `Get-Process -Name 'OpenBuddy' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($target, 'OrdinalIgnoreCase') } | Stop-Process -Force -ErrorAction SilentlyContinue`,
    `if ($installer) { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installer } | Stop-Process -Force -ErrorAction SilentlyContinue }`,
  ].join("; ");
  spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore", timeout: 60_000 });
};

/** Existing per-user OpenBuddy installs (registry uninstall entries), if any. */
const existingInstallations = () => {
  if (process.platform !== "win32") return [];
  const queried = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-ItemProperty $_.PSPath; if ($p.DisplayName -like '*OpenBuddy*') { $p.DisplayName + '|' + $p.UninstallString } }",
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  return (queried.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
};

/** Any running `OpenBuddy-*-setup` processes (NSIS holds a global single-instance mutex). */
const runningInstallerProcesses = () => {
  if (process.platform !== "win32") return [];
  const queried = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'OpenBuddy-*-setup' } | ForEach-Object { $_.Id.ToString() + '|' + $_.ProcessName + '|' + $_.Path }",
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  return (queried.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
};

/**
 * NSIS takes a global single-instance mutex, so a concurrent installer (e.g.
 * another agent run on the same machine) makes `/S` return immediately without
 * installing anything. Wait for the mutex briefly, then fail loudly instead of
 * silently verifying an untouched directory.
 */
const waitForInstallerMutex = async (timeoutMs = 300_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const others = runningInstallerProcesses();
    if (!others.length) return;
    await sleep(5_000);
  }
  throw new Error(
    `another OpenBuddy installer is still running: ${runningInstallerProcesses().join("; ")}. ` +
      "NSIS serialises installers through a single-instance mutex, so /S cannot proceed; rerun when it finishes.",
  );
};

const removeTree = async (path) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw new Error(`cannot clean ${path}: ${safeError(error)}`);
      await sleep(2_000);
    }
  }
};

/**
 * Silent-install the NSIS installer into a private directory.
 *
 * `Start-Process -Wait` is not used on purpose: NSIS hands control back through
 * a helper process, so `-Wait` (and any call that waits on an inherited pipe)
 * can block forever even though the installer already finished. Instead the
 * installer is fire-and-forget and completion is detected by polling for a
 * fully-materialised app tree.
 */
const installSilently = async () => {
  if (!installer) return null;
  if (process.platform !== "win32") throw new Error("OPENBUDDY_INSTALLER silent install is Windows-only");
  const installerPath = resolve(installer);
  if (!existsSync(installerPath)) throw new Error(`installer not found: ${installerPath}`);
  const target = resolve(installedRoot);
  // electron-builder's assisted NSIS installer runs the previous version's
  // uninstaller before installing (`/S` is not forwarded to it), so on a
  // machine that already has OpenBuddy installed the silent install shows a
  // modal and never returns. Fail fast with the exact remediation instead of
  // hanging for ten minutes.
  const existing = existingInstallations();
  if (existing.length && process.env.OPENBUDDY_ALLOW_EXISTING_INSTALL !== "1") {
    throw new Error(
      `an OpenBuddy installation already exists: ${existing.join("; ")}. ` +
        "Uninstall it first (run the recorded uninstall command with `/S /currentuser`) " +
        "or set OPENBUDDY_ALLOW_EXISTING_INSTALL=1 to install anyway.",
    );
  }
  stopStrayProcesses(target, installerPath);
  await waitForInstallerMutex();
  await removeTree(target);
  mkdirSync(target, { recursive: true });
  // NSIS `/D=` must be the last argument and must not be quoted; the app is
  // per-user (nsis.perMachine=false) so no elevation is required.
  const spawned = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `Start-Process -FilePath '${installerPath}' -ArgumentList '/S','/D=${target}'`],
    { stdio: "ignore", timeout: 120_000 },
  );
  if (spawned.error) throw new Error(`silent install failed to start: ${spawned.error.message}`);

  const exe = join(target, "OpenBuddy.exe");
  const mainBundle = join(target, "resources", "app", "out", "main", "index.js");
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    if (existsSync(exe) && existsSync(mainBundle)) {
      const first = statSync(exe).size;
      await sleep(2_000);
      if (first > 0 && statSync(exe).size === first) {
        return { installerPath, installedRoot: target, exeBytes: first, waitedMs: 600_000 - (deadline - Date.now()) };
      }
    }
    await sleep(2_000);
  }
  throw new Error(`silent install did not produce a complete app tree under ${target} within 600s`);
};

const userData = mkdtempSync(join(tmpdir(), "openbuddy-packaged-smoke-"));
const piAgentDir = join(userData, "pi-agent");
const workspace = join(userData, "workspace");
mkdirSync(piAgentDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), "{}\n", { mode: 0o600 });

let app;
try {
  const installResult = await installSilently();
  if (!existsSync(exePath)) throw new Error(`installed executable not found: ${exePath}`);
  mkdirSync(evidenceDir, { recursive: true });

  app = await electron.launch({
    executablePath: exePath,
    args: [`--user-data-dir=${userData}`],
    timeout: 60_000,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "",
      PI_CODING_AGENT_DIR: piAgentDir,
      OPENBUDDY_DEBUG_UI: "0",
      OPENBUDDY_FILESYSTEM_SMOKE: "0",
    },
  });
  const mainStderr = [];
  app.process().stderr?.on("data", (buffer) => mainStderr.push(String(buffer)));

  const page = await app.firstWindow({ timeout: 60_000 });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 400));
  });
  page.on("pageerror", (error) => pageErrors.push(safeError(error)));
  await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 60_000 });
  await page.waitForTimeout(4_000);
  const onboardingDismissals = await dismissOverlays(page);

  await check("window", async () => {
    const nativeWindow = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { title: win?.getTitle(), visible: win?.isVisible(), width: win?.getBounds().width, height: win?.getBounds().height };
    });
    const rendered = await page.evaluate(() => ({
      childCount: document.getElementById("root")?.childElementCount ?? 0,
      textLength: (document.body.innerText ?? "").trim().length,
    }));
    if (!nativeWindow.visible || nativeWindow.title !== "OpenBuddy") throw new Error(`window not visible/titled: ${JSON.stringify(nativeWindow)}`);
    if (rendered.childCount < 1 || rendered.textLength < 20) throw new Error(`renderer looks blank: ${JSON.stringify(rendered)}`);
    return { nativeWindow, rendered };
  });

  await check("agent-init", async () => {
    const init = await page.evaluate((ws) => window.api.invoke("agent:init", ws), workspace);
    if (init?.ok !== true) throw new Error(`agent:init failed: ${JSON.stringify(init)}`);
    return { ok: true };
  });

  await check("plugin-readiness", async () => {
    const readiness = await page.evaluate(() => window.api.invoke("agent:plugin-readiness"));
    if (!readiness || typeof readiness.phase !== "string" || !Number.isInteger(readiness.generation)) {
      throw new Error(`invalid readiness: ${JSON.stringify(readiness)}`);
    }
    if (readiness.phase !== "ready") throw new Error(`readiness phase is ${readiness.phase}`);
    return { phase: readiness.phase, generation: readiness.generation };
  });

  await check("collaboration-task-inbox-ack", async () => {
    const result = await page.evaluate(async () => {
      const proposed = await window.api.invoke("collaboration:propose-task", {
        title: "packaged smoke task",
        objective: "验证协作任务在安装包内经由真实 preload IPC 生命周期",
        capability: "packaged-smoke",
      });
      const acknowledged = await window.api.invoke("collaboration:ack-inbox", { eventId: proposed.eventId });
      return { proposed, acknowledged };
    });
    if (result.proposed.status !== "proposed" || !result.proposed.taskId) throw new Error(`task proposal failed: ${JSON.stringify(result.proposed)}`);
    if (!result.acknowledged.acknowledgedEventIds?.includes(result.proposed.eventId)) throw new Error("inbox ack failed");
    return { task: digest(result.proposed.taskId), acknowledged: true };
  });

  await check("collaboration-workflow-lifecycle", async () => {
    const result = await page.evaluate(async () => {
      const workflow = await window.api.invoke("collaboration:workflow-propose", {
        title: "packaged smoke workflow",
        mode: "personal",
        nodes: [{ id: "packaged-node", title: "Packaged node", objective: "验证工作流节点经由 preload IPC" }],
      });
      const status = await window.api.invoke("collaboration:workflow-status", { workflowId: workflow.workflowId });
      const executed = await window.api.invoke("collaboration:workflow-execute", { workflowId: workflow.workflowId });
      return { workflow, status, executed };
    });
    if (result.workflow.status !== "proposed" || result.status.workflowId !== result.workflow.workflowId) {
      throw new Error(`workflow lifecycle failed: ${JSON.stringify(result)}`);
    }
    if (!["accepted", "failed", "blocked"].includes(result.executed.status)) {
      throw new Error(`workflow execute terminal state unexpected: ${JSON.stringify(result.executed)}`);
    }
    return { workflow: digest(result.workflow.workflowId), terminal: result.executed.status };
  });

  await check("side-effect-approval-boundary", async () => {
    const result = await page.evaluate(async () => {
      const pending = await window.api.invoke("collaboration:side-effect-create", {
        capability: "packaged-smoke",
        action: "external:send",
        summary: "packaged smoke side effect",
        fingerprint: `packaged-smoke-${Date.now()}`,
      });
      let blocked = false;
      try {
        await window.api.invoke("collaboration:side-effect-approve", { intentId: pending.intentId });
      } catch (error) {
        blocked = /approval is not granted/i.test(String(error?.message ?? error));
      }
      await window.api.invoke("collaboration:approval-decide", { approvalId: pending.approvalId, approved: true, reason: "packaged smoke" });
      const snapshot = await window.api.invoke("collaboration:snapshot");
      return { pending, blocked, approved: snapshot.sideEffectIntents?.some((intent) => intent.intentId === pending.intentId && intent.status === "approved") };
    });
    if (result.pending.status !== "pending" || !result.blocked || !result.approved) {
      throw new Error(`side-effect boundary failed: ${JSON.stringify(result)}`);
    }
    return { intent: digest(result.pending.intentId), unapprovedBlocked: true, approvalPersisted: true };
  });

  await check("ui-navigation-walk", async () => {
    const navLabels = await page.evaluate(() =>
      [...document.querySelectorAll("nav.sidebar__nav button, nav.sidebar__nav [role=button]")]
        .map((node) => (node.textContent ?? "").trim())
        .filter(Boolean),
    );
    const results = [];
    for (const label of navLabels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const node = page.locator("nav.sidebar__nav button", { hasText: new RegExp(`^${escaped}$`) }).first();
      if (!(await node.count())) continue;
      await node.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(900);
      const state = await page.evaluate(() => ({
        textLength: (document.body.innerText ?? "").trim().length,
        mainText: (document.querySelector("main")?.innerText ?? "").trim().slice(0, 120),
        errorBoundary: Boolean(document.querySelector("[data-error-boundary], .error-boundary, .error-boundary-fallback")),
        crashed: (document.querySelector("main")?.innerText ?? "").includes("出现错误"),
      }));
      const file = join(evidenceDir, `ui-${results.length}-${label.replace(/[^\p{L}\p{N}_-]/gu, "_")}.png`);
      await page.screenshot({ path: file }).catch(() => undefined);
      screenshots.push(file);
      results.push({ label, ...state });
    }
    const broken = results.filter((entry) => entry.textLength < 20 || entry.errorBoundary || entry.crashed);
    if (!results.length) throw new Error("no navigation entries discovered");
    if (broken.length) throw new Error(`surfaces rendered blank/error: ${JSON.stringify(broken)}`);
    return { surfaces: results.length, visited: results.map((entry) => entry.label) };
  });

  await check("ui-more-menu-walk", async () => {
    const results = [];
    await dismissOverlays(page);
    const moreButton = page.locator("nav.sidebar__nav button", { hasText: /^更多$/ }).first();
    if (!(await moreButton.count())) return { skipped: "no 更多 entry" };
    await moreButton.click({ timeout: 10_000 });
    await page.waitForTimeout(600);
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll(".sidebar__more-item")].map((node) => (node.textContent ?? "").trim()).filter(Boolean),
    );
    for (const label of labels.slice(0, 20)) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const item = page.locator(".sidebar__more-item", { hasText: new RegExp(`^${escaped}$`) }).first();
      if (!(await item.count())) continue;
      await item.click({ timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => ({
        textLength: (document.body.innerText ?? "").trim().length,
        crashed: (document.querySelector("main")?.innerText ?? "").includes("出现错误"),
      }));
      const file = join(evidenceDir, `ui-more-${results.length}-${label.replace(/[^\p{L}\p{N}_-]/gu, "_")}.png`);
      await page.screenshot({ path: file }).catch(() => undefined);
      screenshots.push(file);
      results.push({ label, ...state });
      if (await moreButton.count()) {
        await moreButton.click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(300);
      }
    }
    const broken = results.filter((entry) => entry.textLength < 20 || entry.crashed);
    if (broken.length) throw new Error(`more-menu surfaces blank/error: ${JSON.stringify(broken)}`);
    return { surfaces: results.length, entries: results.map((entry) => entry.label) };
  });

  await check("no-renderer-errors", async () => {
    const relevant = pageErrors.concat(
      consoleErrors.filter((entry) => !/DevTools|Autofill|preloaded using link preload/i.test(entry)),
    );
    if (relevant.length) throw new Error(`renderer errors: ${JSON.stringify(relevant.slice(0, 8))}`);
    return { consoleErrors: consoleErrors.length, pageErrors: pageErrors.length };
  });

  await check("runtime-event-log", async () => {
    const eventsPath = join(piAgentDir, "openbuddy-events.jsonl");
    if (!existsSync(eventsPath)) throw new Error(`event log missing at ${eventsPath}`);
    const events = readFileSync(eventsPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
    const byType = {};
    const failedIds = new Set();
    let readiness = null;
    for (const event of events) {
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      if (event.type === "plugin/failed") failedIds.add(event.payload?.id ?? event.payload?.name ?? "unknown");
      if (event.type === "plugin/readiness") readiness = event.payload?.phase ?? readiness;
    }
    if (readiness !== "ready") throw new Error(`plugin readiness never reached ready (saw ${readiness})`);
    if (failedIds.size) throw new Error(`plugin/failed for ${failedIds.size} plugin(s): ${JSON.stringify([...failedIds].slice(0, 10))}`);
    return { events: events.length, byType, readiness };
  });

  await check("installed-resources", async () => {
    const resources = join(installedRoot, "resources");
    const privacy = join(resources, "PRIVACY.md");
    const outMain = join(resources, "app", "out", "main");
    if (!existsSync(privacy)) throw new Error("PRIVACY.md missing from installed resources");
    const mainFiles = readdirSync(outMain).filter((name) => name.endsWith(".js"));
    if (!mainFiles.length) throw new Error("packaged out/main is empty");
    return {
      privacyBytes: statSync(privacy).size,
      mainBundleFiles: mainFiles.length,
      packageJsonVersion: JSON.parse(readFileSync(join(resources, "app", "package.json"), "utf8")).version,
    };
  });

  const failed = checks.filter((entry) => !entry.ok);
  const report = {
    schema: "openbuddy.packaged-smoke.v1",
    generatedAt: new Date().toISOString(),
    installedRoot,
    installResult,
    artifact: {
      exePath,
      bytes: statSync(exePath).size,
      sha256: createHash("sha256").update(readFileSync(exePath)).digest("hex"),
    },
    evidenceLevel: "real-installed-artifact",
    onboardingDismissals,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
    screenshots,
    mainProcessStderrTail: mainStderr.join("").split("\n").slice(-40),
  };
  writeFileSync(join(evidenceDir, "packaged-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, evidenceDir, checks: checks.map(({ name, ok, error }) => ({ name, ok, ...(error ? { error } : {}) })) }, null, 2));
  process.exitCode = failed.length === 0 ? 0 : 1;
} catch (error) {
  console.error(`[packaged-smoke] ${safeError(error)}`);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "packaged-smoke.json"), `${JSON.stringify({ fatal: safeError(error), checks, screenshots }, null, 2)}\n`, "utf8");
  process.exitCode = 1;
} finally {
  await Promise.race([app?.close?.(), new Promise((resolve) => setTimeout(resolve, 5_000))]).catch(() => undefined);
  try { rmSync(userData, { recursive: true, force: true }); } catch {}
}
