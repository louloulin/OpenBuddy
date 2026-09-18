/**
 * R48 — 「登录」对话框(基于 Casdoor)。
 *
 * 为什么需要它:左下角账户菜单的登录入口以前在未配置企业身份时,点下去
 * 只是把人送到「设置 → 账户管理」的表单(R26 的"入口诚实"改法)。副作用是
 * 这个入口再也不叫"登录",点完也没有任何"登录正在进行"的反馈 —— 用户三次
 * 反馈「点击登录为什么没有弹出」。
 *
 * 这里把登录这件事收进一个**点一下一定弹出**的对话框,并保留 git 历史
 * (R15 / 536dc0e)里那条真·Casdoor 登录链路:
 *   1. 打开时拉 `casdoor:status`;
 *   2. 已登录 → 展示身份 + 退出登录;
 *   3. 未配置 → 在对话框内直接补齐 issuer / clientId / redirectUri(不用跳设置),
 *      保存后立即发起登录;
 *   4. 已配置 → 「企业账号登录」调 `casdoor:login`,主进程用系统浏览器打开
 *      Casdoor 授权页;短信 / 微信在 capabilities 允许时同样可点;
 *   5. 监听 `casdoor://auth`,授权完成就地刷新身份,无需重开对话框。
 *
 * 依赖 app 层的 `@/lib/casdoor/casdoor-client`(与 FeedbackDialog 依赖
 * `@/stores/feedback-store` 同一模式),不在本包内重复定义 IPC 契约。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  casdoorStatus,
  casdoorSaveConfig,
  casdoorLogin,
  casdoorLogout,
  casdoorLoginCapabilities,
  type CasdoorSessionView,
} from "@/lib/casdoor/casdoor-client";
import { listenSafe } from "@/lib/platform/electron-api";
import { ModalShell, ModalHead, ModalBody, ModalFooter } from "./ModalShell";

export interface CasdoorSignInDialogProps {
  open: boolean;
  onClose(): void;
  /** 「账户设置」入口(完整的企业身份 / 租户 / 成员治理都在那)。 */
  onOpenSettings?(): void;
  /** 登录状态变化时通知宿主(侧栏账户区据此刷新)。 */
  onSessionChange?(session: CasdoorSessionView | null): void;
  /** 轻提示(宿主 toast)。 */
  onToast?(message: string): void;
}

interface ConfigDraft {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  /**
   * Casdoor 控制台地址。主进程要求它与 issuer 同源 —— Casdoor 默认就是
   * 同一个站点,所以留空时用 issuer 的 origin 兜底,不额外增加用户负担;
   * 需要指向独立控制台的人仍然能改。
   */
  managementUrl: string;
}

const EMPTY_DRAFT: ConfigDraft = {
  issuer: "",
  clientId: "",
  redirectUri: "casdoor://localhost/callback",
  scope: "openid profile email",
  managementUrl: "",
};

/** 绝对值 http(s) 地址才算"用户真的填了"。 */
function asAbsoluteHttpUrl(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.search || url.hash) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * 控制台地址解析。主进程在未配置时会把 managementUrl 兜底成 `${issuer}/` ——
 * issuer 为空时那就是一个孤零零的 `/`,不是用户填的值。所以这里只认"绝对
 * http(s) 地址",其余一律回落到 issuer 的 origin(主进程要求两者同源)。
 */
function resolveManagementUrl(issuer: string, managementUrl: string): string {
  const explicit = asAbsoluteHttpUrl(managementUrl);
  if (explicit) return explicit;
  const issuerUrl = asAbsoluteHttpUrl(issuer) ?? (() => {
    try {
      const u = new URL(issuer.trim());
      return /^https?:$/i.test(u.protocol) ? issuer.trim() : null;
    } catch {
      return null;
    }
  })();
  if (!issuerUrl) return "";
  try {
    return new URL(issuerUrl).origin;
  } catch {
    return "";
  }
}

/** 把主进程返回的原始错误翻译成用户能处置的一句话。 */
function humanize(message: string): string {
  const raw = message.replace(/^Error:\s*/, "");
  if (/配置无效|未配置|not configured|configuration/i.test(raw)) {
    // 带上主进程的原始 reason:它逐项说明了缺什么(issuer / clientID /
    // 同源管理地址 / casdoor://localhost/callback),比一句笼统的
    // "还没配置完"更能让人把表单改对。
    return raw.includes("配置无效") ? raw : "企业身份服务还没配置完:填好 issuer / clientId 和控制台地址后即可登录。";
  }
  if (/network|ENOTFOUND|ECONNREFUSED|fetch failed|timeout/i.test(raw)) {
    return "连不上 Casdoor 服务,检查网络和 issuer 地址是否正确。";
  }
  return raw || "登录失败,请稍后重试。";
}

