import { useCallback, useEffect, useState } from "react";
import { Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { securityPolicyGet, securityPolicySet, type SandboxPolicy } from "@openbuddy/client/api/approvals";
import { useLocale } from "@/shared/i18n";

/**
 * 沙箱与网络策略 (G2-3)：三条白名单（文件写入 / 命令 / 网络域名）。
 *
 * 这是**硬边界**：它在权限闸门之前生效，「完全访问」「始终允许」「自动化放行」都绕不过。
 * 名单为空 = 该维度不限制。
 */
const EMPTY: SandboxPolicy = { fileWriteAllow: [], commandAllow: [], networkAllow: [] };

const DIMENSIONS: Array<{ key: keyof SandboxPolicy; labelKey: string; hintKey: string; placeholderKey: string }> = [
  { key: "fileWriteAllow", labelKey: "security.sandbox.file.title", hintKey: "security.sandbox.file.hint", placeholderKey: "security.sandbox.file.placeholder" },
  { key: "commandAllow", labelKey: "security.sandbox.command.title", hintKey: "security.sandbox.command.hint", placeholderKey: "security.sandbox.command.placeholder" },
  { key: "networkAllow", labelKey: "security.sandbox.network.title", hintKey: "security.sandbox.network.hint", placeholderKey: "security.sandbox.network.placeholder" },
];

export function SecuritySandboxTab() {
  const { t } = useLocale();
  const [policy, setPolicy] = useState<SandboxPolicy>(EMPTY);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void securityPolicyGet()
      .then((next) => {
        setPolicy(next ?? EMPTY);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = useCallback(
    async (next: SandboxPolicy) => {
      setBusy(true);
      setError(null);
      try {
        const saved = await securityPolicySet(next);
        setPolicy(saved ?? next);
      } catch (e) {
        setError(String(e).replace(/^Error:\s*/, ""));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const add = (key: keyof SandboxPolicy, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const list = policy[key];
    if (list.includes(trimmed)) return;
    void save({ ...policy, [key]: [...list, trimmed] });
    setDraft((prev) => ({ ...prev, [key]: "" }));
  };

  return (
    <div className="sec-card">
      <div className="sec-card__head">
        <div className="sec-card__title">
          <ShieldCheck size={15} />
          <span>{t("security.sandbox.title")}</span>
        </div>
        <div className="sec-card__hint">{t("security.sandbox.hint")}</div>
      </div>
      {error && <div className="sec-error">{error}</div>}
      {!loaded ? (
        <div className="sec-muted">{t("security.loading")}</div>
      ) : (
        DIMENSIONS.map((dimension) => {
          const list = policy[dimension.key];
          return (
            <div key={dimension.key} className="sec-sandbox__group">
              <div className="sec-sandbox__head">
                <span className="sec-sandbox__title">{t(dimension.labelKey)}</span>
                <span className="sec-sandbox__hint">{t(dimension.hintKey)}</span>
              </div>
              <div className="sec-chips">
                {list.length === 0 ? (
                  <span className="sec-muted">{t("security.sandbox.empty")}</span>
                ) : (
                  list.map((item) => (
                    <span className="sec-chip" key={item}>
                      <code>{item}</code>
                      <button
                        type="button"
                        className="sec-chip__x"
                        aria-label={t("security.sandbox.remove", { item })}
                        disabled={busy}
                        onClick={() => void save({ ...policy, [dimension.key]: list.filter((one) => one !== item) })}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="sec-add">
                <input
                  type="text"
                  value={draft[dimension.key] ?? ""}
                  placeholder={t(dimension.placeholderKey)}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [dimension.key]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add(dimension.key, draft[dimension.key] ?? "");
                    }
                  }}
                />
                <button
                  type="button"
                  className="sec-btn sec-btn--ink"
                  disabled={busy || !(draft[dimension.key] ?? "").trim()}
                  onClick={() => add(dimension.key, draft[dimension.key] ?? "")}
                >
                  <Plus size={14} /> {t("security.sandbox.add")}
                </button>
                <button
                  type="button"
                  className="sec-btn"
                  disabled={busy || list.length === 0}
                  onClick={() => void save({ ...policy, [dimension.key]: [] })}
                >
                  <RotateCcw size={14} /> {t("security.sandbox.clear")}
                </button>
              </div>
            </div>
          );
        })
      )}
      <p className="sec-footnote">{t("security.sandbox.note")}</p>
    </div>
  );
}
