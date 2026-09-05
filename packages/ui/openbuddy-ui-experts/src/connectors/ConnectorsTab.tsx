import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@/lib/platform/electron-api";
import {
  SearchIcon, AddCircleIcon, FolderOpenIcon, RefreshCwIcon, McpIcon,
} from "@openbuddy/ui-primitives/icons";
import {
  connectorsDefaultRoot, connectorsLoad, connectorsReadMcpConfig,
  connectorsCliAuth, connectorsCliAuthCancel, connectorsCliSkillsDir,
  connectorsCliStatus, connectorsCliUnauth,
  mcpAuthCancel, mcpAuthStatus, mcpAuthTrigger, mcpConfigRead, mcpConfigSave,
  onConnectorCliAuthUrl, onConnectorCliAuthLog, openUrl, skillsAdd,
} from "@/lib/agent/pi-client";
import { ensureSession } from "@/lib/agent/ensure-session";
import { useSessionStore } from "@/stores/session-store";
import type { ConnectorCatalog, ConnectorCliStatus, ConnectorItem } from "@openbuddy/shared-types";
import { Chip } from "../shared/ui";
import { ConnectorCard } from "./ConnectorCard";
import { ConnectorDetailModal } from "./ConnectorDetailModal";
import { ConnectorTokenForm } from "./ConnectorTokenForm";
import { ConnectorAuthModal } from "./ConnectorAuthModal";
import { ConnectorQrModal } from "./ConnectorQrModal";
import { McpModal } from "./McpModal";

const LS_ROOT = "connectorsRoot";
const DEFAULT_PICK = "C:/Users/chenr/.workbuddy/connectors-marketplace";

interface Props {
  pills: React.ReactNode;
  onToast?: (m: string) => void;
}

/** Per-connector authorization state shown as a card/detail badge. */
export type ConnectorAuthState = "none" | "installed" | "needs-auth" | "authed";

/** The auth flow currently running (drives the waiting / QR modal). */
type AuthPhase =
  | { kind: "oauth"; connector: ConnectorItem; serverNames: string[]; error?: string }
  | { kind: "cli"; connector: ConnectorItem; url?: string; qrModal: boolean; logs: string[] };

/** authMode values that go through pi's browser OAuth after install. */
const OAUTH_MODES = new Set(["server-side", "oneid-token", "gateway", "mcp"]);

/** Substitute `${VAR}` placeholders recursively with collected token values. */
function substitutePlaceholders(v: unknown, env: Record<string, string>): unknown {
  if (typeof v === "string") {
    return v.replace(/\$\{([A-Za-z0-9_]+)\}/g, (m, k) => env[k] ?? m);
  }
  if (Array.isArray(v)) return v.map((x) => substitutePlaceholders(x, env));
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, substitutePlaceholders(x, env)]),
    );
  }
  return v;
}

/** Heuristic: does installed-server name `n` belong to connector `c`?
 *  Marketplace convention is the mcp.json key equals the connector id/source. */
function nameMatches(name: string, c: ConnectorItem): boolean {
  return name === c.id || name === c.source;
}

/** 连接器 tab — a live directory of MCP-type connectors loaded from the
 *  WorkBuddy connectors marketplace. Cards open a detail modal; connect goes
 *  through per-kind auth flows (token form / pi browser OAuth / CLI QR). */
