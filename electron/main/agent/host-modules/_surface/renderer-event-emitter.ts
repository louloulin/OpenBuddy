/**
 * host-modules/_surface/renderer-event-emitter.ts
 *
 * v5-A — Renderer ↔ Main IPC event bridge (singleton module-level emitter).
 *
 * 背景:
 *   agent-host.ts:1251-1258 维护一个 module-level `rendererEventEmitter` 变量,
 *   通过 `bindRendererEventEmitter(emitter)` 注册, 通过 `emitRendererEvent(...)`
 *   单向推送到 renderer。init pipeline 中 (wire-forwarded-events /
 *   provide-rpc-ui-context / init-deepseek / init-session 等) 全部通过参数注入
 *   这两个函数。
 *
 * 设计:
 *   - module-level singleton, 无需 install pattern (单一 emitter, 无 state)
 *   - 保留原 2 函数 API + 内部 closure-scope emitter variable
 *   - 移除 agent-host.ts 中的 5 行代码 (let + 2 export 函数 + 注释)
 *
 * 为什么不合并到 install-domain-*?
 *   - 这个 emitter 没有 deps, 不属于任何 domain install 路径
 *   - 它的 mutation 只发生在 cold boot (renderer 进程加载时调用 bind),
 *     而 install-domain-* 都是 agent-host initialize 阶段触发
 *   - 单独成模块保留「renderer 通信层」语义, 方便 IPC bridge / 测试 mock
 *
 * v5-A 收益: 5 行 → 0 行 (agent-host.ts)
 */

type RendererEventEmitter = (channel: string, payload: unknown) => void;

let rendererEventEmitter: RendererEventEmitter | null = null;

/**
 * Register the renderer's outbound event sink. Returns a disposer that
 * the caller can invoke on renderer-side hot-reload to drop the binding
 * without affecting unrelated code paths.
 *
 * Idempotent in a "last-wins" sense: if the caller hands us a new emitter,
 * the old one is silently replaced. This matches the existing agent-host
 * behavior — the renderer only ever registers one bridge per process.
 */
export function bindRendererEventEmitter(emitter: RendererEventEmitter): () => void {
  rendererEventEmitter = emitter;
  return () => {
    if (rendererEventEmitter === emitter) rendererEventEmitter = null;
  };
}

/**
 * Forward an event to the renderer. No-op when no emitter is bound (cold
 * boot before the renderer process has loaded, or after dispose).
 */
export function emitRendererEvent(channel: string, payload: unknown): void {
  rendererEventEmitter?.(channel, payload);
}
