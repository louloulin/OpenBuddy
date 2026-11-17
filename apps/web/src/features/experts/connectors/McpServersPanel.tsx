import { useCallback, useEffect, useState } from "react";
import { McpIcon, RefreshCwIcon, CheckIcon, CloseIcon } from "@openbuddy/ui/icon/icons/index";
import { mcpAuthTrigger, mcpDeferredGet, mcpDeferredSet, mcpList, mcpTest, mcpToggle, permissionList, permissionSave } from "@openbuddy/client/agent-client";
import type { McpServerEntry, McpTestResult, PermissionRule } from "@openbuddy/protocol/dto";
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
  /** Tool-level rules (W2.4 P2): `mcp__<server>__<tool>` lives in the normal permission rules. */
  const [rules, setRules] = useState<PermissionRule[]>([]);
  /** 延迟暴露 (W2.4 P2): null until the host answers (browser preview stays hidden). */
  const [deferred, setDeferred] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    mcpDeferredGet()
      .then((result) => { if (!cancelled) setDeferred(result.deferred); })
      .catch(() => { /* no host bridge */ });
    return () => { cancelled = true; };
  }, []);

  const toggleDeferred = async (next: boolean) => {
    setDeferred(next);
    try {
      const result = await mcpDeferredSet(next);
      setDeferred(result.deferred);
      window.dispatchEvent(new CustomEvent("openbuddy:mcp-config-refresh"));
    } catch (e) {
      setDeferred(!next);
      setError(friendlyError(e));
    }
  };

  useEffect(() => {
    let cancelled = false;
    permissionList()
      .then((list) => { if (!cancelled) setRules(Array.isArray(list) ? list : []); })
      .catch(() => { /* no host bridge: the tool rules stay hidden until a task is open */ });
    return () => { cancelled = true; };
  }, []);

  const mcpToolName = (server: string, tool: string) => `mcp__${server}__${tool}`;
  const ruleAction = (server: string, tool: string) =>
    rules.find((rule) => rule.tool === mcpToolName(server, tool) && !rule.pattern)?.action ?? "";

  const setToolRule = (server: string, tool: string, action: string) => {
    const full = mcpToolName(server, tool);
    const next = rules.filter((rule) => !(rule.tool === full && !rule.pattern));
    if (action) next.push({ tool: full, action });
    setRules(next);
    permissionSave(next).catch((e) => { setError(friendlyError(e)); void reload(); });
  };

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
    window.dispatchEvent(new CustomEvent("openbuddy:mcp-config-refresh"));
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
    {deferred !== null && servers.length > 0 && <label className="mcp-deferred">
      <input type="checkbox" checked={deferred} onChange={(e) => { void toggleDeferred(e.target.checked); }} />
      <span className="mcp-deferred__title">延迟加载 MCP 工具</span>
      <span className="mcp-deferred__hint">工具多时先不把全部定义塞进提示词；模型用内置 <code>tool_search</code> 按需查找。改动对已打开的任务立即生效。</span>
    </label>}
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
          {result?.ok && (result.tools?.length ?? 0) > 0 && <div className="mcp-tools">
            <div className="mcp-tools__head">
              <span>工具权限</span>
              <span className="res-panel__muted">{result.tools!.length} 个 · 默认按当前权限模式</span>
            </div>
            {result.tools!.slice(0, 40).map((tool) => (
              <div className="mcp-tool" key={tool.name}>
                <code title={tool.description}>{tool.name}</code>
                <select
                  className="mcp-tool__select"
                  aria-label={`${tool.name} 的权限`}
                  value={ruleAction(server.name, tool.name)}
                  disabled={busy === server.name}
                  onChange={(e) => setToolRule(server.name, tool.name, e.target.value)}
                >
                  <option value="">默认</option>
                  <option value="allow">允许</option>
                  <option value="ask">询问</option>
                  <option value="deny">禁止</option>
                </select>
              </div>
            ))}
            {result.tools!.length > 40 && <span className="res-panel__muted">…另有 {result.tools!.length - 40} 个工具未列出</span>}
          </div>}
          {result?.ok && result.serverInfo?.name && <p className="res-panel__muted">{result.serverInfo.name} {result.serverInfo.version ?? ""}</p>}
        </div>;
      })}
    </div>
  </section>;
}
