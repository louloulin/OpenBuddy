/**
 * StatusBar — Phase 7 底部状态栏
 *
 * WorkBuddy 实测：每屏都有 4 个状态标签（权限模式 / 模型 / workspace / 网络）。
 * 本组件以 sticky bottom 渲染，可在所有页面显示。
 */
export interface StatusBarProps {
  mode?: string;
  model?: string;
  workspace?: string;
  online?: boolean;
}

export function StatusBar({
  mode = "始终询问",
  model = "MiniMax-M2.7",
  workspace = "appx/openBuddy",
  online = true,
}: StatusBarProps) {
  return (
    <footer className="status-bar" role="status" aria-label="状态栏">
      <div className="status-bar__group">
        <span className="status-bar__item status-bar__mode" aria-label={`权限模式：${mode}`}>
          <span className="status-bar__icon" aria-hidden="true">🔒</span>
          {mode}
        </span>
        <span className="status-bar__item status-bar__model" aria-label={`模型：${model}`}>
          <span className="status-bar__icon" aria-hidden="true">🧠</span>
          {model}
        </span>
      </div>
      <div className="status-bar__group">
        <span className="status-bar__item status-bar__workspace" aria-label={`工作空间：${workspace}`}>
          <span className="status-bar__icon" aria-hidden="true">📁</span>
          {workspace}
        </span>
        <span
          className={`status-bar__item status-bar__network status-bar__network--${online ? "online" : "offline"}`}
          aria-label={online ? "网络：在线" : "网络：离线"}
        >
          <span className="status-bar__icon" aria-hidden="true">
            {online ? "🟢" : "🔴"}
          </span>
          {online ? "在线" : "离线"}
        </span>
      </div>
    </footer>
  );
}
