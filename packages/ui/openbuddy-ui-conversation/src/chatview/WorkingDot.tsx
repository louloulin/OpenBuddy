/**
 * WorkingDot —— 统一的流式工作指示(阶段:chat UI 对齐 Claude Desktop)。
 *
 * 对齐真值:REA 实测 Claude Desktop 2.31226.1 的 `cds-working-dot-halo` ——
 * 单一 2.5s ease-in-out 呼吸点(halo 层 + 实心层),reduce-motion 时静止。
 *
 * 设计约定:
 *   - 它是**唯一的**"正在工作"指示源:LoadingRow 的三点 bounce、MessageMeta
 *     的"正在生成…"重复指示都由它替代/收敛(见各处改造注释)。
 *   - 纯展示组件,不接 store;调用方决定何时渲染。
 *   - `prefers-reduced-motion` 下 halo 动画归零(静态圆点)。
 */
export function WorkingDot({ size = 10 }: { size?: number }) {
  return (
    <span
      className="working-dot"
      data-testid="working-dot"
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      <span className="working-dot__halo" />
      <span className="working-dot__core" />
    </span>
  );
}
