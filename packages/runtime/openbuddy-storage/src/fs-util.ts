/**
 * 探测文件是否存在时的唯一正确写法。
 *
 * 为什么需要这个包装(Node 22 的坑)
 * --------------------------------
 * 直觉写法是 `await stat(p, { throwIfNoEntry: false })`,期望"不存在时返回
 * undefined"。**在 Node 22 上这是错的**:
 *
 *     node 22.22.0
 *     await stat('/missing', { throwIfNoEntry: false })
 *       -> 抛出 ENOENT        // 选项被忽略
 *     fs.statSync('/missing', { throwIfNoEntry: false })
 *       -> undefined          // sync 版才认这个选项
 *     fs.stat('/missing', { throwIfNoEntry: false }, cb)
 *       -> cb(err=ENOENT)     // 回调版也不认
 *
 * Node 24 三种形式都认。CI 与 Electron 44 都跑 Node 22,所以"本机全绿、
 * CI 全红"是这个仓库反复踩到的模式(见 plan1029)。这不是测试问题:生产
 * 代码里同样的写法会让"探测可选文件"直接抛异常。
 *
 * 因此凡是"这个路径在不在"的判断,一律走本函数,不要再直接写
 * `stat(..., { throwIfNoEntry: false })`。
 *
 * 语义
 * ----
 * - 路径不存在 / 路径中间某段不是目录(ENOTDIR)-> 返回 undefined。
 *   两者对调用方是同一件事:"这个候选不可用"。
 * - 其它错误(EACCES / EPERM / ELOOP / EIO ...)-> 照常抛出。
 *   权限问题与 IO 故障不是"不存在",静默吞掉会让真正的故障变成
 *   "文件怎么不见了"的悬案。
 */
import { stat } from "node:fs/promises";

import type { Stats } from "node:fs";

/** "这个候选不可用"的错误码集合。 */
const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR"]);

/**
 * `stat`,但"路径不存在"返回 `undefined` 而不是抛异常。
 *
 * 在 Node 22/24 上行为一致 —— 不依赖 `throwIfNoEntry` 选项。
 */
export async function statIfExists(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code && ABSENT_CODES.has(code)) return undefined;
    throw error;
  }
}
