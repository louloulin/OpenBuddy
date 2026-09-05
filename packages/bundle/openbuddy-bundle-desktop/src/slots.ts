/**
 * @openbuddy/bundle-desktop/slots — 22 个 ui-* 业务包合并后的 SlotMap 类型。
 *
 * 第三方插件写 `declare module "@openbuddy/bundle-desktop/slots"` 可以扩展桌面端的
 * slot 命名空间,无需直接依赖内部 22 个 ui-* 包。
 *
 * 实现:re-export ui-slots 的 SlotMap 让合并声明继续工作;bundle-desktop 不引入
 * 任何运行时副作用,仅做类型合并桥。
 */
export type { SlotMap } from "@openbuddy/ui-slots";
