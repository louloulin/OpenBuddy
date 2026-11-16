import { useCallback, useEffect, useState } from "react";
import { McpIcon, RefreshCwIcon, CheckIcon, CloseIcon } from "@openbuddy/ui/icon/icons/index";
import { mcpAuthTrigger, mcpList, mcpTest, mcpToggle } from "@openbuddy/client/agent-client";
import type { McpServerEntry, McpTestResult } from "@openbuddy/protocol/dto";
import { friendlyError } from "@openbuddy/chat-core/error-format";

/**
 * MCP 服务卡片 (pii W2.4 / U7.2): every configured server with its transport, target, per-server
 * switch, a real 测试连接 (connect + list tools + duration) and — for URL servers without a static
 * Authorization header — a 授权 button that starts OAuth without needing an open task.
 */
export function McpServersPanel({ onToast }: { onToast?: (m: string) => void }) {
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  /** name → the last test-connect result (kept until reloaded or tested again). */
  const [tests, setTests] = useState<Record<string, McpTestResult>>({});
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { setServers(await mcpList()); }
    catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (name: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name); setError("");
    try { await action(); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(""); }
  };

  const test = (server: McpServerEntry) => run(server.name, async () => {
    const result = await mcpTest(server.name);
    setTests((current) => ({ ...current, [server.name]: result }));
    onToast?.(result.ok ? `已连接 ${server.name}：${result.tools?.length ?? 0} 个工具，${result.ms}ms` : `${server.name} 连接失败`);
  });

  const toggle = (server: McpServerEntry) => run(server.name, async () => {
    await mcpToggle("", server.name, !server.enabled);
    await reload();
  });

  const authorize = (server: McpServerEntry) => run(server.name, async () => {
    const result = await mcpAuthTrigger("", server.name);
    onToast?.(result.status === "authenticated" ? `${server.name} 已授权` : result.status === "cancelled" ? "授权已取消" : `授权失败：${result.error ?? "未知错误"}`);
    await reload();
  });

  if (loading && servers.length === 0) return <p className="res-panel__muted">读取 MCP 服务…</p>;

  return <section className="res-panel__card" aria-label="MCP 服务">
    <h3 className="res-panel__card-title">
      MCP 服务
      <button type="button" className="mcp-servers__refresh" title="刷新" onClick={() => { void reload(); }} disabled={loading}>
        <RefreshCwIcon size="sm" />
      </button>
    </h3>
    {error && <p className="res-panel__error" role="alert">{error}</p>}
    {servers.length === 0 && <p className="res-panel__muted">还没有配置 MCP 服务。可以在下方 JSON 里添加，或从连接器市场安装。</p>}
    <div className="mcp-servers">
      {servers.map((server) => {
        const result = tests[server.name];
        return <div key={server.name} className="mcp-server">
          <div className="mcp-server__head">
            <McpIcon size="md" className="mcp-server__icon" />
            <div className="mcp-server__title">
              <span className="mcp-server__name">{server.name}</span>
              <span className="mcp-server__badge">{server.transport === "stdio" ? "本地命令" : "远程服务"}</span>
              {!server.enabled && <span className="mcp-server__badge mcp-server__badge--off">已停用</span>}
              {server.enabled && server.needsAuth && <span className="mcp-server__badge mcp-server__badge--warn">需要授权</span>}
              {result && <span className={"mcp-server__badge " + (result.ok ? "mcp-server__badge--ok" : "mcp-server__badge--bad")}>
                {result.ok ? <><CheckIcon size="sm" />{result.ms}ms · {result.tools?.length ?? 0} 个工具</> : <><CloseIcon size="sm" />失败</>}
              </span>}
            </div>
            <label className="sk-toggle" title={server.enabled ? "已启用" : "已停用"}>
              <input type="checkbox" checked={server.enabled} disabled={busy === server.name} onChange={() => { void toggle(server); }} />
              <span className="sk-toggle-track"><span className="sk-toggle-thumb" /></span>
            </label>
            <button type="button" className="res-panel__btn" disabled={busy === server.name || !server.enabled} onClick={() => { void test(server); }}>
              {busy === server.name ? "连接中…" : "测试连接"}
            </button>
            {server.needsAuth && <button type="button" className="res-panel__btn res-panel__btn--primary" disabled={busy === server.name} onClick={() => { void authorize(server); }}>授权</button>}
          </div>
          <code className="mcp-server__target" title={server.target}>{server.target}</code>
          {result && !result.ok && <p className="mcp-server__error" role="alert">{result.error}</p>}
          {result?.ok && (result.tools?.length ?? 0) > 0 && <p className="mcp-server__tools">
            {result.tools!.slice(0, 8).map((tool) => <code key={tool.name} title={tool.description}>{tool.name}</code>)}
            {result.tools!.length > 8 && <span className="res-panel__muted">…共 {result.tools!.length} 个</span>}
          </p>}
          {result?.ok && result.serverInfo?.name && <p className="res-panel__muted">{result.serverInfo.name} {result.serverInfo.version ?? ""}</p>}
        </div>;
      })}
    </div>
  </section>;
}
