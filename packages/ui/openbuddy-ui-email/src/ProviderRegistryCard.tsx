/**
 * ProviderRegistryCard — 邮箱连接注册表
 *
 * 从 EmailPanel 1625 行中提取的"邮箱连接注册表"子组件。负责展示连接列表 / 空状态 /
 * 单条连接的 reauthorize / 启用 / 停用 / 移除操作。
 *
 * 设计:
 *   - **状态由父组件持有**(registryConnections / registryReadiness / registryBusyId);
 *     本组件是纯展示,接受 callbacks。所有 mutation 在父组件 EmailPanel 完成。
 *   - **空状态引导**:无连接时明示「点击右上角添加」+ 解释 credentialRef 不存 token。
 *   - **可访问性**:`role="status"` + `aria-label` 让屏幕阅读器能识别整块。
 *   - **样式 class 与 EmailPanel 保持一致**(`email-connection-card`, `email-connection-cards`),
 *     不引入新 token;后续如果统一迁移到 --wb-*,可以一次性替换 .email-* 命名空间。
 *
 * @see docs/comet/changes/email-module-architecture-review/specs/email/spec.md §2.5 EmailSidebar
 */
import type { EmailConnection, EmailConnectionReadiness } from "@openbuddy/capability-email";

export interface ProviderRegistryCardProps {
  connections: EmailConnection[];
  readiness: EmailConnectionReadiness[];
  busyId: string | null;
  onAdd: () => void;
  onToggle: (connection: EmailConnection, enabled: boolean) => void;
  onReauthorize: (connection: EmailConnection) => void;
  onRemove: (connection: EmailConnection) => void;
}

type DerivedStatus = "ready" | "partial" | "unavailable" | "reauthorization-required" | "disabled" | "error" | "configured";

function deriveStatus(
  connection: EmailConnection,
  readiness: EmailConnectionReadiness | undefined,
): DerivedStatus {
  const status = readiness?.readiness ?? connection.status;
  if (status === "connected" || status === "ready") return "ready";
  if (status === "partial") return "partial";
  if (status === "unavailable") return "unavailable";
  if (status === "reauthorization-required") return "reauthorization-required";
  if (status === "disabled") return "disabled";
  if (status === "error") return "error";
  return "configured";
}

const STATUS_LABEL: Record<DerivedStatus, string> = {
  ready: "已就绪",
  partial: "能力不完整",
  unavailable: "不可用",
  "reauthorization-required": "需要重新授权",
  disabled: "已停用",
  error: "连接错误",
  configured: "未连接",
};

export function ProviderRegistryCard({
  connections,
  readiness,
  busyId,
  onAdd,
  onToggle,
  onReauthorize,
  onRemove,
}: ProviderRegistryCardProps): JSX.Element {
  return (
    <section className="email-connection-cards" aria-label="邮箱连接注册表">
      <header className="email-connection-cards__header">
        <strong>邮箱连接注册表</strong>
        <button
          type="button"
          className="email-connection-cards__add"
          onClick={onAdd}
        >
          + 添加邮箱连接
        </button>
      </header>
      {connections.length === 0 ? (
        <p className="email-connection-cards__empty">
          尚未配置任何邮箱连接。点击右上角「添加邮箱连接」选择 Gmail API / Microsoft Graph / JMAP / MCP 连接器;credentialRef 仅为引用,不会保存真实 token。
        </p>
      ) : (
        connections.map((connection) => {
          const ready = readiness.find((item) => item.connection.id === connection.id);
          const status = deriveStatus(connection, ready);
          const busy = busyId === connection.id;
          return (
            <article
              key={connection.id}
              className={`email-connection-card email-connection-card--${status}`}
              data-connection-id={connection.id}
              data-status={status}
            >
              <header>
                <strong>{connection.displayName}</strong>
                <span className={`email-connection-card__status email-connection-card__status--${status}`}>
                  {STATUS_LABEL[status]}
                </span>
              </header>
              <small>
                {connection.providerType === "mcp"
                  ? `MCP 连接器 · ${connection.mcpServerName ?? ""}`
                  : `${connection.providerType} · 仅保存 credentialRef${connection.credentialRef ? ` · ${connection.credentialRef}` : ""}`}
              </small>
              {ready?.message ? (
                <small className="email-connection-card__message">{ready.message}</small>
              ) : null}
              <footer>
                {status === "reauthorization-required" ? (
                  <button
                    type="button"
                    onClick={() => onReauthorize(connection)}
                    disabled={busy}
                  >
                    {busy ? "授权中…" : "重新授权"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => onToggle(connection, connection.enabled === false)}
                  disabled={busy}
                >
                  {connection.enabled === false ? "启用" : "停用"}
                </button>
                <button
                  type="button"
                  className="email-connection-card__remove"
                  onClick={() => onRemove(connection)}
                  disabled={busy}
                >
                  移除
                </button>
              </footer>
            </article>
          );
        })
      )}
    </section>
  );
}
