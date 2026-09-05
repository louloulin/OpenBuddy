/**
 * OnboardingCard — 邮箱未连接空状态 + 主流邮箱接入向导
 *
 * 从 EmailPanel 1625 行内联的 `<div className="email-empty">` + <section className="email-provider-onboarding">
 * 提取。当用户没有任何邮箱连接时,展示此面板引导授权。
 *
 * 设计:
 *   - 4 个主流 provider 卡片(Gmail / Outlook / QQ+163 / Fastmail)用 grid 排列
 *   - 主 CTA:`authorizeMailServer` 如果有 MCP 连接器;否则 `onAddConnection`
 *   - `authorizing` prop 控制 CTA 按钮的"授权中…" loading 态
 *   - `mailServerName` 可选;有则提示用户「检测到连接器 X,请先完成授权」
 *
 * @see docs/comet/changes/email-module-architecture-review/specs/email/spec.md §2.5 EmailSidebar
 */

export type ProviderType = "gmail-api" | "graph-api" | "jmap-api" | "mcp";

export interface EmailProviderGuide {
  name: string;
  access: string;
  capabilities: string;
  note: string;
}

export interface OnboardingCardProps {
  /** 当前已知的 MCP 连接器,如果有,引导用户去授权。 */
  mailServerName?: string;
  /** 是否正在授权(用于按钮 loading 态) */
  authorizing: boolean;
  /** 点击主 CTA 的回调 — 有 mailServer 时调 authorizeMailServer,否则调 openConnectors */
  onPrimaryAction: () => void;
}

const EMAIL_PROVIDER_GUIDES: readonly EmailProviderGuide[] = [
  { name: "Gmail / Google Workspace", access: "OAuth + Gmail MCP/API", capabilities: "收件箱、搜索、标签、草稿、受控发送、附件", note: "推荐优先验收" },
  { name: "Outlook / Microsoft 365", access: "Microsoft Graph OAuth", capabilities: "邮件、文件夹、草稿、受控发送、附件", note: "需最小 Graph scope" },
  { name: "QQ / 163 / 企业邮箱", access: "Agent Mail MCP 或 IMAP/SMTP", capabilities: "收件箱、搜索、归档、草稿;能力取决于连接器", note: "建议使用授权码/应用专用密码" },
  { name: "Fastmail / JMAP", access: "JMAP OAuth/Token", capabilities: "标准邮件、文件夹、草稿、附件、增量同步", note: "适合作为标准协议验收" },
];

export function OnboardingCard({
  mailServerName,
  authorizing,
  onPrimaryAction,
}: OnboardingCardProps): JSX.Element {
  const ctaLabel = authorizing
    ? "授权中…"
    : mailServerName
      ? "授权邮箱"
      : "打开连接器";

  return (
    <div className="email-empty" role="region" aria-label="邮箱未连接提示">
      <strong>尚未连接邮箱</strong>
      <span>
        {mailServerName
          ? `检测到邮箱连接器「${mailServerName}」,请先完成授权。`
          : "先选择一个邮箱连接器,完成授权后即可统一管理收件箱、草稿和邮件操作。"}
      </span>
      <div className="email-connection-actions">
        <button type="button" onClick={onPrimaryAction} disabled={authorizing} data-testid="onboarding-primary">
          {ctaLabel}
        </button>
      </div>
      <section className="email-provider-onboarding" aria-label="主流邮箱接入向导">
        <header>
          <strong>主流邮箱接入方式</strong>
          <span>OpenBuddy 不保存邮箱密码;连接器能力以 Provider readiness 为准。</span>
        </header>
        <div className="email-provider-onboarding__grid">
          {EMAIL_PROVIDER_GUIDES.map((guide) => (
            <article key={guide.name} data-provider={guide.name}>
              <strong>{guide.name}</strong>
              <small>{guide.access}</small>
              <span>{guide.capabilities}</span>
              <em>{guide.note}</em>
            </article>
          ))}
        </div>
        <p>
          连接后可在邮件页查看逐项能力;缺少草稿、附件或发送工具时,OpenBuddy 会保持只读或部分可用,不会静默执行未声明操作。
        </p>
      </section>
    </div>
  );
}