export function CasdoorSignInDialog({
  open,
  onClose,
  onOpenSettings,
  onSessionChange,
  onToast,
}: CasdoorSignInDialogProps) {
  const [session, setSession] = useState<CasdoorSessionView | null>(null);
  const [draft, setDraft] = useState<ConfigDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"default" | "sms" | "wechat" | "save" | null>(null);
  const [message, setMessage] = useState("");
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [wechatEnabled, setWechatEnabled] = useState(false);
  const sessionRef = useRef<CasdoorSessionView | null>(null);

  const publish = useCallback(
    (next: CasdoorSessionView | null) => {
      sessionRef.current = next;
      setSession(next);
      onSessionChange?.(next);
    },
    [onSessionChange],
  );

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await casdoorStatus();
      publish(status);
      setDraft({
        issuer: status.config.issuer ?? "",
        clientId: status.config.clientId ?? "",
        redirectUri: status.config.redirectUri || EMPTY_DRAFT.redirectUri,
        scope: status.config.scope || EMPTY_DRAFT.scope,
        // 主进程未配置时的占位 `/` 不进输入框,避免看起来"已经填过了"。
        managementUrl: asAbsoluteHttpUrl(status.config.managementUrl) ?? "",
      });
      if (status.config.configured) {
        try {
          const caps = await casdoorLoginCapabilities();
          setSmsEnabled(caps.sms.enabled === true);
          setWechatEnabled(caps.wechat.enabled === true);
        } catch {
          setSmsEnabled(false);
          setWechatEnabled(false);
        }
      } else {
        setSmsEnabled(false);
        setWechatEnabled(false);
      }
      return status;
    } catch (error) {
      setMessage(humanize(String(error)));
      publish(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [publish]);

  // 打开时刷新状态 + 订上授权完成事件。
  useEffect(() => {
    if (!open) return undefined;
    setMessage("");
    void refreshStatus();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenSafe<CasdoorSessionView>("casdoor://auth", (event) => {
      if (disposed) return;
      publish(event.payload);
      if (event.payload.status === "signed_in") {
        setMessage("登录成功。");
        onToast?.("已登录企业账户");
      }
    }).then((cleanup) => {
      if (disposed) cleanup?.();
      else unlisten = cleanup ?? undefined;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open, refreshStatus, publish, onToast]);

  const persistConfig = useCallback(async () => {
    const patch = {
      issuer: draft.issuer.trim(),
      clientId: draft.clientId.trim(),
      redirectUri: draft.redirectUri.trim() || EMPTY_DRAFT.redirectUri,
      scope: draft.scope.trim() || EMPTY_DRAFT.scope,
      managementUrl: resolveManagementUrl(draft.issuer, draft.managementUrl),
    };
    if (!patch.issuer || !patch.clientId) {
      setMessage("issuer 和 clientId 必填。");
      return null;
    }
    if (!patch.managementUrl) {
      setMessage("issuer 必须是完整的 http(s) 地址,例如 https://casdoor.example.com。");
      return null;
    }
    setBusy("save");
    try {
      await casdoorSaveConfig(patch);
      const status = await refreshStatus();
      return status;
    } catch (error) {
      setMessage(humanize(String(error)));
      return null;
    } finally {
      setBusy(null);
    }
  }, [draft, refreshStatus]);

  const startLogin = useCallback(
    async (provider: "default" | "sms" | "wechat") => {
      setMessage("");
      setBusy(provider);
      try {
        // 未配置(或用户改过字段)时先落盘配置,再发起登录 —— 这样"点登录"
        // 在任何状态下都是一条能走到底的路径。
        const current = sessionRef.current;
        if (!current?.config.configured) {
          const saved = await persistConfig();
          if (!saved?.config.configured) return;
        }
        const result = await casdoorLogin(provider);
        if (result.ok) {
          setMessage(
            provider === "sms"
              ? "已用系统浏览器打开短信登录页,完成验证后这里会自动更新。"
              : provider === "wechat"
                ? "已用系统浏览器打开微信登录页,完成授权后这里会自动更新。"
                : "已用系统浏览器打开 Casdoor 登录页,完成授权后这里会自动更新。",
          );
        } else {
          setMessage(humanize(result.error));
        }
      } catch (error) {
        setMessage(humanize(String(error)));
      } finally {
        setBusy(null);
      }
    },
    [persistConfig],
  );

  const signOut = useCallback(async () => {
    setBusy("default");
    try {
      await casdoorLogout();
      publish(null);
      setMessage("已退出登录。");
      onToast?.("已退出企业账户");
    } catch (error) {
      setMessage(humanize(String(error)));
    } finally {
      setBusy(null);
    }
  }, [publish, onToast]);

  const signedIn = session?.status === "signed_in" && Boolean(session.identity);
  const configured = session?.config.configured === true;
  const identity = session?.identity ?? null;
  const displayName =
    identity?.displayName ?? identity?.email ?? identity?.phone ?? identity?.subject ?? "企业账户";

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="sm"
      variant="prompt"
      className="casdoor-signin"
      ariaLabel="登录"
    >
      <ModalHead
        eyebrow="登录"
        title={signedIn ? displayName : "登录 OpenBuddy"}
        onClose={onClose}
      />
      <ModalBody>
        {loading ? (
          <p className="casdoor-signin__lead" data-testid="casdoor-signin-loading">
            正在读取登录状态…
          </p>
        ) : signedIn ? (
          <div className="casdoor-signin__identity" data-testid="casdoor-signin-identity">
            <span className="casdoor-signin__avatar" aria-hidden="true">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <div className="casdoor-signin__identity-text">
              <strong>{displayName}</strong>
              <span>
                {identity?.email ?? identity?.phone ?? "企业账户已连接"}
                {session?.provider ? ` · ${session.provider}` : ""}
              </span>
            </div>
          </div>
        ) : (
          <div className="casdoor-signin__form" data-testid="casdoor-signin-form">
            <p className="casdoor-signin__lead">
              {configured
                ? "将用系统浏览器打开 Casdoor 授权页,完成后自动回到 OpenBuddy。"
                : "首次使用需要填 Casdoor 服务地址与应用凭据,保存后立即发起登录。"}
            </p>
            {!configured ? (
              <>
                <label className="casdoor-signin__field">
                  <span>Issuer</span>
                  <input
                    value={draft.issuer}
                    onChange={(e) => { setDraft((d) => ({ ...d, issuer: e.target.value })); setMessage(""); }}
                    placeholder="https://casdoor.example.com"
                    data-testid="casdoor-signin-issuer"
                  />
                </label>
                <label className="casdoor-signin__field">
                  <span>Client ID</span>
                  <input
                    value={draft.clientId}
                    onChange={(e) => { setDraft((d) => ({ ...d, clientId: e.target.value })); setMessage(""); }}
                    placeholder="应用 client id"
                    data-testid="casdoor-signin-client-id"
                  />
                </label>
                <label className="casdoor-signin__field">
                  <span>控制台地址(可选)</span>
                  <input
                    value={draft.managementUrl}
                    onChange={(e) => setDraft((d) => ({ ...d, managementUrl: e.target.value }))}
                    placeholder="默认与 issuer 同源"
                    data-testid="casdoor-signin-management"
                  />
                </label>
                <label className="casdoor-signin__field">
                  <span>回调地址</span>
                  <input
                    value={draft.redirectUri}
                    onChange={(e) => setDraft((d) => ({ ...d, redirectUri: e.target.value }))}
                    placeholder="casdoor://localhost/callback"
                    data-testid="casdoor-signin-redirect"
                  />
                </label>
              </>
            ) : null}
          </div>
        )}
        {message ? (
          <p className="casdoor-signin__message" role="status" data-testid="casdoor-signin-message">
            {message}
          </p>
        ) : null}
      </ModalBody>
      <ModalFooter
        hint={
          onOpenSettings ? (
            <button
              type="button"
              className="casdoor-signin__link"
              onClick={() => { onClose(); onOpenSettings(); }}
            >
              账户设置(租户 / 成员 / 权限)
            </button>
          ) : null
        }
      >
        {signedIn ? (
          <>
            <button
              type="button"
              className="casdoor-signin__btn casdoor-signin__btn--ghost"
              onClick={refreshStatus}
              disabled={busy !== null}
            >
              刷新
            </button>
            <button
              type="button"
              className="casdoor-signin__btn casdoor-signin__btn--danger"
              onClick={signOut}
              disabled={busy !== null}
              data-testid="casdoor-signin-signout"
            >
              退出登录
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="casdoor-signin__btn casdoor-signin__btn--primary"
              onClick={() => void startLogin("default")}
              disabled={busy !== null || loading}
              data-testid="casdoor-signin-enterprise"
            >
              {busy === "default" ? "打开中…" : configured ? "企业账号登录" : "保存并登录"}
            </button>
            {smsEnabled ? (
              <button
                type="button"
                className="casdoor-signin__btn casdoor-signin__btn--ghost"
                onClick={() => void startLogin("sms")}
                disabled={busy !== null || loading}
                data-testid="casdoor-signin-sms"
              >
                {busy === "sms" ? "打开中…" : "短信登录"}
              </button>
            ) : null}
            {wechatEnabled ? (
              <button
                type="button"
                className="casdoor-signin__btn casdoor-signin__btn--ghost"
                onClick={() => void startLogin("wechat")}
                disabled={busy !== null || loading}
                data-testid="casdoor-signin-wechat"
              >
                {busy === "wechat" ? "打开中…" : "微信登录"}
              </button>
            ) : null}
          </>
        )}
      </ModalFooter>
    </ModalShell>
  );
}
