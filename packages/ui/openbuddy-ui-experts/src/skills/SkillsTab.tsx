import { useCallback, useEffect, useMemo, useState } from "react";
import { confirm, open as openDialog } from "@/lib/platform/electron-api";
import {
  SearchIcon, InstalledSkillIcon, AddCircleIcon, RefreshCwIcon,
  PuzzlePieceIcon, DeleteIcon, FolderOpenIcon, ChevronLeftIcon, SparklesIcon,
} from "@openbuddy/ui-primitives/icons";
import {
  skillsList, skillsRemove, skillsToggle,
  skillsCatalogDefaultRoot, skillsCatalogLoad,
} from "@/lib/agent/pi-client";
import type { SkillCatalog, SkillItem, SkillInfo } from "@openbuddy/shared-types";
import { Chip } from "../shared/ui";
import { SkillCatalogCard } from "./SkillCatalogCard";
import { SkillDetailModal } from "./SkillDetailModal";
import { ImportSkillModal } from "./ImportSkillModal";

const LS_ROOT = "skillsCatalogRoot";
const FEATURED_WINDOW = 8;
const DEFAULT_PICK = "E:/Pi/agents";

interface Props {
  pills: React.ReactNode;
  onToast?: (m: string) => void;
}

/** 技能 tab — a live catalog scanned from the agents tree + workbuddy
 *  built-ins, plus the existing "我安装的" (pi-managed) view. */
