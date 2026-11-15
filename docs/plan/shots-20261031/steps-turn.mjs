export default async ({ page, invoke, log, OUT, join, sessionId }) => {
  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
  const box = page.getByRole("textbox").first();
  const send = async (text) => { await box.click(); await box.fill(text); await page.keyboard.press("Enter"); };
  const run = async (name, fn) => {
    try { await fn(); log("ok", name); } catch (e) { log("FAIL", name, String(e).slice(0, 300)); await shot(`${name}-fail`).catch(() => {}); }
  };
  await run("01-awaiting", async () => {
    await send("请记住：以后回答都用中文");
    await page.getByText("记住这条").first().waitFor({ timeout: 30000 });
    
    await page.waitForTimeout(600);
    await shot("01-awaiting-approval");
    log("main-state", JSON.stringify(await page.evaluate(async () => {
      const id = await window.__sid?.();
      return id ?? null;
    }).catch(() => null)));
  });
  await run("02-reload-mid-turn", async () => {
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.getByText("记住这条").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1000);
    await shot("02-after-reload");
  });
  await run("03-approve", async () => {
    const allow = page.getByRole("button", { name: /^允许$/ }).first();
    if (await allow.count()) await allow.click();
    else log("note", "approval card not restored after reload");
    await page.getByText("已记下这条偏好").waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot("03-done");
    const label = await page.getByText("等待你确认").count();
    log("label-after-done", label);
  });
};
