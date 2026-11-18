import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@openbuddy/client/ipc";
import { SearchIcon, MyExpertIcon, SparklesIcon, FolderOpenIcon, RefreshCwIcon } from "@openbuddy/ui/icon/icons/index";
import { agentsDelete, agentsGet, agentsList, expertsImportWorkbuddy, expertsLinkAgents, expertsLoad, expertsSetRoots } from "@openbuddy/client/agent-client";
import type { ExpertCenterCatalog, ExpertDraft, ExpertEntry, ExpertSceneInfo } from "@openbuddy/protocol/experts";
import { appConfirm } from "../../../shared/ui/AppDialog";
import { FEATURED_SCENES } from "../data/featured-scenes";
import { Chip } from "../shared/ui";
import { usePendingExpertStore } from "@/features/experts/state/pending-expert-store";
import { ExpertCard } from "./ExpertCard";
import { ExpertDetailModal } from "./ExpertDetailModal";
import { ExpertEditor } from "./ExpertEditor";
import { ExpertSources } from "./ExpertSources";
import { FeaturedScenes } from "./FeaturedScenes";
import { TeamCards } from "./TeamCards";
import { MyExperts } from "./MyExperts";
import { draftOf, emptyDraft, errorText, matches, toPending } from "./expert-model";
import "./experts.css";

interface Props {
  pills: React.ReactNode;
  /** Navigate back to the home page (after summoning an expert). */
  onGoHome?: () => void;
  onToast?: (message: string) => void;
  /** Views the host serves (pii W0.2): the 专家中心 catalog (experts_load) and 我的专家 (agents_list). */
  views?: { center: boolean; my: boolean };
}

/** Scenes from the catalog; the old gradient strip is the fallback (it only shows experts the catalog has). */
const fallbackScenes = (): ExpertSceneInfo[] =>
  FEATURED_SCENES.map((s) => ({ id: s.id, title: s.zh, description: "", expertIds: s.expertIds, from: s.from ?? "#eef2f7", to: s.to ?? "#f7f7f7" }));

/** The tab before W2.3 kept one chosen directory in localStorage; carry it over once as a library root. */
const LEGACY_ROOT_KEY = "expertsRoot";
async function migrateLegacyRoot(catalog: ExpertCenterCatalog): Promise<boolean> {
  let old = "";
  try { old = localStorage.getItem(LEGACY_ROOT_KEY) ?? ""; localStorage.removeItem(LEGACY_ROOT_KEY); } catch { return false; }
  if (!old || old === catalog.userDir || catalog.roots.some((r) => r.path === old)) return false;
  try { await expertsSetRoots([...catalog.roots.map((r) => r.path), old]); return true; } catch { return false; }
}

/**
 * 专家中心 (20261116-pii W2.3): the merged catalog (built-in seeds, 我的专家, trusted project
 * experts, library directories) with scenes, categories and search; 我的专家 with create / edit /
 * duplicate / delete; 召唤 pre-fills the home composer and binds the expert to the new task when
 * it is sent — it never sends by itself.
 */
