export default async ({ page, log, OUT, join }) => {
  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
  const box = () => page.getByRole("textbox").first();
  const send = async (text) => { await box().click(); await box().fill(text); await page.keyboard.press("Enter"); };
  const run = async (name, fn) => {
    try { await fn(); log("ok", name); } catch (e) { log("FAIL", name, String(e).slice(0, 300)); await shot(`${name}-fail`).catch(() => {}); }
  };
  await run("00-home", async () => { await page.waitForTimeout(800); await shot("ux-00-home"); });
  await run("01-stream", async () => {
    await send("SLOW 帮我做一个实现计划");
    await page.getByText("梳理需求").first().waitFor({ timeout: 30000 });
    await shot("ux-01-streaming");
    await page.getByText("需要我继续细化哪一步").waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);
    await shot("ux-02-done");
  });
  await run("03-memory", async () => {
    await send("请记住：以后回答都用中文");
    await page.getByText("记住这条").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    await shot("ux-03-approval");
    await page.getByRole("button", { name: /^允许$/ }).first().click();
    await page.getByText("已记下这条偏好").waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    await shot("ux-04-after-tool");
  });
  await run("05-error", async () => {
    await send("RATE 测试");
    await page.waitForTimeout(6000);
    await shot("ux-05-error");
  });
  await run("06-hover", async () => {
    const msg = page.locator(".msg--assistant, [data-role=assistant]").first();
    await msg.hover().catch(() => {});
    await page.waitForTimeout(400);
    await shot("ux-06-hover");
  });
  await run("07-narrow", async () => {
    await page.setViewportSize({ width: 900, height: 800 }).catch(() => {});
    await page.waitForTimeout(800);
    await shot("ux-07-narrow");
  });
};
