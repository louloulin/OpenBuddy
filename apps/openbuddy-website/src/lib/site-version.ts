/**
 * apps/openbuddy-website/src/lib/site-version.ts
 *
 * 官网对「OpenBuddy 当前版本号」的单一读源。
 *
 * 为什么不在 i18n dictionary 或组件里写死版本号:
 *   - 写死的版本号跟仓库根 `package.json` 的真实版本一定会漂移 —— 这是
 *     之前已经踩过的坑(手改漏改发布前才发现);
 *   - 官网 JSON-LD(`softwareVersion`)、安装包文件名、`v0.X.Y · MIT` chip
 *     都要同一个数,任何一处不同都是 SEO / 体验 bug。
 *
 * 实现:
 *   - 直接 `import` 仓库根的 `package.json` —— `resolveJsonModule: true`
 *     允许,Next.js 的 bundler 会内联进 server / client bundle,所以无论
 *     SSG 还是运行时,读到的都是构建时刻的根版本号。
 *   - 故意不通过 `@openbuddy/website/package.json` 间接读:那个 version
 *     跟随根版本一起 bump,但中间多一层抽象没意义;根版本是真相。
 *
 * **不要**从这个文件导出 `appVersion` 之外的字段 — 它的唯一职责就是「当前
 * 版本号」。其它字段(产品名、license)属于 `SITE_LICENSE` / 后续常量。
 */
import { version } from "../../../../package.json";

/** 当前发布版本(无 `v` 前缀,与根 `package.json` 同步)。 */
export const SITE_VERSION: string = version;

/** 同上,加 `v` 前缀,适合放进文案("`v0.16.0 · MIT 协议`")。 */
export const SITE_VERSION_TAG: string = `v${version}`;