export function ConnectorsTab({ pills, onToast }: Props) {
  const [root, setRoot] = useState<string>(() => {
    try { return localStorage.getItem(LS_ROOT) || ""; } catch { return ""; }
  });
  const [catalog, setCatalog] = useState<ConnectorCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [needPick, setNeedPick] = useState(false);

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  /** Connector whose detail modal is open. */
  const [modalConnector, setModalConnector] = useState<ConnectorItem | null>(null);
  /** MCP 管理 modal. `editing` jumps straight into the JSON editor. */
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpEditing, setMcpEditing] = useState(false);

  // ---- authorization state ----
  /** Server names present in ~/.pi/mcp.json (install heuristic). */
  const [installedServers, setInstalledServers] = useState<Set<string>>(new Set());
  /** Server names pi flagged as needing OAuth. */
  const [needsAuth, setNeedsAuth] = useState<Set<string>>(new Set());
  /** CLI connector probe results, keyed by source (lazy + background). */
  const [cliStatus, setCliStatus] = useState<Record<string, ConnectorCliStatus>>({});
  /** The auth flow currently in flight (drives the waiting / QR modal). */
  const [authPhase, setAuthPhase] = useState<AuthPhase | null>(null);
  /** Prefill values for the token form (read back from mcp.json). */
  const [tokenPrefill, setTokenPrefill] = useState<Record<string, string>>({});
  /** Guard against double-clicking connect while a flow runs. */
  const connectingRef = useRef(false);
  /** Set when the user dismisses the OAuth modal mid-flow (suppresses the
   *  success toast when the dangling promise eventually resolves). */
  const oauthDismissedRef = useRef(false);

  const persist = (r: string) => { try { localStorage.setItem(LS_ROOT, r); } catch { /* ignore */ } };

  const loadCatalog = useCallback(async (r: string) => {
    setLoading(true); setError(""); setNeedPick(false);
    try {
      const c = await connectorsLoad(r);
      setCatalog(c);
      setRoot(c.root || r);
      persist(c.root || r);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Resolve the data root on first mount.
  useEffect(() => {
    let disposed = false;
    (async () => {
      if (root) { loadCatalog(root); return; }
      try {
        const d = await connectorsDefaultRoot();
        if (disposed) return;
        if (d) loadCatalog(d);
        else setNeedPick(true);
      } catch {
        if (!disposed) setNeedPick(true);
      }
    })();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Refresh installed-server + needs-auth state (mcp.json + pi auth_status). */
  const refreshState = useCallback(async () => {
    try {
      const file = await mcpConfigRead();
      const parsed = JSON.parse(file.content);
      const servers = (parsed?.mcpServers && typeof parsed.mcpServers === "object")
        ? Object.keys(parsed.mcpServers as Record<string, unknown>)
        : [];
      setInstalledServers(new Set(servers));
    } catch { /* keep previous */ }
    const sid = useSessionStore.getState().sessionId;
    if (sid) {
      try {
        const entries = await mcpAuthStatus(sid);
        setNeedsAuth(new Set(entries.map((e) => e.serverName)));
      } catch { /* session may be gone — keep previous */ }
    }
  }, []);

  useEffect(() => { refreshState(); }, [refreshState]);

  // Probe CLI connectors in the background once the catalog is loaded, so
  // cards can show 已授权 badges. Sequential to avoid spawning 13 CLIs at once.
  useEffect(() => {
    if (!catalog) return;
    const cliConnectors = catalog.connectors.filter((c) => c.kind === "cli");
    if (cliConnectors.length === 0) return;
    let disposed = false;
    (async () => {
      for (const c of cliConnectors) {
        if (disposed) return;
        try {
          const st = await connectorsCliStatus(catalog.root, c.source);
          if (disposed) return;
          setCliStatus((m) => (m[c.source] ? m : { ...m, [c.source]: st }));
        } catch { /* probe failure → no badge */ }
      }
    })();
    return () => { disposed = true; };
  }, [catalog]);

  // CLI auth events: URL (show QR / open browser) + log tail (progress line).
  const authPhaseRef = useRef<AuthPhase | null>(null);
  useEffect(() => { authPhaseRef.current = authPhase; }, [authPhase]);
  useEffect(() => {
    let unUrl: (() => void) | undefined;
    let unLog: (() => void) | undefined;
    onConnectorCliAuthUrl((e) => {
      const cur = authPhaseRef.current;
      if (cur?.kind === "cli" && cur.connector.source === e.source) {
        // Non-QR connectors go straight to the system browser (workbuddy's
        // default `openExternalUrl`), unless the CLI suppresses it.
        if (!e.qrModal && !e.suppressBrowser && cur.url !== e.url) {
          openUrl(e.url).catch(() => {});
        }
      }
      setAuthPhase((p) => (
        p?.kind === "cli" && p.connector.source === e.source
          ? { ...p, url: e.url, qrModal: e.qrModal }
          : p
      ));
    }).then((u) => { unUrl = u; });
    onConnectorCliAuthLog((e) => {
      setAuthPhase((p) => {
        if (p?.kind !== "cli" || p.connector.source !== e.source) return p;
        const logs = [...p.logs, e.line].slice(-50);
        return { ...p, logs };
      });
    }).then((u) => { unLog = u; });
    return () => { unUrl?.(); unLog?.(); };
  }, []);

  const chooseDir = useCallback(async () => {
    try {
      const sel = await openDialog({
        directory: true, multiple: false, title: "选择连接器数据目录",
        defaultPath: root || DEFAULT_PICK,
      });
      const pick = Array.isArray(sel) ? sel[0] : sel;
      if (!pick) return;
      await loadCatalog(pick);
      if (!error) onToast?.(`已切换连接器数据目录：${pick}`);
    } catch { /* cancelled */ }
  }, [root, loadCatalog, onToast, error]);

  const openEditor = () => { setMcpEditing(true); setMcpOpen(true); };
  const openMcpList = () => { setMcpEditing(false); setMcpOpen(true); };

  /** Connector whose token-authorization form is currently open. */
  const [tokenFormConnector, setTokenFormConnector] = useState<ConnectorItem | null>(null);

  /** Read the connector's mcp.json, optionally inject token values, merge into
   *  `~/.pi/mcp.json`, and save (syncs live into pi when a session is
   *  given). Returns the installed server names. */
  const installConnector = useCallback(async (
    c: ConnectorItem,
    sessionId: string,
    tokenEnv?: Record<string, string>,
  ): Promise<string[]> => {
    if (!root || !c.source) return [];
    const raw = await connectorsReadMcpConfig(root, c.source);
    const incoming = raw.trim() ? JSON.parse(raw) : null;
    let incomingServers = (incoming?.mcpServers ?? {}) as Record<string, Record<string, unknown>>;

    if (tokenEnv && Object.keys(tokenEnv).length > 0) {
      incomingServers = Object.fromEntries(
        Object.entries(incomingServers).map(([name, cfg]) => {
          // Replace `${VAR}` placeholders (e.g. 天眼查's Authorization header)
          // with the collected values, and record them in `env` — used by
          // stdio servers at runtime and by the token form for prefill.
          const next = substitutePlaceholders(cfg, tokenEnv) as Record<string, unknown>;
          next.env = { ...(next.env as Record<string, string> ?? {}), ...tokenEnv };
          return [name, next];
        }),
      );
    }

    const existing = await mcpConfigRead();
    let merged: Record<string, unknown>;
    try {
      const parsed = JSON.parse(existing.content);
      merged = (parsed.mcpServers && typeof parsed.mcpServers === "object")
        ? parsed.mcpServers as Record<string, unknown>
        : {};
    } catch {
      merged = {};
    }
    for (const [name, cfg] of Object.entries(incomingServers)) {
      merged[name] = cfg;
    }
    await mcpConfigSave(JSON.stringify({ mcpServers: merged }, null, 2), sessionId);
    return Object.keys(incomingServers);
  }, [root]);

  /** pi browser-OAuth flow for one or more installed servers. */
  const startOauthFlow = useCallback(async (
    c: ConnectorItem,
    sessionId: string,
    serverNames: string[],
  ) => {
    oauthDismissedRef.current = false;
    setAuthPhase({ kind: "oauth", connector: c, serverNames });
    try {
      for (const name of serverNames) {
        const res = await mcpAuthTrigger(sessionId, name);
        if (res.status === "authenticated") continue;
        const detail = res.error
          || (res.status === "setup_required" ? "该服务需要额外的配置" : "授权失败");
        setAuthPhase((p) => (p?.kind === "oauth" ? { ...p, error: detail } : p));
        return;
      }
      if (!oauthDismissedRef.current) {
        setAuthPhase(null);
        onToast?.(`「${c.name}」授权成功`);
      }
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "");
      setAuthPhase((p) => (p?.kind === "oauth" ? { ...p, error: msg } : p));
    } finally {
      refreshState();
    }
  }, [onToast, refreshState]);

  /** CLI-connector authorization flow (install CLI → auth → install skills). */
  const startCliAuth = useCallback(async (c: ConnectorItem) => {
    setAuthPhase({ kind: "cli", connector: c, qrModal: false, logs: [] });
    try {
      const res = await connectorsCliAuth(root, c.source);
      setAuthPhase(null);
      if (res.ok && res.authed) {
        // Bundled agent skills (e.g. wecom's) become available after auth.
        try {
          const dir = await connectorsCliSkillsDir(root, c.source);
          if (dir) await skillsAdd(dir);
        } catch { /* skills are best-effort */ }
        onToast?.(`「${c.name}」授权成功`);
      } else {
        onToast?.(`「${c.name}」授权未完成${res.error ? `：${res.error}` : ""}`);
      }
    } catch (e) {
      setAuthPhase(null);
      onToast?.(`「${c.name}」授权失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      try {
        const st = await connectorsCliStatus(root, c.source);
        setCliStatus((m) => ({ ...m, [c.source]: st }));
      } catch { /* ignore */ }
    }
  }, [root, onToast]);

  /** "配置连接" entry point — dispatch by connector kind + authMode (mirrors
   *  workbuddy's DesktopConnectorManager.connect authMode switch). */
  const handleConnect = useCallback(async (c: ConnectorItem) => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setModalConnector(null);
    try {
      // CLI connectors run their own cli.json-driven engine.
      if (c.kind === "cli") {
        await startCliAuth(c);
        return;
      }

      const mode = (c.authMode ?? "").toLowerCase();

      // token mode with a schema → collect API keys first.
      if (mode === "token" && c.tokenSchema && c.tokenSchema.fields.length > 0) {
        // Prefill values saved from a previous install (mirrors workbuddy's
        // "已保存，留空保持不变", except we can show the real values).
        let prefill: Record<string, string> = {};
        try {
          const raw = await connectorsReadMcpConfig(root, c.source);
          const names = Object.keys((JSON.parse(raw)?.mcpServers ?? {}) as Record<string, unknown>);
          const existing = JSON.parse((await mcpConfigRead()).content);
          for (const n of names) {
            const env = (existing?.mcpServers?.[n]?.env ?? {}) as Record<string, string>;
            for (const f of c.tokenSchema.fields) {
              if (env[f.key]) prefill[f.key] = env[f.key];
            }
          }
        } catch { /* no prefill */ }
        setTokenPrefill(prefill);
        setTokenFormConnector(c);
        return;
      }

      // Everything else needs the config live in pi → session required.
      const sessionId = await ensureSession();
      const names = await installConnector(c, sessionId);
      await refreshState();
      if (names.length === 0) {
        onToast?.(`「${c.name}」无 MCP 配置，已打开 MCP 管理`);
        openMcpList();
        return;
      }
      if (mode === "token") {
        onToast?.(`已连接「${c.name}」（${names.length} 个服务）`);
        return;
      }

      // OAuth-ish connectors always trigger; others only when pi flags them.
      if (OAUTH_MODES.has(mode)) {
        await startOauthFlow(c, sessionId, names);
        return;
      }
      let flagged: string[] = [];
      try {
        const entries = await mcpAuthStatus(sessionId);
        flagged = entries.map((e) => e.serverName).filter((n) => names.includes(n));
      } catch { /* status query failed → assume fine */ }
      if (flagged.length > 0) {
        await startOauthFlow(c, sessionId, flagged);
      } else {
        onToast?.(`已连接「${c.name}」（${names.length} 个服务）`);
      }
    } catch (e) {
      onToast?.(`连接失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      connectingRef.current = false;
    }
  }, [root, installConnector, refreshState, startCliAuth, startOauthFlow, onToast]);

  /** Token form submit → install with the collected values. */
  const commitTokenConnect = useCallback(async (c: ConnectorItem, values: Record<string, string>) => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setTokenFormConnector(null);
    try {
      const sessionId = await ensureSession();
      const names = await installConnector(c, sessionId, values);
      await refreshState();
      onToast?.(names.length > 0
        ? `已连接「${c.name}」（${names.length} 个服务）`
        : `「${c.name}」无 MCP 配置`);
    } catch (e) {
      onToast?.(`连接失败：${String(e).replace(/^Error:\s*/, "")}`);
    } finally {
      connectingRef.current = false;
    }
  }, [installConnector, refreshState, onToast]);

  /** 取消授权 (detail modal): CLI logout, or re-open the auth flow. */
  const handleUnauth = useCallback(async (c: ConnectorItem) => {
    if (c.kind !== "cli") return;
    try {
      await connectorsCliUnauth(root, c.source);
      onToast?.(`已取消「${c.name}」的授权`);
      const st = await connectorsCliStatus(root, c.source);
      setCliStatus((m) => ({ ...m, [c.source]: st }));
    } catch (e) {
      onToast?.(`取消授权失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
  }, [root, onToast]);

  /** Badge state for a connector card / detail modal. */
  const stateOf = useCallback((c: ConnectorItem): ConnectorAuthState => {
    if (c.kind === "cli") {
      return cliStatus[c.source]?.authed ? "authed" : "none";
    }
    const installed = [...installedServers].some((n) => nameMatches(n, c));
    if (!installed) return "none";
    const na = [...needsAuth].some((n) => nameMatches(n, c));
    return na ? "needs-auth" : "installed";
  }, [cliStatus, installedServers, needsAuth]);

  const chips = useMemo(() => {
    const present = new Set((catalog?.connectors ?? []).map((c) => c.cat));
    const out: { id: string | null; label: string }[] = [{ id: null, label: "全部" }];
    for (const c of catalog?.categories ?? []) {
      if (present.has(c.id)) out.push({ id: c.id, label: c.zh });
    }
    return out;
  }, [catalog]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog?.connectors ?? []).filter((c) => {
      if (cat && c.cat !== cat) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q) ||
        (c.nameEn ?? "").toLowerCase().includes(q)
      );
    });
  }, [catalog, cat, search]);

  // ---- no data dir yet ----
  if (needPick && !catalog) {
    return (
      <div className="um-page">
        <header className="um-topbar"><div className="um-topbar-left">{pills}</div></header>
        <div className="um-scroll">
          <div className="ec-empty">
            <FolderOpenIcon size="xl" className="ec-empty-icon" />
            <p>未找到连接器数据目录</p>
            <p className="ec-empty-hint">请选择包含 <code>.codebuddy-connector/connectors.json</code> 的连接器市场目录</p>
            <button type="button" className="um-btn um-btn--primary" onClick={chooseDir}>
              <FolderOpenIcon size="sm" /><span>选择来源目录</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="um-page">
      <header className="um-topbar">
        <div className="um-topbar-left">{pills}</div>
        <div className="um-topbar-right">
          <div className="um-search">
            <SearchIcon size="sm" className="um-search-icon" />
            <input className="um-search-input" value={search} placeholder="搜索连接器"
              onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button type="button" className="um-btn um-btn--grey" onClick={openEditor}>
            <AddCircleIcon size="sm" /><span>自定义连接器</span>
          </button>
        </div>
      </header>

      <div className="um-scroll">
        <div className="ec-source-bar">
          <span className="ec-source-label" title={root}>来源：{root || "—"}</span>
          <button type="button" className="ec-source-btn" onClick={chooseDir} title="切换来源目录">
            <FolderOpenIcon size="sm" /><span>选择目录</span>
          </button>
          <button type="button" className="ec-source-btn" onClick={() => root && loadCatalog(root)}
            disabled={loading} title="重新加载">
            <RefreshCwIcon size="sm" />
          </button>
        </div>

        {loading && !catalog && <div className="ec-loading">加载连接器数据…</div>}
        {error && (
          <div className="ec-error">
            加载失败：{error}
            <button type="button" className="ec-source-btn" onClick={chooseDir}>选择目录</button>
          </div>
        )}

        {catalog && (
          <>
            <div className="ec-chips">
              {chips.map((c) => (
                <Chip key={c.id ?? "all"} label={c.label}
                  active={cat === c.id} onClick={() => setCat(c.id)} />
              ))}
            </div>

            {visible.length === 0 ? (
              <div className="ec-empty">
                <McpIcon size="xl" className="ec-empty-icon" />
                <p>{search ? `没有找到与「${search}」匹配的连接器` : "该分类暂无连接器"}</p>
              </div>
            ) : (
              <div className="cn-grid">
                {visible.map((c) => (
                  <ConnectorCard key={c.id} connector={c} authState={stateOf(c)}
                    root={root}
                    onOpen={setModalConnector} onConfigure={handleConnect} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modalConnector && (
        <ConnectorDetailModal
          connector={modalConnector}
          root={root}
          authState={stateOf(modalConnector)}
          onClose={() => setModalConnector(null)}
          onConfigure={() => handleConnect(modalConnector)}
          onUnauth={() => handleUnauth(modalConnector)}
          onToast={onToast}
        />
      )}

      {tokenFormConnector && tokenFormConnector.tokenSchema && (
        <ConnectorTokenForm
          connector={tokenFormConnector}
          root={root}
          initialValues={tokenPrefill}
          onClose={() => setTokenFormConnector(null)}
          onSubmit={(values) => commitTokenConnect(tokenFormConnector, values)}
        />
      )}

      {authPhase?.kind === "oauth" && (
        <ConnectorAuthModal
          connector={authPhase.connector}
          root={root}
          error={authPhase.error}
          onClose={() => {
            oauthDismissedRef.current = true;
            for (const serverName of authPhase.serverNames) mcpAuthCancel(serverName).catch(() => {});
            setAuthPhase(null);
          }}
        />
      )}

      {authPhase?.kind === "cli" && (
        <ConnectorQrModal
          connector={authPhase.connector}
          root={root}
          url={authPhase.url}
          showQr={authPhase.qrModal}
          logs={authPhase.logs}
          onCancel={() => {
            connectorsCliAuthCancel(authPhase.connector.source).catch(() => {});
            setAuthPhase(null);
          }}
          onToast={onToast}
        />
      )}

      {mcpOpen && (
        <McpModal onClose={() => setMcpOpen(false)} onToast={onToast} initialEditing={mcpEditing} />
      )}
    </div>
  );
}
