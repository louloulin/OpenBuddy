export default async ({ page, invoke, log, OUT, join }) => {
  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
  const box = page.getByRole("textbox").first();
  const send = async (text) => {
    await box.click();
    await box.fill(text);
    await page.keyboard.press("Enter");
  };
  const run = async (name, fn) => {
    try { await fn(); log("ok", name); } catch (e) { log("FAIL", name, String(e).slice(0, 300)); await shot(`${name}-fail`).catch(() => {}); }
  };

  await run("01-chat", async () => {
    await send("帮我做一个实现计划");
    await page.getByText("需要我继续细化哪一步").waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot("01-chat");
  });

  await run("02-context", async () => {
    const pill = page.locator(".context-usage__pill");
    await pill.waitFor({ timeout: 15000 });
    await pill.click();
    await page.getByTestId("context-auto-compact").waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await shot("02-context-pill");
    await page.keyboard.press("Escape");
  });

  await run("03-memory", async () => {
    await send("请记住：以后回答都用中文");
    await page.getByText("记住这条").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await shot("03-memory-confirm");
    await page.getByRole("button", { name: /^允许$/ }).first().click();
    await page.getByText("已记下这条偏好").waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    await shot("03b-memory-saved");
  });

  await run("04-error", async () => {
    await send("RATE 测试一下限流");
    const sw = page.getByRole("button", { name: "切换模型" }).first();
    await sw.waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    await shot("04-error-card");
    await sw.click();
    await page.getByRole("listbox").waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    await shot("04b-model-menu");
    await page.keyboard.press("Escape");
  });

  await run("05-offline", async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      window.dispatchEvent(new Event("offline"));
    });
    await page.getByTestId("offline-banner").waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    await shot("05-offline-banner");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
      window.dispatchEvent(new Event("online"));
    });
  });

  await run("06-security", async () => {
    await invoke("permission_save", { rules: [
      { action: "allow", tool: "bash", pattern: "git status*" },
      { action: "allow", tool: "read" },
      { action: "deny", tool: "bash", pattern: "rm -rf*" },
    ] });
    const settings = page.getByRole("button", { name: /设置/ }).last();
    await settings.click();
    await page.getByText("安全中心").first().click();
    await page.getByRole("button", { name: /撤销规则 allow bash/ }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await shot("06-security-center");
    await page.getByRole("button", { name: /撤销规则 deny bash/ }).click();
    await page.waitForTimeout(800);
    await shot("06b-security-revoked");
  });
};
