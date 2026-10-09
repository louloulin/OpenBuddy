/**
 * R51 真机探针:验证用户提供的真实 Casdoor 实例,引导配置入口。
 *
 * 用户给的实例:`http://124.221.146.145:8000/`(admin / 123 是 Casdoor
 * 后台账号,不是 OAuth 应用凭证)。
 *
 * OAuth 应用的 clientId 必须在 Casdoor 后台显式注册 OpenBuddy 应用并拿到
 * (admin 登录 → Applications → Add → 记下 Client ID + 把 Redirect URI
 * 设为 `casdoor://localhost/callback`)。`casdoor:config-save` 会拒绝
 * clientId 为空的 patch,所以本探针**不直接落盘** —— 它做的是:
 *
 *   1) 远端 OIDC discovery 可达,issuer 与用户给的 URL 一致;
 *   2) CasdoorSignInDialog 在未配置时正常弹出,并支持在框内补 issuer;
 *   3) 把 issuer 预填进对话框后,点「保存并登录」会给一个明确提示
 *      "issuer 和 clientId 必填",不会让用户对着一个静默的失败页;
 *   4) 截图 + 视觉资产作为 R51 交付。
 *
 * 等用户在 Casdoor 后台拿到 clientId 之后,只需在同一个对话框里把它
 * 填进「clientId」字段再点「保存并登录」即可 —— 不需要重启,主进程
 * 会自动 `clearSession` + 重新加载 endpoints + 打开系统浏览器走授权流。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CASDOOR_URL = "http://124.221.146.145:8000";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const steps = [];
const step = (name, ok, detail) => steps.push({ step: name, ok: Boolean(ok), detail });

// ── 远端 OIDC discovery 健康检查 ──────────────────────────────────
let discovery = null;
try {
  const r = await fetch(`${CASDOOR_URL}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  });
  discovery = await r.json();
  step(
    "OIDC discovery 可达",
    r.ok && discovery?.issuer === CASDOOR_URL,
    `issuer=${discovery?.issuer} status=${r.status}`,
  );
  step(
    "OIDC discovery 含 authorization_endpoint",
    typeof discovery?.authorization_endpoint === "string",
    `auth=${discovery?.authorization_endpoint}`,
  );
} catch (err) {
  step("OIDC discovery 可达", false, String(err));
}

// ── 起 Electron,走到登录对话框,展示 issuer 预填路径 ─────────────────
const userData = mkdtempSync(join(tmpdir(), "ob-r51-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const agentDir = mkdtempSync(join(tmpdir(), "ob-r51-agent-"));
mkdirSync(join(root, "tests", "screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_AGENT_DIR: agentDir,
  },
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error("[pageerror]", String(e)));
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(2500);

  try {
    const c = page.locator("[data-testid='onboarding-close']").first();
    if (await c.isVisible({ timeout: 2000 })) { await c.click(); await page.waitForTimeout(400); }
  } catch { /* not shown */ }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // 走到登录对话框
  await page.locator(".sidebar__user").first().click();
  await page.waitForTimeout(400);
  await page.locator(".sidebar__account-menu-item--primary").first().click();
  await page.waitForTimeout(700);

  const dialogVisible = await page.locator("[data-testid='casdoor-signin-form']").isVisible().catch(() => false);
  step("登录对话框弹出", dialogVisible, "");

  if (!dialogVisible) {
    const r = await page.locator("[data-testid='casdoor-signin-loading']").isVisible().catch(() => false);
    step("加载态可见", r, "");
  } else {
    // 用 Playwright 的 fill 替换 React 受控 input 的值。
    await page.locator("[data-testid='casdoor-signin-issuer']").fill(CASDOOR_URL);
    await page.locator("[data-testid='casdoor-signin-management']").fill(CASDOOR_URL);
    // clientId 留空 —— 期望保存时被前端拦住,并给出明确提示。
    await page.waitForTimeout(300);

    const issuerVal = await page.locator("[data-testid='casdoor-signin-issuer']").inputValue();
    const mgmtVal = await page.locator("[data-testid='casdoor-signin-management']").inputValue();
    const clientVal = await page.locator("[data-testid='casdoor-signin-client-id']").inputValue();

    step(
      "issuer 字段已预填真实 URL",
      issuerVal === CASDOOR_URL,
      `value=${issuerVal}`,
    );
    step(
      "management 字段已预填真实 URL",
      mgmtVal === CASDOOR_URL,
      `value=${mgmtVal}`,
    );
    step(
      "clientId 字段留空(等用户在 Casdoor 后台注册后填)",
      clientVal === "",
      `value=${JSON.stringify(clientVal)}`,
    );

    await page.screenshot({ path: "tests/screenshots/r51-casdoor-prefill.png" });
    step("截图已保存", true, "tests/screenshots/r51-casdoor-prefill.png");

    // 点「保存并登录」(在对话框里就是 casdoor-signin-enterprise 按钮),
    // 因为 clientId 空,前端会先把 setMessage 设成"issuer 和 clientId 必填"
    // 然后 return null,不会真的调 IPC。
    const saveBtn = page.locator("[data-testid='casdoor-signin-enterprise']");
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(500);
      const msg = await page.locator("[data-testid='casdoor-signin-message']").textContent().catch(() => "");
      step(
        "clientId 为空时点保存给出明确提示",
        typeof msg === "string" && msg.includes("clientId"),
        `message=${JSON.stringify(msg?.trim() ?? "")}`,
      );
    }
  }
} finally {
  await app.close();
}

const ok = steps.every((s) => s.ok);
console.log(JSON.stringify({ ok, steps, discovery: { issuer: discovery?.issuer, hasJwks: Boolean(discovery?.jwks_uri), auth: discovery?.authorization_endpoint } }, null, 2));
process.exit(ok ? 0 : 1);