export function ExpertsTab({ pills, onGoHome, onToast, views = { center: true, my: true } }: Props) {
  const [view, setView] = useState<"center" | "my">(views.center ? "center" : "my");
  const [catalog, setCatalog] = useState<ExpertCenterCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mine, setMine] = useState<ExpertEntry[]>([]);
  const [mineLoading, setMineLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExpertEntry | null>(null);
  const [editing, setEditing] = useState<ExpertDraft | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const setPending = usePendingExpertStore((s) => s.set);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await expertsLoad();
      setCatalog((await migrateLegacyRoot(loaded)) ? await expertsLoad() : loaded);
    }
    catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, []);
  const loadMine = useCallback(async () => {
    setMineLoading(true);
    try { setMine(await agentsList()); }
    catch (e) { onToast?.(`加载我的专家失败：${errorText(e)}`); }
    finally { setMineLoading(false); }
  }, [onToast]);
  const reload = useCallback(() => { void loadCatalog(); void loadMine(); }, [loadCatalog, loadMine]);

  useEffect(() => { if (views.center) void loadCatalog(); }, [loadCatalog, views.center]);
  useEffect(() => { if (view === "my") void loadMine(); }, [view, loadMine]);

  const categories = catalog?.categories ?? [];
  const experts = catalog?.experts ?? [];
  const expertById = useMemo(() => new Map(experts.map((e) => [e.id, e])), [experts]);
  const scenes = catalog?.scenes.length ? catalog.scenes : fallbackScenes();
  const chips = useMemo(() => {
    const present = new Set(experts.map((e) => e.category ?? "custom"));
    return [{ id: null as string | null, label: "全部" }, ...categories.filter((c) => present.has(c.id)).map((c) => ({ id: c.id as string | null, label: `${c.emoji} ${c.label}` }))];
  }, [experts, categories]);
  const visible = useMemo(() => experts.filter((e) => (!cat || (e.category ?? "custom") === cat) && matches(e, search)), [experts, cat, search]);

  const summon = useCallback((expert: ExpertEntry, example?: string) => {
    setDetail(null);
    setPending(toPending(expert, example));
    onToast?.(`已召唤「${expert.name}」，在输入框确认任务后发送`);
    onGoHome?.();
  }, [setPending, onGoHome, onToast]);
  const duplicate = (expert: ExpertEntry) => { setDetail(null); setEditing(draftOf(expert, true)); };
  const edit = async (expert: ExpertEntry) => {
    setDetail(null);
    // Re-read the file first: it may have been edited outside the app since the list was loaded.
    setEditing(draftOf(await agentsGet(expert.id).catch(() => expert)));
  };
  const remove = useCallback(async (expert: ExpertEntry) => {
    if (!(await appConfirm({ title: `删除专家「${expert.name}」？`, message: "将删除对应的 Markdown 文件；已绑定这位专家的任务不受影响。", confirmLabel: "删除", danger: true }))) return;
    try { await agentsDelete(expert.id); onToast?.(`已删除「${expert.name}」`); reload(); }
    catch (e) { onToast?.(`删除失败：${errorText(e)}`); }
  }, [onToast, reload]);
  const importExpert = useCallback(async (expert: ExpertEntry) => {
    if (!expert.origin) return;
    try {
      const n = await expertsLinkAgents(expert.origin, [expert.id]);
      onToast?.(n ? `已导入「${expert.name}」到我的专家` : "我的专家里已经是最新版本");
      setDetail(null);
      reload();
    } catch (e) { onToast?.(`导入失败：${errorText(e)}`); }
  }, [onToast, reload]);
  const onSaved = (expert: ExpertEntry, created: boolean) => {
    setEditing(null);
    onToast?.(created ? `已创建专家「${expert.name}」` : `已保存「${expert.name}」`);
    if (created) setView("my");
    reload();
  };
  const pickDir = async () => {
    try {
      const sel = await openDialog({ directory: true, multiple: false, title: "选择专家目录" });
      return (Array.isArray(sel) ? sel[0] : sel) || undefined;
    } catch { return undefined; }
  };
  /** WorkBuddy 兼容 (S18): pick its exported .zip and convert every agent into 我的专家. */
  const importWorkbuddy = useCallback(async () => {
    if (importing) return;
    try {
      const sel = await openDialog({ directory: false, multiple: false, title: "选择 WorkBuddy 专家包", filters: [{ name: "WorkBuddy 专家包", extensions: ["zip"] }] });
      const path = (Array.isArray(sel) ? sel[0] : sel) || undefined;
      if (!path) return;
      setImporting(true);
      const result = await expertsImportWorkbuddy(path);
      const failed = result.skipped.length ? `，${result.skipped.length} 位失败：${result.skipped[0]?.error ?? ""}` : "";
      onToast?.(result.imported.length ? `已从「${result.package}」导入 ${result.imported.length} 位专家${failed}` : `没有导入任何专家${failed}`);
      setView("my");
      reload();
    } catch (e) { onToast?.(`导入失败：${errorText(e)}`); }
    finally { setImporting(false); }
  }, [importing, onToast, reload]);

  const overlays = (
    <>
      {detail && (
        <ExpertDetailModal expert={detail} categories={categories} onClose={() => setDetail(null)} onSummon={summon}
          onDuplicate={duplicate} onEdit={edit} onImport={importExpert} />
      )}
      {editing && (
        <ExpertEditor draft={editing} categories={categories} templates={experts.filter((e) => e.readonly)}
          onCancel={() => setEditing(null)} onSaved={onSaved} />
      )}
      {sourcesOpen && catalog && (
        <ExpertSources catalog={catalog} onPickDir={pickDir} onChanged={reload} onClose={() => setSourcesOpen(false)} onToast={onToast} />
      )}
    </>
  );

  if (view === "my") {
    return (
      <>
        <MyExperts experts={mine} categories={categories} loading={mineLoading} userDir={catalog?.userDir}
          importing={importing} onImportWorkbuddy={importWorkbuddy}
          onBack={() => setView("center")} onCreate={() => setEditing(emptyDraft())} onOpen={setDetail}
          onSummon={(e) => summon(e)} onEdit={edit} onDuplicate={duplicate} onDelete={remove} />
        {overlays}
      </>
    );
  }

  return (
    <div className="um-page">
      <header className="um-topbar">
        <div className="um-topbar-left">{pills}</div>
        <div className="um-topbar-right">
          <div className="um-search">
            <SearchIcon size="sm" className="um-search-icon" />
            <input className="um-search-input" value={search} placeholder="搜索专家、擅长领域或示例任务" aria-label="搜索专家"
              onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button type="button" className="um-btn um-btn--grey" title="专家来源" onClick={() => setSourcesOpen(true)} disabled={!catalog}>
            <FolderOpenIcon size="sm" /><span>来源</span>
          </button>
          {views.my && (
            <button type="button" className="um-btn um-btn--grey" onClick={() => setView("my")}>
              <MyExpertIcon size="sm" /><span>我的专家</span>
            </button>
          )}
        </div>
      </header>

      <div className="um-scroll">
        {loading && !catalog && <div className="ec-loading">加载专家…</div>}
        {error && (
          <div className="ec-error">
            加载失败：{error}
            <button type="button" className="ec-source-btn" onClick={() => void loadCatalog()}><RefreshCwIcon size="sm" /><span>重试</span></button>
          </div>
        )}
        {catalog && catalog.problems.length > 0 && (
          <button type="button" className="ex-problem-bar" onClick={() => setSourcesOpen(true)}>有 {catalog.problems.length} 个专家文件无法读取，点击查看</button>
        )}
        {catalog && (
          <>
            {!search && !cat && <FeaturedScenes scenes={scenes} expertById={expertById} onOpen={setDetail} />}
            {/* 专家团 (W3.5): preset pipelines, installed as 我的指令. */}
            {!search && !cat && <TeamCards onToast={onToast} onSearch={setSearch} />}
            <div className="ec-list-head">
              <h3 className="ec-section-title ex-list-title">全部专家<span className="ex-count">{visible.length}</span></h3>
              <button type="button" className="ec-source-btn" onClick={() => void loadCatalog()} disabled={loading} title="刷新" aria-label="刷新专家">
                <RefreshCwIcon size="sm" />
              </button>
            </div>
            <div className="ec-chips">
              {chips.map((c) => <Chip key={c.id ?? "all"} label={c.label} active={cat === c.id} onClick={() => setCat(c.id)} />)}
            </div>
            {visible.length === 0 ? (
              <div className="ec-empty">
                <SparklesIcon size="xl" className="ec-empty-icon" />
                <p>{search ? `没有找到与「${search}」匹配的专家` : "这个分类下还没有专家"}</p>
                <button type="button" className="um-btn" onClick={() => setEditing({ ...emptyDraft(), name: search.trim(), category: cat ?? "custom" })}>+ 创建专家</button>
              </div>
            ) : (
              <div className="ec-grid">
                {visible.map((e) => <ExpertCard key={e.id} expert={e} categories={categories} onOpen={setDetail} onSummon={(x) => summon(x)} />)}
              </div>
            )}
          </>
        )}
      </div>
      {overlays}
    </div>
  );
}
