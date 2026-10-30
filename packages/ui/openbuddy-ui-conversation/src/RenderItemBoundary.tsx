/**
 * RenderItemBoundary — 单条消息的渲染容错（plan1030 批 4a）。
 *
 * 背景（plan1030.md §0.5）：conversation 包此前 0 处组件级 ErrorBoundary，
 * 一条坏消息（历史记录损坏、异常 part 结构）会让整个对话白屏，且每次
 * 启动都会重崩——因为坏记录持久化了。
 *
 * lumos 语义（RenderItemBoundary.tsx / issue #1400 教训）：
 *   - 单条消息渲染失败只塌一行，其余消息照常渲染；
 *   - 刻意不做自动重试——坏记录重试还是坏，重试只会掩盖数据问题；
 *     修复数据（编辑/删除该消息）才是出路。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export type RenderItemBoundaryProps = {
  /** 稳定的 item 标识，用于错误上报/定位。 */
  itemId: string;
  children: ReactNode;
};

type RenderItemBoundaryState = { error: Error | null };

export class RenderItemBoundary extends Component<
  RenderItemBoundaryProps,
  RenderItemBoundaryState
> {
  state: RenderItemBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RenderItemBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 不自动重试（见文件头）。console 留痕便于用户回报坏记录。
    console.error(
      `[RenderItemBoundary] 消息渲染失败 id=${this.props.itemId}`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="msg-render-error"
          role="status"
          data-msg-render-error={this.props.itemId}
        >
          这条消息渲染失败，其余消息不受影响。
        </div>
      );
    }
    return this.props.children;
  }
}
