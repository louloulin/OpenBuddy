import { appConfirm } from "../../../shared/ui/AppDialog";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { memoryList, memoryRewrite } from "@openbuddy/client/agent-client";
import type { MemoryEntry } from "@openbuddy/protocol/dto";
import { useLocale } from "@/shared/i18n";
import { SectionShell } from "./shared";

// ---------- 记忆 (20261116-pii W5.1–W5.3) ----------

export function MemorySettingsPanel() {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);

  const reload = useCallback(async () => {
    try {
      setEntries(await memoryList());
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRewrite = async () => {
    if (!(await appConfirm({ title: t("memory.rewriteConfirm") }))) return;
    setBusy(true);
    try {
      const result = await memoryRewrite();
      setMsg(t("memory.rewriteDone", { merged: result.merged, kept: result.kept }));
      await reload();
    } catch (e) {
      setMsg(t("memory.rewriteFailed", { error: String(e).replace(/^Error:\s*/, "") }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title={t("memory.title")}
      desc={t("memory.desc")}
    >
      <p className="settings-hint">
        {t("memory.hintLead")}<code>ob_remember</code>{t("memory.hintTail")}
      </p>
      {entries.length > 0 ? (
        <ul className="settings-list">
          {entries.map((entry) => (
            <li key={`${entry.scope}/${entry.path}`} className="settings-list__item">
              <span className="settings-list__name">{entry.path}</span>
              <span className="settings-list__meta">
                {entry.scope === "global" ? t("memory.scopeGlobal") : t("memory.scopeWorkspace")} · {t("memory.sizeBytes", { n: entry.size })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-hint">{t("memory.empty")}</p>
      )}
      <div className="settings-actions">
        <button className="settings-btn" onClick={handleRewrite} disabled={busy}>
          <RefreshCw size={14} /> {t("memory.rewrite")}
        </button>
      </div>
      {msg && <p className="settings-msg">{msg}</p>}
    </SectionShell>
  );
}
