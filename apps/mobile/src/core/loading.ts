/**
 * The waiting row's wording (20261115-mobile.md §4.3).
 *
 * The desktop shows a two-phase label ("准备中" → "等待模型响应") with a
 * shining sweep, plus a rotating tip after a few seconds. The phone keeps the
 * same structure — a phase that advances, and a tip that arrives later — so
 * the two surfaces feel like one product while waiting.
 */

/** "准备中" is shown before the request leaves the phone. */
export const PREPARING_TEXT = '准备中'
/** After the request is on the wire, the model is the one thinking. */
export const REQUESTING_TEXT = '等待模型响应'
/** How long the first phase lasts. */
export const PREPARING_DURATION_MS = 1200
/** The tip waits this long before its first appearance. */
export const TIP_INITIAL_DELAY_MS = 3500
/** How often the tip changes. */
export const TIP_ROTATION_INTERVAL_MS = 9000

/** Tips the phone rotates through; the same pool the desktop uses. */
export const LOADING_TIPS: readonly string[] = [
  '信息梳头中',
  '重点已经捞到一半',
  '长话短说，还没短完',
  '废话压缩中',
  '依据补齐中',
  '散装信息打包中',
  '大任务切成小块，再下锅',
  '待办在排队',
  '灵感从草稿箱往外拎',
  '噪音调低一格',
  '目标是少让你改两轮',
  '找到线头了，顺着拉一拉',
  '先把结论摆出来',
  '正在翻上下文',
  '细节在后面排队',
  '骨架先搭好',
  '正在核对前因后果',
  '答案快成形了',
  '顺着线索再走一段',
  '把话说完整',
]

/** Picks the next tip, never the same one twice in a row. */
export function nextTip(pool: readonly string[], previous: string | null): string {
  if (pool.length === 0) return ''
  let next = pool[Math.floor(Math.random() * pool.length)]!
  if (pool.length > 1 && next === previous) {
    next = pool[(pool.indexOf(next) + 1) % pool.length]!
  }
  return next
}
