// vitest 测试 stub:代替真正的 pg 包。store.ts 通过动态 import("pg") 加载并 .catch(() => null) 兜底,
// 当 pg 不存在时返回 null,本 stub 仅用于让 vite import-analysis 不抛错。
export default { Pool: null };
export class Pool {}
