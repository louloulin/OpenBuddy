import { useCallback, useEffect, useState } from "react";
import {
  capabilityPackRemove,
  capabilityPackSetContribution,
  capabilityPackSetEnabled,
  capabilityPacksList,
} from "@openbuddy/client/agent-client";
import type { CapabilityPack } from "@openbuddy/protocol/experts";

/**
 * 能力包 (B1a): what a WorkBuddy import actually added, with the same switches the host persists —
 * whole-pack 启用/禁用, per-contribution toggles, and 移除 returning to the pre-install state.
 */
const KIND_LABEL: Record<CapabilityPack["contributions"][number]["kind"], string> = {
  skill: "技能",
  prompt: "指令",
  mcp: "MCP",
};

interface Props {
  onToast?: (message: string) => void;
}

export function CapabilityPacksPanel({ onToast }: Props) {
  const [packs, setPacks] = useState<CapabilityPack[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPacks(await capabilityPacksList()); }
    catch (e) { setError(String(e).replace(/^Error:\s*/, "")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<CapabilityPack[]>) => {
    setBusy(true); setError("");
    try { setPacks(await action()); }
    catch (e) { setError(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(false); }
  };

  const remove = async (pack: CapabilityPack) => {
    if (!confirm(`移除能力包「${pack.name}」？技能与指令文件会删除，自行修改过的指令会保留。`)) return;
    setBusy(true); setError("");
    try {
      const result = await capabilityPackRemove(pack.id);
      await load();
      onToast?.(result.kept.length ? `已移除，保留 ${result.kept.length} 项你修改过的内容` : "能力包已移除");
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cap-packs" aria-label="能力包">
      <div className="cap-packs__head">
        <h4 className="res-panel__subtitle">能力包</h4>
        <span className="res-panel__muted">WorkBuddy 包导入的技能 / 指令 / MCP，在这里整体或逐项管理</span>
      </div>
      {error && <p className="res-panel__error" role="alert">{error}</p>}
      {packs.length === 0 ? (
        <p className="res-panel__muted">还没有安装能力包。导入 WorkBuddy 包后，它的贡献会出现在这里。</p>
      ) : (
        <ul className="cap-packs__list">
          {packs.map((pack) => {
            const active = pack.contributions.filter((item) => item.enabled).length;
            const expanded = open === pack.id;
            return (
              <li className="cap-pack" key={pack.id}>
                <div className="cap-pack__row">
                  <button
                    type="button"
                    className="cap-pack__main"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : pack.id)}
                  >
                    <strong>{pack.name}</strong>
                    <span className="res-panel__muted">
                      {pack.id} · {active}/{pack.contributions.length} 项启用
                      {pack.requires.length ? ` · 需要 ${pack.requires.join("、")}` : ""}
                    </span>
                  </button>
                  <button type="button" className="res-panel__btn" disabled={busy} onClick={() => { void run(() => capabilityPackSetEnabled(pack.id, !pack.enabled)); }}>
                    {pack.enabled ? "禁用" : "启用"}
                  </button>
                  <button type="button" className="res-panel__btn res-panel__btn--danger" disabled={busy} onClick={() => { void remove(pack); }}>
                    移除
                  </button>
                </div>
                {expanded && (
                  <ul className="cap-pack__items">
                    {pack.contributions.map((item) => (
                      <li key={`${item.kind}:${item.name}`}>
                        <label className="cap-pack__item">
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            disabled={busy}
                            onChange={() => { void run(() => capabilityPackSetContribution(pack.id, item.kind, item.name, !item.enabled)); }}
                          />
                          <span>{KIND_LABEL[item.kind]} · {item.name}</span>
                        </label>
                      </li>
                    ))}
                    {pack.skipped.length > 0 && (
                      <li className="res-panel__muted">
                        跳过：{pack.skipped.map((item) => `${item.kind}:${item.name}（${item.reason}）`).join("；")}
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
