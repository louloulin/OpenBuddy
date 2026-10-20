/**
 * FolderTrustPanel — 「文件夹信任」管理面板 (P1.2 三件套之 3)
 *
 * 用途(TODO.md "Folder trust UI polish"):
 *   列出当前 agent 已知的文件夹,允许授权/撤销/添加新文件夹。
 *
 * 数据流:
 *   - entries:folder trust store 返回的列表
 *   - onGrant / onRevoke / onAdd:caller 注入的 callback
 *
 * 设计:
 *   - 纯展示组件,无内部状态(只有 addInput 本地 UI 状态)
 *   - 颜色编码:trusted 绿色,untrusted 红色
 *   - 输入校验:cwd 必须是非空绝对路径
 *
 * 单元测试: `__tests__/FolderTrustPanel.test.tsx`
 */

import { useState } from "react";

import type { FolderTrustPanelProps } from "./types.js";

export function FolderTrustPanel(props: FolderTrustPanelProps) {
  const { entries, onGrant, onRevoke, onAdd, loading = false } = props;
  const [newCwd, setNewCwd] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    const cwd = newCwd.trim();
    setError(null);
    if (!cwd) {
      setError("请输入文件夹路径");
      return;
    }
    if (!cwd.startsWith("/") && !/^[a-zA-Z]:[\\\/]/.test(cwd)) {
      setError("必须是绝对路径(以 / 或盘符开头)");
      return;
    }
    if (!onAdd) return;
    await onAdd(cwd);
    setNewCwd("");
  };

  const trustedCount = entries.filter((e) => e.trusted).length;
  const untrustedCount = entries.length - trustedCount;

  return (
    <div className="folder-trust-panel" data-testid="folder-trust-panel">
      <header className="folder-trust-panel__header">
        <h2>文件夹信任</h2>
        <p className="folder-trust-panel__stats" data-testid="folder-trust-stats">
          共 {entries.length} 个 · 已信任 <strong>{trustedCount}</strong> · 未信任 <strong>{untrustedCount}</strong>
        </p>
      </header>

      {onAdd && (
        <section className="folder-trust-panel__add">
          <input
            type="text"
            placeholder="文件夹绝对路径(例如 /Users/me/projects)"
            value={newCwd}
            onChange={(e) => setNewCwd(e.target.value)}
            disabled={loading}
            aria-label="新文件夹路径"
            data-testid="folder-trust-add-input"
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={loading || !newCwd.trim()}
            data-testid="folder-trust-add-submit"
          >
            添加
          </button>
          {error && (
            <p className="folder-trust-panel__error" role="alert" data-testid="folder-trust-error">
              {error}
            </p>
          )}
        </section>
      )}

      <section className="folder-trust-panel__list" aria-labelledby="folder-trust-list-heading">
        <h3 id="folder-trust-list-heading">已知文件夹</h3>
        {loading ? (
          <p>加载中…</p>
        ) : entries.length === 0 ? (
          <p className="folder-trust-panel__empty">暂无记录</p>
        ) : (
          <table data-testid="folder-trust-table">
            <thead>
              <tr>
                <th>路径</th>
                <th>状态</th>
                <th>决定时间</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <tr key={idx} data-testid={`folder-trust-row-${idx}`}>
                  <td><code>{entry.cwd}</code></td>
                  <td>
                    <span
                      className={"folder-trust-panel__status folder-trust-panel__status--" + (entry.trusted ? "trusted" : "untrusted")}
                      data-testid={`folder-trust-status-${idx}`}
                    >
                      {entry.trusted ? "✓ 已信任" : "✗ 未信任"}
                    </span>
                  </td>
                  <td>{entry.decidedAt ?? "—"}</td>
                  <td>
                    {entry.trusted ? (
                      onRevoke && (
                        <button
                          type="button"
                          onClick={() => void onRevoke(entry.cwd)}
                          disabled={loading}
                          data-testid={`folder-trust-revoke-${idx}`}
                        >
                          撤销
                        </button>
                      )
                    ) : (
                      onGrant && (
                        <button
                          type="button"
                          onClick={() => void onGrant(entry.cwd)}
                          disabled={loading}
                          data-testid={`folder-trust-grant-${idx}`}
                        >
                          授权
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
