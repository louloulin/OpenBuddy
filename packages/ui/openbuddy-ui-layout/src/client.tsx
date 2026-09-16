/**
 * @openbuddy/ui-layout/client — 本包的 apply() **有意不注册任何槽位**。
 *
 * `root` 是"整壳替换"扩展点,它的内置默认实现在宿主侧(`src/App.tsx` 的
 * `<RootSurface>` 以 `AppShell` 作 fallback)。本包的 `AppFrame` 是同一位置的
 * **参考实现**:把 sidebar / conversation / details / shell.overlay 四个命名槽
 * 组装成一个通用外壳,给"只想换布局、不想连业务外壳一起重写"的第三方发行版
 * 复用 —— 它 import 本包组件、注册到 `root`,即以更高优先级顶掉内置 AppShell。
 *
 * 为什么 apply() 不再自动注册:
 *   内置包在装配阶段无条件抢占 `root`,等于让"参考实现"默认赢过产品外壳 ——
 *   用户看到的会是 AppFrame 而不是 AppShell(缺顶栏 / 菜单栏 / 状态栏)。
 *   想要 AppFrame 的外壳,应当**显式**注册它,这个主动性属于使用方。
 *
 * 这与 `@openbuddy/ui-modules` 的 `modules.marketplace` 是同一种约定:
 * 包提供可复用组件,不替宿主决定"这块 UI 长什么样"。
 */

export { AppFrame } from "./client/AppFrame";
export type { AppFrameProps } from "./client/AppFrame";

/**
 * 空实现 —— 见文件头说明。
 *
 * 保留这个导出是为了让 `BUILTIN_UI_APPLIES` 的装配循环与"每个内置 ui-* 包都
 * 有过 apply()"的探针断言继续成立(apply 成功 ≠ 必须注册槽位)。
 */
export function apply(): () => void {
  return () => {};
}
