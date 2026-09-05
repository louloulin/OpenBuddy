/**
 * OpenBuddy 资源目录面板（项目 / 知识库 / 存储连接）。
 *
 * 通过 casdoor:resource-{list,get,create,update,delete} IPC 通道管理当前
 * 租户下的 OpenBuddy 工作台资源。后端基于 Gateway 资源 ACL 与乐观 CAS
 * （resource_state.revision）保证并发安全。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, FileText, Folder, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  casdoorListResources,
  casdoorCreateResource,
  casdoorUpdateResource,
  casdoorDeleteResource,
} from "@/lib/casdoor/casdoor-client";
import type { CasdoorResourceCreateInput, CasdoorResourceRecord, CasdoorResourceType } from "@openbuddy/auth-casdoor";
import { CASDOOR_RESOURCE_TYPES } from "@openbuddy/auth-casdoor";

function SectionShell({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {desc && <p className="settings-section__desc">{desc}</p>}
      <div className="settings-section__body">{children}</div>
    </div>
  );
}

const TYPE_LABEL: Record<CasdoorResourceType, string> = {
  project: "项目",
  knowledge_base: "知识库",
  storage_connection: "存储连接",
};

const TYPE_ICON: Record<CasdoorResourceType, typeof Folder> = {
  project: Folder,
  knowledge_base: FileText,
  storage_connection: Database,
};

function describeError(error: unknown): string {
  if (!error) return "操作失败";
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  return String(error).replace(/^Error:\s*/, "");
}

interface Draft {
  type: CasdoorResourceType;
  name: string;
  metadata: string;
}

