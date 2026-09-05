/**
 * ProviderDiagnosticCard — 邮箱能力诊断面板
 *
 * 从 EmailPanel 1625 行内联的 `<div className="email-connection-warning">` 提取。
 * 展示 provider 的 readiness(ready / partial / reauthorization-required / unavailable)
 * + 发现到的能力 + 缺失的能力 + 账户级状态 + 跳到连接器的入口。
 *
 * 设计:
 *   - 纯展示组件,父组件传入 `providerDiagnostic`
 *   - 提供 `onNavigateToConnectors` callback 跳到连接器设置
 *   - 用 `<details>` 折叠逐项能力,默认收起,降低视觉密度
 *   - 状态标签本地化(ready → "已就绪")
 *
 * @see docs/comet/changes/email-module-architecture-review/specs/email/spec.md §2.5 EmailSidebar
 */
import type { EmailProviderDiagnostic } from "@openbuddy/capability-email";

export interface ProviderDiagnosticCardProps {
  diagnostic: EmailProviderDiagnostic;
  onNavigateToConnectors: () => void;
  /** 操作名称的本地化标签。默认走 providerOperationLabel 内置映射。 */
  operationLabel?: (name: string) => string;
}

const READINESS_LABEL: Record<EmailProviderDiagnostic["readiness"], string> = {
  ready: "邮箱能力已就绪",
  partial: "邮箱能力部分可用",
  "reauthorization-required": "邮箱需要重新授权",
  unavailable: "邮箱连接不可用",
};

const ACCOUNT_CAPABILITY_LABEL: Record<string, string> = {
  write: "可写",
  attachments: "附件",
  sync: "同步",
  management: "管理",
  read: "只读",
};

const DEFAULT_OPERATION_LABEL: Record<string, string> = {
  账户读取: "账户读取",
  邮件读取: "邮件读取",
  标签读取: "邮箱标签",
  草稿写入: "草稿写入",
  发送邮件: "受控发送",
  附件读取: "附件读取",
  附件下载: "附件下载",
  增量同步: "增量同步",
};

export function ProviderDiagnosticCard({
  diagnostic,
  onNavigateToConnectors,
  operationLabel,
}: ProviderDiagnosticCardProps): JSX.Element {
  const labelOperation = operationLabel ?? ((name: string) => DEFAULT_OPERATION_LABEL[name] ?? name);
  return (
    <div
      className={`email-connection-warning email-provider-diagnostic email-provider-diagnostic--${diagnostic.readiness}`}
      aria-label="邮箱连接诊断"
      data-readiness={diagnostic.readiness}
    >
      <strong>{READINESS_LABEL[diagnostic.readiness]}</strong>
      <span>{diagnostic.message || `Profile:${diagnostic.profile} · 已发现 ${diagnostic.discoveredTools.length} 个工具`}</span>
      {diagnostic.missingCapabilities.length > 0 ? (
        <small>缺少:{diagnostic.missingCapabilities.slice(0, 5).join("、")}</small>
      ) : null}
      {diagnostic.accounts.length > 0 ? (
        <div className="email-provider-diagnostic__accounts" aria-label="账户级邮箱能力">
          {diagnostic.accounts.map((diagnosticAccount) => (
            <span
              key={diagnosticAccount.id}
              title={`${diagnosticAccount.address} · ${diagnosticAccount.provider ?? diagnostic.provider}`}
              className={diagnosticAccount.status === "connected" ? "is-ready" : "is-muted"}
              data-account-id={diagnosticAccount.id}
            >
              {diagnosticAccount.address}:{diagnosticAccount.status === "connected"
                ? (diagnosticAccount.capabilities.write ? ACCOUNT_CAPABILITY_LABEL.write : ACCOUNT_CAPABILITY_LABEL.read)
                : "需授权"}
              {diagnosticAccount.capabilities.management ? ` · ${ACCOUNT_CAPABILITY_LABEL.management}` : ""}
              {diagnosticAccount.capabilities.attachments ? ` · ${ACCOUNT_CAPABILITY_LABEL.attachments}` : ""}
              {diagnosticAccount.capabilities.sync ? ` · ${ACCOUNT_CAPABILITY_LABEL.sync}` : ""}
            </span>
          ))}
        </div>
      ) : null}
      <details className="email-provider-diagnostic__details">
        <summary>查看逐项能力</summary>
        <div className="email-provider-diagnostic__operations">
          {diagnostic.operations.map((operation) => (
            <span
              key={operation.name}
              className={operation.ready ? "is-ready" : "is-muted"}
              data-operation={operation.name}
            >
              {operation.ready ? "✓" : "!"} {labelOperation(operation.name)}
              {operation.missingTools.length > 0 ? ` · 缺少 ${operation.missingTools.join("、")}` : ""}
            </span>
          ))}
        </div>
        <button type="button" onClick={onNavigateToConnectors}>配置邮箱连接器</button>
      </details>
    </div>
  );
}