export function SkillsTab({ pills, onToast }: Props) {
  // ---- catalog (market) state ----
  const [root, setRoot] = useState<string>(() => {
    try { return localStorage.getItem(LS_ROOT) || ""; } catch { return ""; }
  });
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [needPick, setNeedPick] = useState(false);

  const [view, setView] = useState<"center" | "installed">("center");
  const [cat, setCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [modalSkill, setModalSkill] = useState<SkillItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // ---- installed (pi) state ----
  const [locals, setLocals] = useState<SkillInfo[]>([]);
  const [localsLoading, setLocalsLoading] = useState(false);

  const persist = (r: string) => { try { localStorage.setItem(LS_ROOT, r); } catch { /* ignore */ } };

  const loadCatalog = useCallback(async (r: string) => {
    setLoading(true); setError(""); setNeedPick(false);
    try {
      const c = await skillsCatalogLoad(r);
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
        const d = await skillsCatalogDefaultRoot();
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

  const reloadLocals = useCallback(async (silent = false) => {
    setLocalsLoading(true);
    try { setLocals(await skillsList()); }
    catch (e) {
      // On the catalog page a failed pi skill list is non-fatal (the local
      // installed badges just stay empty) — don't spam a toast. Only surface
      // the error when the user explicitly opened the "我安装的" view.
      if (!silent) onToast?.(`加载技能失败：${String(e).replace(/^Error:\s*/, "")}`);
    }
    finally { setLocalsLoading(false); }
  }, [onToast]);
  // Mount: load silently so the catalog page never shows a pi error toast.
  useEffect(() => { reloadLocals(true); }, [reloadLocals]);
  // Entering the installed view: reload with feedback.
  useEffect(() => { if (view === "installed") reloadLocals(false); }, [view, reloadLocals]);

  const installedNames = useMemo(
    () => new Set(locals.map((s) => (s.displayName || s.name).toLowerCase())),
    [locals],
  );

  const featured = useMemo(
    () => (catalog?.skills ?? []).filter((s) => s.featured),
    [catalog],
  );

  const chips = useMemo(() => {
    const present = new Set((catalog?.skills ?? []).map((s) => s.cat));
    const out: { id: string | null; label: string }[] = [{ id: null, label: "全部" }];
    for (const c of catalog?.categories ?? []) {
      if (present.has(c.id)) out.push({ id: c.id, label: c.zh });
    }
    return out;
  }, [catalog]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog?.skills ?? []).filter((s) => {
      if (cat && s.cat !== cat) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        (s.descEn ?? "").toLowerCase().includes(q)
      );
    });
  }, [catalog, cat, search]);

  const chooseDir = useCallback(async () => {
    try {
      const sel = await openDialog({
        directory: true, multiple: false, title: "选择技能数据目录",
        defaultPath: root || DEFAULT_PICK,
      });
      const pick = Array.isArray(sel) ? sel[0] : sel;
      if (!pick) return;
      await loadCatalog(pick);
      if (!error) onToast?.(`已切换技能数据目录：${pick}`);
    } catch { /* cancelled */ }
  }, [root, loadCatalog, onToast, error]);

  const handleAdd = (skill: SkillItem) => setModalSkill(skill);

  const handleToggle = useCallback(async (s: SkillInfo, enabled: boolean) => {
    try { await skillsToggle(s.name, enabled); reloadLocals(); }
    catch (e) { onToast?.(`切换失败：${String(e).replace(/^Error:\s*/, "")}`); }
  }, [onToast, reloadLocals]);

  const handleRemove = useCallback(async (s: SkillInfo) => {
    if (!s.path) { onToast?.("内置技能无法移除"); return; }
    if (!confirm(`确定移除技能「${s.displayName || s.name}」？`)) return;
    try { await skillsRemove(s.path); onToast?.("已移除"); reloadLocals(); }
    catch (e) { onToast?.(`移除失败：${String(e).replace(/^Error:\s*/, "")}`); }
  }, [onToast, reloadLocals]);

  // ---- no data dir yet ----
  if (needPick && !catalog && view === "center") {
    return (
      <div className="um-page">
        <header className="um-topbar"><div className="um-topbar-left">{pills}</div></header>
        <div className="um-scroll">
          <div className="ec-empty">
            <FolderOpenIcon size="xl" className="ec-empty-icon" />
            <p>未找到技能数据目录</p>
            <p className="ec-empty-hint">请选择包含专家技能目录（<code>&lt;plugin&gt;/skills/*/SKILL.md</code>）的数据根</p>
            <button type="button" className="um-btn um-btn--primary" onClick={chooseDir}>
              <FolderOpenIcon size="sm" /><span>选择来源目录</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- 我安装的 sub-page ----
  if (view === "installed") {
    return (
      <div className="um-page">
        <header className="um-topbar">
          <div className="um-topbar-left">
            <button type="button" className="um-back" onClick={() => setView("center")}>
              <ChevronLeftIcon size="sm" /><span>技能市场</span>
            </button>
          </div>
          <div className="um-topbar-right">
            <button type="button" className="um-btn um-btn--grey" onClick={() => setImportOpen(true)}>
              <AddCircleIcon size="sm" /><span>添加技能</span>
            </button>
          </div>
        </header>
        <div className="um-scroll">
          {localsLoading ? (
            <div className="ec-loading">加载中…</div>
          ) : locals.length === 0 ? (
            <div className="ec-empty">
              <PuzzlePieceIcon size="xl" className="ec-empty-icon" />
              <p>还没有安装任何技能</p>
              <p className="ec-empty-hint">点击右上角「添加技能」或从市场导入</p>
            </div>
          ) : (
            <div className="sk-inst-list">
              {locals.map((s) => (
                <div key={s.name + (s.path ?? "")} className="sk-inst-row">
                  <div className="sk-card-head" style={{ flex: 1 }}>
                    <PuzzlePieceIcon size="md" className="sk-inst-icon" />
                    <div className="sk-inst-info">
                      <div className="sk-card-name">{s.displayName || s.name}</div>
                      <p className="sk-card-desc">{s.description || "（无描述）"}</p>
                    </div>
                  </div>
                  <label className="sk-toggle" title={s.enabled ? "已启用" : "已禁用"}>
                    <input type="checkbox" checked={s.enabled}
                      onChange={() => handleToggle(s, !s.enabled)} />
                    <span className="sk-toggle-track"><span className="sk-toggle-thumb" /></span>
                  </label>
                  {s.path && (
                    <button type="button" className="sk-inst-del" title="移除"
                      onClick={() => handleRemove(s)}><DeleteIcon size="sm" /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {importOpen && (
          <ImportSkillModal onClose={() => setImportOpen(false)} onToast={onToast}
            onInstalled={reloadLocals} />
        )}
      </div>
    );
  }

  // ---- catalog (market) ----
  return (
    <div className="um-page">
      <header className="um-topbar">
        <div className="um-topbar-left">{pills}</div>
        <div className="um-topbar-right">
          <div className="um-search">
            <SearchIcon size="sm" className="um-search-icon" />
            <input className="um-search-input" value={search} placeholder="搜索技能"
              onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button type="button"
            className="um-btn um-btn--grey" onClick={() => setView("installed")}>
            <InstalledSkillIcon size="sm" /><span>我安装的</span>
          </button>
          <button type="button" className="um-btn um-btn--grey" onClick={() => setImportOpen(true)}>
            <AddCircleIcon size="sm" /><span>添加技能</span>
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

        {loading && !catalog && <div className="ec-loading">扫描技能目录…</div>}
        {error && (
          <div className="ec-error">
            加载失败：{error}
            <button type="button" className="ec-source-btn" onClick={chooseDir}>选择目录</button>
          </div>
        )}

        {catalog && (
          <>
            {featured.length > 0 && (
              <section className="sk-featured">
                <div className="sk-featured-head">
                  <h3 className="ec-section-title">精选技能</h3>
                  <span className="ec-section-sub">内置技能 · 共 {featured.length} 个</span>
                </div>
                <div className="sk-featured-grid">
                  {featured.slice(0, FEATURED_WINDOW).map((s) => (
                    <SkillCatalogCard key={s.id} skill={s}
                      installed={installedNames.has(s.name.toLowerCase())} root={root}
                      onAdd={handleAdd} onOpen={setModalSkill} />
                  ))}
                </div>
              </section>
            )}

            <div className="ec-chips">
              {chips.map((c) => (
                <Chip key={c.id ?? "all"} label={c.label}
                  active={cat === c.id} onClick={() => setCat(c.id)} />
              ))}
            </div>

            {visible.length === 0 ? (
              <div className="ec-empty">
                <SparklesIcon size="xl" className="ec-empty-icon" />
                <p>{search ? `没有找到与「${search}」匹配的技能` : "该分类暂无技能"}</p>
              </div>
            ) : (
              <div className="sk-grid">
                {visible.map((s) => (
                  <SkillCatalogCard key={s.id} skill={s}
                    installed={installedNames.has(s.name.toLowerCase())} root={root}
                    onAdd={handleAdd} onOpen={setModalSkill} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {modalSkill && (
        <SkillDetailModal
          skill={modalSkill}
          installed={locals}
          onClose={() => setModalSkill(null)}
          onInstalled={reloadLocals}
          onToast={onToast}
          root={root}
        />
      )}

      {importOpen && (
        <ImportSkillModal onClose={() => setImportOpen(false)} onToast={onToast}
          onInstalled={reloadLocals} />
      )}
    </div>
  );
}