export function ResourceCatalogPanel() {
  const [type, setType] = useState<CasdoorResourceType>("project");
  const [resources, setResources] = useState<CasdoorResourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft>({ type: "project", name: "", metadata: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; metadata: string; version: number }>({ name: "", metadata: "", version: 0 });

  const reload = useCallback(async (filter?: CasdoorResourceType) => {
    setLoading(true);
    setMessage(null);
    try {
      const list = await casdoorListResources(filter ?? type).catch((error) => {
        setMessage({ kind: "warn", text: `加载资源失败：${describeError(error)}` });
        return [] as CasdoorResourceRecord[];
      });
      setResources(list);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grouped = useMemo(() => {
    const map = new Map<CasdoorResourceType, CasdoorResourceRecord[]>();
    for (const item of resources) {
      const list = map.get(item.type) ?? [];
      list.push(item);
      map.set(item.type, list);
    }
    return map;
  }, [resources]);

  const handleCreate = useCallback(async () => {
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setMessage({ kind: "warn", text: "名称不能为空" });
      return;
    }
    let metadata: Record<string, string | number | boolean | null> | undefined;
    if (draft.metadata.trim()) {
      try {
        metadata = JSON.parse(draft.metadata);
      } catch {
        setMessage({ kind: "err", text: "metadata 必须是合法 JSON" });
        return;
      }
    }
    setBusy(true);
    try {
      const input: CasdoorResourceCreateInput = {
        type: draft.type,
        name: trimmedName,
        idempotencyKey: `web:${draft.type}:${Date.now().toString(36)}`,
        ...(metadata ? { metadata } : {}),
      };
      await casdoorCreateResource(input);
      await reload(draft.type);
      setDraft({ type: draft.type, name: "", metadata: "" });
      setMessage({ kind: "ok", text: `已创建 ${TYPE_LABEL[draft.type]}` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [draft, reload]);

  const handleStartEdit = useCallback((record: CasdoorResourceRecord) => {
    setEditingId(record.id);
    setEditDraft({
      name: record.name,
      metadata: Object.keys(record.metadata).length ? JSON.stringify(record.metadata, null, 2) : "",
      version: record.version,
    });
  }, []);

  const handleSaveEdit = useCallback(async (record: CasdoorResourceRecord) => {
    setBusy(true);
    try {
      let metadata: Record<string, string | number | boolean | null> | undefined;
      if (editDraft.metadata.trim()) {
        try {
          metadata = JSON.parse(editDraft.metadata);
        } catch {
          setMessage({ kind: "err", text: "metadata 必须是合法 JSON" });
          return;
        }
      }
      await casdoorUpdateResource(record.id, {
        expectedVersion: editDraft.version,
        name: editDraft.name.trim() || record.name,
        ...(metadata ? { metadata } : {}),
      });
      await reload();
      setEditingId(null);
      setMessage({ kind: "ok", text: `已更新 ${record.name}` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [editDraft, reload]);

  const handleDelete = useCallback(async (record: CasdoorResourceRecord) => {
    if (!confirm(`确认删除资源 ${record.name}？`)) return;
    setBusy(true);
    try {
      await casdoorDeleteResource(record.id, record.version);
      await reload();
      setMessage({ kind: "ok", text: `已删除 ${record.name}` });
    } catch (error) {
      setMessage({ kind: "err", text: describeError(error) });
    } finally {
      setBusy(false);
    }
  }, [reload]);

  return (
    <SectionShell
      title="资源目录"
      desc="管理工作台资源：项目、知识库、存储连接。所有写操作走 Gateway 乐观 CAS（version 校验），避免并发覆盖。"
    >
      <div className="account-section" data-testid="resource-catalog-section">
        <div className="account-section__header">
          <h3 className="account-section__title">
            <Folder size={16} /> 类型筛选
          </h3>
          <button className="settings-btn" onClick={() => reload()} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
        <p className="settings-hint">
          {CASDOOR_RESOURCE_TYPES.map((kind) => `${TYPE_LABEL[kind]}=${grouped.get(kind)?.length ?? 0}`).join(" · ")}
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {CASDOOR_RESOURCE_TYPES.map((kind) => {
            const Icon = TYPE_ICON[kind];
            return (
              <button
                key={kind}
                className="settings-btn"
                data-testid={`resource-type-tab-${kind}`}
                onClick={() => setType(kind)}
                disabled={busy}
                aria-pressed={type === kind}
              >
                <Icon size={14} /> {TYPE_LABEL[kind]}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="资源名称"
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              data-testid="resource-create-name"
              style={{ flex: 1, minWidth: 200 }}
            />
            <input
              type="text"
              placeholder='metadata JSON (如 {"region":"us-east-1"})'
              value={draft.metadata}
              onChange={(event) => setDraft((prev) => ({ ...prev, metadata: event.target.value }))}
              data-testid="resource-create-metadata"
              style={{ flex: 2, minWidth: 300 }}
            />
            <button
              className="settings-btn"
              onClick={handleCreate}
              disabled={busy}
              data-testid="resource-create-submit"
            >
              <Plus size={14} /> 新建
            </button>
          </div>
          <select
            value={draft.type}
            onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value as CasdoorResourceType }))}
            data-testid="resource-create-type"
            style={{ width: 160 }}
          >
            {CASDOOR_RESOURCE_TYPES.map((kind) => (
              <option key={kind} value={kind}>{TYPE_LABEL[kind]}</option>
            ))}
          </select>
        </div>

        <ul className="shortcuts-list" data-testid="resource-catalog-list" style={{ marginTop: 12 }}>
          {loading && resources.length === 0 ? (
            <li className="shortcuts-list__row">
              <div className="shortcuts-list__row-meta">
                <span className="settings-hint">正在加载资源…</span>
              </div>
            </li>
          ) : resources.length === 0 ? (
            <li className="shortcuts-list__row">
              <div className="shortcuts-list__row-meta">
                <span className="settings-hint">当前类型下没有资源，使用上方表单创建。</span>
              </div>
            </li>
          ) : (
            resources.map((record) => {
              const Icon = TYPE_ICON[record.type];
              const editing = editingId === record.id;
              return (
                <li key={record.id} className="shortcuts-list__row" data-testid={`resource-row-${record.id}`}>
                  <div className="shortcuts-list__row-meta">
                    <span className="shortcuts-list__action">
                      <Icon size={12} /> {editing ? (
                        <input
                          type="text"
                          value={editDraft.name}
                          onChange={(event) => setEditDraft((prev) => ({ ...prev, name: event.target.value }))}
                          data-testid={`resource-edit-name-${record.id}`}
                        />
                      ) : record.name}
                    </span>
                    <span className="shortcuts-list__key">
                      类型：{TYPE_LABEL[record.type]} · 版本 {record.version} · 创建 {new Date(record.createdAt).toLocaleString()}
                    </span>
                    {editing ? (
                      <textarea
                        value={editDraft.metadata}
                        onChange={(event) => setEditDraft((prev) => ({ ...prev, metadata: event.target.value }))}
                        data-testid={`resource-edit-metadata-${record.id}`}
                        rows={3}
                        style={{ width: "100%", fontFamily: "monospace" }}
                      />
                    ) : Object.keys(record.metadata).length > 0 ? (
                      <span className="shortcuts-list__key">metadata：{JSON.stringify(record.metadata)}</span>
                    ) : null}
                  </div>
                  <div className="shortcuts-list__row-actions">
                    {editing ? (
                      <>
                        <button className="settings-btn" onClick={() => handleSaveEdit(record)} disabled={busy} data-testid={`resource-save-${record.id}`}>
                          <Pencil size={14} /> 保存
                        </button>
                        <button className="settings-btn settings-btn--ghost" onClick={() => setEditingId(null)} disabled={busy}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="settings-btn settings-btn--ghost" onClick={() => handleStartEdit(record)} disabled={busy}>
                          <Pencil size={14} /> 编辑
                        </button>
                        <button className="settings-btn settings-btn--ghost" onClick={() => handleDelete(record)} disabled={busy} data-testid={`resource-delete-${record.id}`}>
                          <Trash2 size={14} /> 删除
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {message && (
        <p
          className={`settings-msg ${message.kind === "ok" ? "settings-msg--ok" : message.kind === "warn" ? "settings-msg--warn" : "settings-msg--err"}`}
          data-testid="resource-catalog-message"
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </SectionShell>
  );
}

export default ResourceCatalogPanel;
