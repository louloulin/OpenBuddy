/**
 * OpenBuddy 账号绑定面板（多端登录统一视图）。
 *
 * 用于展示当前 Casdoor 用户已绑定的登录方式（密码、OAuth、微信、短信、邮箱等），
 * 并允许解绑不再使用的身份。通过 IPC `casdoor:list-account-linking` 与
 * `casdoor:unlink-account` 通信；所有操作均需当前用户登录态校验。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, RefreshCw, Unlink, ShieldCheck } from "lucide-react";
import {
  casdoorListAccountLinking,
  casdoorUnlinkAccount,
  casdoorStatus,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorAccountLinkingOption } from "@/lib/casdoor/casdoor-client";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  wechat: "微信",
  sms: "短信",
  email: "邮箱",
  github: "GitHub",
  google: "Google",
  dingtalk: "钉钉",
  feishu: "飞书",
  ldap: "LDAP",
  oauth_generic: "OAuth",
  password: "密码",
};

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

function providerLabel(option: CasdoorAccountLinkingOption): string {
  const key = (option.type || option.provider || "password").toLowerCase();
  return PROVIDER_LABEL[key] || option.provider || option.type || "未知";
}

export function AccountLinkingPanel() {
  const [owner, setOwner] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [options, setOptions] = useState<CasdoorAccountLinkingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const session = await casdoorStatus().catch(() => null);
      const orgOwner = session?.identity?.owner;
      const sub = session?.identity?.subject;
      setOwner(orgOwner ?? null);
      setSubject(sub ?? null);
      if (!orgOwner || !sub) {
        setOptions([]);
        return;
      }
      const list = await casdoorListAccountLinking(orgOwner, sub).catch((error) => {
        setMessage({ kind: "warn", text: `加载绑定列表失败：${describeError(error)}` });
        return [] as CasdoorAccountLinkingOption[];
      });
      setOptions(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sorted = useMemo(
    () => [...options].sort((a, b) => {
      const ka = providerLabel(a);
      const kb = providerLabel(b);
      return ka.localeCompare(kb);
    }),
    [options],
  );

  const handleUnlink = useCallback(async (option: CasdoorAccountLinkingOption) => {
    if (!owner || !subject) return;
    const type = option.type || option.provider || "";
    const identifier = option.identifier || "";
    if (!type || !identifier) {
      setMessage({ kind: "warn", text: "该绑定缺少必要字段，无法解绑。" });
      return;
    }
    setBusyKey(`${type}:${identifier}`);
    try {
      await casdoorUnlinkAccount({ owner, name: subject, type, identifier });
      await reload();
      setMessage({ kind: "ok", text: `已解绑 ${providerLabel(option)}（${identifier}）` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setBusyKey(null);
    }
  }, [owner, subject, reload]);

  return (
    <SectionShell
      title="账号绑定"
      desc="统一管理当前用户的所有登录身份（密码、微信、GitHub、邮箱、短信等）。解绑后该登录方式将无法再用于登录当前账号，请至少保留一种可用登录方式。"
    >
      {!owner || !subject ? (
        <p className="settings-hint">请先登录企业账户，再查看账号绑定列表。</p>
      ) : (
        <p className="settings-hint">主体：<strong>{subject}</strong> · 组织：<strong>{owner}</strong></p>
      )}

      <div className="account-section" data-testid="account-linking-section">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <ShieldCheck size={16} /> 登录方式
          </h3>
          <button className="settings-btn" onClick={reload} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
        {loading && sorted.length === 0 ? (
          <p className="settings-hint">正在加载绑定列表…</p>
        ) : sorted.length === 0 ? (
          <p className="settings-hint">暂无登录方式绑定。请通过 Casdoor 管理后台或登录入口添加新方式。</p>
        ) : (
          <ul className="shortcuts-list" data-testid="account-linking-list">
            {sorted.map((option) => {
              const key = `${option.type || option.provider || "password"}:${option.identifier || ""}`;
              const label = providerLabel(option);
              const identifier = option.identifier || "—";
              const linkedAt = option.linkedAt ? new Date(option.linkedAt).toLocaleString() : "—";
              const disabled = option.enabled === false;
              return (
                <li key={key} className="shortcuts-list__row">
                  <div className="shortcuts-list__row-meta">
                    <span className="shortcuts-list__action">
                      <Link2 size={12} /> {label} · {identifier}
                    </span>
                    <span className="shortcuts-list__key">
                      绑定时间：{linkedAt}
                      {disabled ? <span className="settings-msg--warn"> · 已停用</span> : null}
                    </span>
                  </div>
                  <button
                    className="settings-btn settings-btn--ghost"
                    data-testid={`account-linking-unlink-${key}`}
                    onClick={() => handleUnlink(option)}
                    disabled={busyKey === key || !option.identifier || !option.type}
                  >
                    <Unlink size={14} /> 解绑
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="account-linking-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default AccountLinkingPanel;
