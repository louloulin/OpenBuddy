import { _electron as electron } from "playwright";
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules", ".bin", "electron"),
  args: [join(process.cwd(), "out/main/index.js"), "--no-sandbox", "--disable-gpu"],
  cwd: process.cwd(),
  timeout: 60000,
});
console.log("launched, waiting 6s...");
await new Promise(r=>setTimeout(r,6000));
// Try to get any window regardless of state
const ctx = app.context();
const all = ctx.pages();
console.log("pages count:", all.length);
for (const p of all) console.log("  page url:", p.url());
// Listen for renderer console
app.on("console", msg => console.log("CON:", msg.type(), msg.text()));
const page = await app.firstWindow({ timeout: 20000 }).catch(e => { console.log("FW err:", e.message); return null; });
if (page) {
  console.log("got window");
  page.on("console", m => console.log("RENDERER:", m.type(), m.text()));
  page.on("pageerror", e => console.log("PAGE ERROR:", e.message));
  await new Promise(r=>setTimeout(r,2000));
  console.log("url:", page.url());
}
await app.close();
function join()...{ ...}
