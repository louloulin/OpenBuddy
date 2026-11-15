export default async ({ page, log, OUT, join }) => {
  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
  const box = () => page.getByRole("textbox").first();
  const send = async (text) => { await box().click(); await box().fill(text); await page.keyboard.press("Enter"); };
  const run = async (name, fn) => {
    try { await fn(); log("ok", name); } catch (e) { log("FAIL", name, String(e).slice(0, 300)); await shot(`${name}-fail`).catch(() => {}); }
  };
  let dialogs = 0;
  page.on("dialog", () => { dialogs += 1; });
  await run("01-start-slow", async () => {
    await send("SLOW 帮我写一个实现计划");
    await page.getByText("梳理需求").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    await shot("01-a-streaming");
  });
  await run("02-new-task", async () => {
    await page.getByText("新建任务").first().click();
    await page.waitForTimeout(800);
    await shot("02a-home-a-running");
    await send("你好，另一个问题");
    await page.getByText("需要我继续细化哪一步").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    const confirmVisible = await page.getByText("停止并切换").count();
    log("confirm-dialog", confirmVisible, "native-dialogs", dialogs);
    await shot("02-b-done-a-running");
  });
  await run("03-back-to-a", async () => {
    await page.locator(".sidebar__conv").filter({ hasText: "SLOW" }).first().click();
    await page.waitForTimeout(700);
    log("a-done-at-switch-back", await page.getByText("需要我继续细化哪一步").count());
    await shot("03-a-resumed");
    await page.getByText("需要我继续细化哪一步").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot("04-a-done");
    log("bubbles-with-plan", await page.getByText("梳理需求").count());
  });
};
