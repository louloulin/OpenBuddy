/**
 * p0-launch-verify.mjs — prod1.md P0 项的真机启动验证。
 *
 * 对着 **构建产物**(dist,file:// 加载)起真实 Electron,断言:
 *   S1  预加载桥在 sandbox:true 下仍工作(window.api 暴露 + IPC 往返)
 *   S2  CSP meta 在 DOM 里,且渲染层零 CSP 违规/零 React 错误
 *   S3  git:status IPC 往返(sandbox 渲染层 → main)
 *   S4  工作区 UI 真实渲染(composer 可见)
 *
 * Usage: node scripts/electron/p0-launch-verify.mjs
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const homeDir = homedir();
const SHOT_DIR = "/tmp/ob-p0-verify";
mkdirSync(SHOT_DIR, { recursive: true });
const log = (msg) => console.log(`[p0] ${msg}`);

const userData = mkdtempSync(join(tmpdir(), "ob-p0-ud-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(join(piAgentDir, "models.json"), `${JSON.stringify({ providers: {} }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(piAgentDir, "auth.json"), `${JSON.stringify({}, null, 2)}\n`, { mode: 0o600 });

const childEnv = {
  ...process.env,
  ELECTRON_RENDERER_URL: "",
  PI_CODING_AGENT_DIR: piAgentDir,
  OPENBUDDY_DEBUG_UI: "0",
  OPENBUDDY_HARNESS_FILE: "",
};

const checks = [];
function record(id, label, ok, detail = "") {
  checks.push({ id, ok });
  log(`${ok ? "PASS" : "FAIL"}  ${id}  ${label}${detail ? ` — ${detail}` : ""}`);
}

let app;
let page;
const consoleErrors = [];

try {
  log("launching Electron against dist…");
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ROOT],
    executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules", ".bin", "electron"),
    cwd: ROOT,
    timeout: 90_000,
    env: childEnv,
  });
  page = await app.firstWindow();
  page.on("console", (m) => {
    if (m.type() === "error") {
      const text = String(m.text()).slice(0, 300);
      consoleErrors.push(text);
      log(`console.error: ${text}`);
    }
  });
  page.on("pageerror", (e) => {
    const text = String(e.message).slice(0, 300);
    consoleErrors.push(text);
    log(`pageerror: ${text}`);
  });
  page.on("console", (m) => {
    if (m.type() === "warning" && /CSP|Content Security Policy|Refused/i.test(m.text())) {
      log(`console.warn: ${String(m.text()).slice(0, 300)}`);
    }
  });
  await page.locator("#root").waitFor({ state: "attached", timeout: 60_000 });
  log("renderer attached");

  // S1 preload 桥(sandbox 下)
  const apiOk = await page.waitForFunction(
    () => Boolean(window.api?.apiVersion === 1),
    undefined,
    { timeout: 30_000 },
  ).then(() => true).catch(() => false);
  record("S1", "sandbox:true 下 preload 桥可用(window.api)", apiOk);

  // S4 UI 真实渲染
  await page.locator(".workspace-picker__trigger").waitFor({ state: "visible", timeout: 30_000 });
  record("S4", "工作区 UI 真实渲染(composer 可见)", true);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(1500);

  // S3 IPC 往返
  const st = await page.evaluate(
    ({ d }) => window.api.invoke("git:status", { cwd: d }),
    { d: ROOT },
  );
  record("S3", "IPC 往返(git:status)", st?.isRepo === true, `${st?.entries?.length ?? "?"} 条`);

  // P0.1:存一个 provider,验证 auth.json 0600 / 目录 0700(生产评审 B2)。
  await page.evaluate(async () => {
    await window.api.invoke("agent:providers-save-provider", {
      provider: {
        id: "p0-probe",
        label: "p0-probe",
        providerKind: "custom_anthropic",
        apiKey: "sk-p0-probe-not-a-real-key",
        baseUrl: "https://example.invalid",
        apiBackend: "messages",
        authScheme: "x_api_key",
      },
    });
  }).catch(() => null);
  const { statSync } = await import("node:fs");
  const agentDir = join(piAgentDir);
  const authPath = join(agentDir, "auth.json");
  let authMode = 0;
  let dirMode = 0;
  let authExists = false;
  try {
    authMode = statSync(authPath).mode & 0o777;
    dirMode = statSync(agentDir).mode & 0o777;
    authExists = true;
  } catch { /* provider 保存失败时文件不存在 */ }
  record(
    "P1",
    "P0.1 auth.json 0600 + 目录 0700(真实应用写路径)",
    authExists && authMode === 0o600 && dirMode === 0o700,
    `exists=${authExists} auth=${authMode.toString(8)} dir=${dirMode.toString(8)}`,
  );

  // P0.7:日志文件真实落盘。macOS 下 app.getPath("logs") 默认是
  // ~/Library/Logs/<app name>(未打包时 app name = Electron);userData/logs
  // 也一并尝试(不同 Electron 版本行为有差异)。
  const { readdirSync } = await import("node:fs");
  let logFile = "";
  for (const dir of [join(userData, "logs"), join(homeDir, "Library", "Logs", "Electron"), join(homeDir, "Library", "Logs", "OpenBuddy")]) {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".log"));
      if (files.length > 0) {
        logFile = join(dir, files[0]);
        break;
      }
    } catch { /* 目录不存在 */ }
  }
  record("L1", "P0.7 主进程日志落盘", Boolean(logFile), logFile || "未找到 *.log");

  // P0.8/P1:数据备份通道(storage:backup-create)真机可用。
  // 先触发 storage:metrics —— 它会在 agentHome 下建好 openbuddy.sqlite。
  await page.evaluate(() => window.api.invoke("storage:metrics", undefined)).catch(() => null);
  const backup = await page
    .evaluate(() => window.api.invoke("storage:backup-create", undefined))
    .catch((error) => ({ error: String(error) }));
  const backupOk =
    typeof backup?.path === "string" &&
    backup.path.length > 0 &&
    (() => {
      try {
        return statSync(backup.path).size > 0;
      } catch {
        return false;
      }
    })();
  record("B1", "数据备份通道真机可用(VACUUM INTO 产物非空)", backupOk, String(backup?.path ?? backup?.error ?? "").slice(0, 120));

  // S2 CSP meta + 零违规
  const csp = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "",
  );
  record("S2a", "CSP meta 存在", csp.includes("script-src"), csp.slice(0, 80));
  const cspViolations = consoleErrors.filter((e) =>
    /Refused to (load|execute|apply|connect|frame)|Content Security Policy|CSP/i.test(e),
  );
  const reactErrors = consoleErrors.filter((e) => /Minified React error|React error/i.test(e));
  const otherErrors = consoleErrors.filter(
    (e) => !cspViolations.includes(e) && !reactErrors.includes(e),
  );
  record("S2b", "零 CSP 违规", cspViolations.length === 0, cspViolations.slice(0, 3).join(" | "));
  record("S2c", "零 React 错误", reactErrors.length === 0, reactErrors.slice(0, 3).join(" | "));
  record("S2d", "零其他 console 错误", otherErrors.length === 0, otherErrors.slice(0, 3).join(" | "));

  await page.screenshot({ path: join(SHOT_DIR, "p0-launch.png") });
} catch (error) {
  const message = String(error?.message ?? error).slice(0, 600);
  log(`PROBE ERROR: ${message}`);
  try {
    await page?.screenshot({ path: join(SHOT_DIR, "probe-error.png") });
  } catch {}
  record("PROBE", "探针完成(无异常)", false, message);
} finally {
  try {
    await app?.close();
  } catch {}
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {}
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n[p0] ${checks.length - failed.length}/${checks.length} checks passed. Screenshots: ${SHOT_DIR}`);
process.exit(failed.length > 0 ? 1 : 0);
