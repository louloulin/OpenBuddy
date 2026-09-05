import { useEffect, useMemo, useState } from "react";

interface McpExporterTool {
  id: string;
  description: string;
}

interface McpExporterPackage {
  packageId: string;
  label: string;
  capabilities: McpExporterTool[];
}

/**
 * Renderer-side mirror of `electron/main/capability-mcp-exporters.ts#builtInMcpExporters`.
 *
 * The exporter registry itself lives in the main process because the MCP
 * server runs there; the renderer only needs the metadata to render the
 * endpoint card. Keeping this list in sync with the main-process registry is
 * an explicit, manual contract — both sides are tested by their own suites
 * so a drift surfaces immediately.
 */
const RENDERER_BUILTIN_EXPORTERS: readonly McpExporterPackage[] = [
  {
    packageId: "openbuddy-task",
    label: "OpenBuddy Task Steps",
    capabilities: [
      { id: "task:list", description: "列出当前会话的 TaskStep 清单。" },
      { id: "task:complete", description: "把一个 TaskStep 标记为 completed；幂等。" },
    ],
  },
  {
    packageId: "openbuddy-memory",
    label: "OpenBuddy Memory (read-only)",
    capabilities: [
      { id: "memory:list", description: "读取本地长效记忆索引；只返回标题和标签。" },
      { id: "memory:get", description: "按 id 读取单条记忆的标题和正文。" },
    ],
  },
  {
    packageId: "openbuddy-notification",
    label: "OpenBuddy Notifications (read-only)",
    capabilities: [
      { id: "notification:list", description: "读取最近的通知；用于外部 dashboard 镜像。" },
    ],
  },
  {
    packageId: "openbuddy-plan",
    label: "OpenBuddy Plan Mode (read-only)",
    capabilities: [
      { id: "plan:get", description: "读取当前会话的 plan 文本与状态；不可修改。" },
    ],
  },
  {
    packageId: "openbuddy-automation",
    // Stage G-1c: openbuddy-automation backend removed; automation is owned by
    // pi-background-tasks + pi-goal (passthrough). No Cordis-side MCP tools
    // exist for automation anymore — the card is preserved per user directive
    // "自动化ui保留不要删除 / 保留auto" so the operator still sees the
    // passthrough marker.
    label: "OpenBuddy Automation (passthrough → pi-background-tasks + pi-goal)",
    capabilities: [],
  },
  {
    packageId: "openbuddy-calendar",
    label: "OpenBuddy Calendar (read + write-after-approval)",
    capabilities: [
      { id: "calendar:list", description: "列出指定时间窗口内的本地日程条目。" },
      { id: "calendar:create", description: "创建日程条目；先创建 SideEffectIntent 等用户确认后再 commit。" },
    ],
  },
];

interface McpEndpointCardProps {
  /** Whether the runtime reports the MCP endpoint as wired. */
  available: boolean;
  /** Optional override for the list of built-in exporters (used in tests). */
  overrideExporters?: readonly McpExporterPackage[];
  /** Optional override for runtime collaboration tools (used in tests). */
  overrideRuntimeTools?: ReadonlyArray<{ id: string; description?: string }>;
}

interface RuntimeTool {
  id: string;
  description: string;
}

/**
 * Surfaces the per-package MCP exports to the operator. The card stays
 * informational: it lists the currently advertised tools, groups them by
 * package, and reminds the user that authority for each tool still flows
 * through the local runtime (Discovery ≠ Authorization).
 */
export function McpEndpointCard({ available, overrideExporters, overrideRuntimeTools }: McpEndpointCardProps) {
  const exporters = useMemo<readonly McpExporterPackage[]>(() => overrideExporters ?? RENDERER_BUILTIN_EXPORTERS, [overrideExporters]);
  const builtInTools = useMemo(() => exporters.flatMap((exp) => exp.capabilities), [exporters]);
  const totalBuiltIn = builtInTools.length;

  const [runtimeTools, setRuntimeTools] = useState<RuntimeTool[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!available || overrideRuntimeTools) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/mcp/capabilities");
        if (!response.ok) throw new Error("HTTP " + String(response.status));
        const body = (await response.json()) as { capabilities: Array<{ id: string; description?: string }> };
        if (cancelled) return;
        setRuntimeTools(body.capabilities.map((cap) => ({ id: cap.id, description: cap.description ?? "" })));
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [available, overrideRuntimeTools]);

  if (!available) {
    return (
      <section className="mcp-endpoint-card mcp-endpoint-card--off" aria-label="MCP endpoint 状态">
        <header>
          <h3>MCP endpoint</h3>
          <span className="mcp-endpoint-card__pill mcp-endpoint-card__pill--off">未启用</span>
        </header>
        <p>设置 <code>OPENBUDDY_MCP_STDIO=1</code> 后启动 stdio MCP server；外部 Claude Desktop / 其他 OpenBuddy 才能调用本地能力。</p>
      </section>
    );
  }

  const runtime = overrideRuntimeTools
    ? overrideRuntimeTools.map((tool) => ({ id: tool.id, description: tool.description ?? "" }))
    : runtimeTools;
  const totalTools = totalBuiltIn + runtime.length;

  return (
    <section className="mcp-endpoint-card" aria-label="MCP endpoint 状态">
      <header>
        <div>
          <h3>MCP endpoint</h3>
          <p>通过 stdio 暴露给外部 MCP client。Discovery ≠ Authorization：每个 tool 仍受本地 runtime 的 effectivePolicy 拦截。</p>
        </div>
        <span className="mcp-endpoint-card__pill mcp-endpoint-card__pill--on">{totalTools} tools</span>
      </header>
      {error && <p className="mcp-endpoint-card__error">读取 tool 列表失败：{error}</p>}
      <details open={totalTools <= 12}>
        <summary>Per-package exporters（{totalBuiltIn}）</summary>
        <ul className="mcp-endpoint-card__list">
          {exporters.map((exp) => (
            <li key={exp.packageId}>
              <strong>{exp.packageId}</strong>
              <span className="mcp-endpoint-card__label">{exp.label}</span>
              <ul>
                {exp.capabilities.map((cap) => (
                  <li key={cap.id}>
                    <code>{cap.id}</code>
                    <span>{cap.description}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Runtime collaboration capabilities（{runtime.length}）</summary>
        {runtime.length === 0 ? (
          <p className="mcp-endpoint-card__empty">尚未返回 runtime tool 列表。</p>
        ) : (
          <ul className="mcp-endpoint-card__list">
            {runtime.map((tool) => (
              <li key={tool.id}>
                <code>{tool.id}</code>
                <span>{tool.description}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
