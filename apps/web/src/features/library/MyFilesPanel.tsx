import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon } from "@openbuddy/ui/icon/icons/index";
import { open as openDialog, invoke } from "@openbuddy/client/ipc";
import {
  SearchIcon,
  AddIcon,
  FolderOpenIcon,
  MyFilesIconV2,
  BookIcon,
  RefreshCwIcon,
} from "@openbuddy/ui/icon/icons/index";
import { FileText, FileSpreadsheet, FileImage, FileCode, Film, Music, Globe, File, FolderOpen } from "lucide-react";
import { formatFileSize, inferFileTypeFromExt, relativeTime, type FileType, type LocalFileItem } from "@/shared/lib/files/file-utils";
import { TaskArtifactsTab } from "./TaskArtifactsTab";
import { FileQuickPreview } from "./FileQuickPreview";
import { defaultOpenGet, type DefaultOpenMap } from "@openbuddy/client/api/files";

function FileTypeIcon({ type, size = 16 }: { type: FileType; size?: number }) {
  switch (type) {
    case "folder": return <FolderOpen size={size} />;
    case "document": case "markdown": return <FileText size={size} />;
    case "spreadsheet": return <FileSpreadsheet size={size} />;
    case "image": return <FileImage size={size} />;
    case "code": return <FileCode size={size} />;
    case "video": return <Film size={size} />;
    case "audio": return <Music size={size} />;
    case "website": return <Globe size={size} />;
    default: return <File size={size} />;
  }
}

/** Office / PDF 需要按扩展名细分（设置里的默认打开方式按这些键存）。 */
function extPrefKey(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "pptx" || ext === "ppt") return "pptx";
  if (ext === "xlsx" || ext === "xls") return "sheet";
  if (ext === "pdf") return "pdf";
  return "text";
}

const FILE_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "全部类型" },
  { value: "document", label: "文档" },
  { value: "markdown", label: "Markdown" },
  { value: "spreadsheet", label: "表格" },
  { value: "image", label: "图片" },
  { value: "code", label: "代码" },
  { value: "pdf", label: "PDF" },
  { value: "other", label: "其他" },
];

interface MyFilesPanelProps {
  cwd?: string;
  onToast?: (msg: string) => void;
}

export function MyFilesPanel({ cwd, onToast }: MyFilesPanelProps) {
  const [tab, setTab] = useState<"artifacts" | "local">("local");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <div className="myfiles-panel">
      <div className="myfiles-header">
        <h2 className="myfiles-title">我的文件</h2>
        <p className="myfiles-subtitle">
          查看当前工作区与用户选择的本地文件；此入口不提供网络上传。
        </p>
      </div>

      <div className="myfiles-tabs">
        <button
          className={`myfiles-tab ${tab === "artifacts" ? "myfiles-tab--active" : ""}`}
          aria-label="任务成果"
          onClick={() => setTab("artifacts")}
        >
          <BookIcon size="sm" /> 任务成果
        </button>
        <button
          className={`myfiles-tab ${tab === "local" ? "myfiles-tab--active" : ""}`}
          onClick={() => setTab("local")}
        >
          <FolderOpenIcon size="sm" /> 本地文件
        </button>
      </div>

      <div className="myfiles-toolbar">
        <div className="myfiles-filter-wrap">
          <button
            className="myfiles-filter-btn"
            onClick={() => setFilterOpen(!filterOpen)}
          >
            全部类型 <ChevronDownIcon size="sm" style={{ verticalAlign: "text-bottom" }} />
          </button>
          {filterOpen && (
            <div className="myfiles-filter-dropdown">
              {FILE_TYPE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  className={`myfiles-filter-option ${typeFilter === f.value ? "myfiles-filter-option--active" : ""}`}
                  onClick={() => { setTypeFilter(f.value); setFilterOpen(false); }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="myfiles-search">
          <SearchIcon size="sm" />
          <input
            type="text"
            placeholder="搜索文件、任务或工作空间"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="myfiles-body">
        {tab === "artifacts" ? (
          <TaskArtifactsTab cwd={cwd} searchQuery={searchQuery} typeFilter={typeFilter} onToast={onToast} />
        ) : (
          <LocalFilesTab
            cwd={cwd}
            searchQuery={searchQuery}
            typeFilter={typeFilter}
            onToast={onToast}
          />
        )}
      </div>
    </div>
  );
}

function LocalFilesTab({
  cwd,
  searchQuery,
  typeFilter,
  onToast,
}: {
  cwd?: string;
  searchQuery: string;
  typeFilter: string;
  onToast?: (msg: string) => void;
}) {
  const [files, setFiles] = useState<LocalFileItem[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  // 默认打开方式 (G1-6 / G3-6)：system = 交给系统应用；embedded = 就地预览。
  const [openPrefs, setOpenPrefs] = useState<DefaultOpenMap>({});
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  useEffect(() => {
    void defaultOpenGet().then(setOpenPrefs).catch(() => setOpenPrefs({}));
  }, []);

  /** 文件类型 → 偏好键（与设置里的分组保持一致）。 */
  const prefKey = (file: LocalFileItem): string => {
    if (file.isDir) return "folder";
    switch (file.type) {
      case "markdown": return "markdown";
      case "spreadsheet": return "sheet";
      case "image": return "image";
      case "code": return "code";
      case "document": return extPrefKey(file.name);
      case "website": return "html";
      default: return "text";
    }
  };

  const openFile = async (file: LocalFileItem) => {
    // 每次都读一次偏好：在设置里改完，回到这里立即生效。
    const prefs = await defaultOpenGet().catch(() => openPrefs);
    const pref = prefs[prefKey(file)] ?? "embedded";
    if (pref === "system") {
      try { await invoke("open_path", { path: file.path }); }
      catch { onToast?.("无法用系统应用打开这个文件"); }
      return;
    }
    setPreviewPath(file.path);
  };
  const currentDir = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1] : (cwd || "");

  const loadDir = useCallback(async (dir: string) => {
    if (!dir) return;
    setLoading(true);
    try {
      const entries: Array<{
        name: string;
        path: string;
        kind: string;
        size: number;
        modified_at?: number;
      }> = await invoke("list_dir", { path: dir });
      const items: LocalFileItem[] = entries.map((e) => ({
        name: e.name,
        path: e.path,
        isDir: e.kind === "directory",
        size: e.size,
        modifiedAt: e.modified_at ?? 0,
        type: inferFileTypeFromExt(e.name, e.kind === "directory"),
      }));
      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(items);
    } catch {
      setFiles([]);
      onToast?.("无法读取本地目录，请通过目录选择器重新授权后重试。");
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    if (currentDir) void loadDir(currentDir);
  }, [currentDir, loadDir]);

  const handleEnterFolder = (path: string) => {
    setBreadcrumb((prev) => [...prev, path]);
  };

  const handleBreadcrumbClick = (index: number) => {
    setBreadcrumb((prev) => prev.slice(0, index + 1));
  };

  const handlePickFile = async () => {
    try {
      const selected = await openDialog({ multiple: false, directory: false, title: "选择并在默认应用中打开本地文件" });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) await invoke("open_path", { path });
    } catch { onToast?.("无法打开所选本地文件，请重新选择后重试。"); }
  };

  const handlePickDirectory = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "选择本地文件目录" });
      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) setBreadcrumb([path]);
    } catch {
      onToast?.("文件选择不可用");
    }
  };

  const filtered = files.filter((f) => {
    if (searchQuery) {
      if (!f.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    }
    if (typeFilter !== "all" && !f.isDir) {
      if (f.type !== typeFilter) return false;
    }
    return true;
  });

  return (
    <div className={"myfiles-local" + (previewPath ? " myfiles-local--split" : "")}>
      <div className="myfiles-local-toolbar">
        <button className="myfiles-action-btn" onClick={handlePickFile} title="选择后在系统默认应用中打开">选择本地文件</button>
        <button className="myfiles-action-btn" onClick={handlePickDirectory}>
          <AddIcon size="sm" /> 选择目录
        </button>
        <button className="myfiles-action-btn" onClick={() => loadDir(currentDir)}>
          <RefreshCwIcon size="sm" /> 刷新
        </button>
      </div>

      {breadcrumb.length > 0 && (
        <div className="myfiles-breadcrumb">
          <button
            className="myfiles-breadcrumb-item"
            onClick={() => setBreadcrumb([])}
          >
            根目录
          </button>
          {breadcrumb.map((p, i) => {
            const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
            return (
              <span key={i}>
                <span className="myfiles-breadcrumb-sep">/</span>
                <button
                  className="myfiles-breadcrumb-item"
                  onClick={() => handleBreadcrumbClick(i)}
                >
                  {name}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {loading && <div className="myfiles-empty">加载中…</div>}

      {!loading && !currentDir && (
        <div className="myfiles-empty">
          <FolderOpenIcon size="xl" />
          <p>请先选择一个工作空间目录</p>
        </div>
      )}

      {!loading && currentDir && filtered.length === 0 && (
        <div className="myfiles-empty">
          <MyFilesIconV2 size="xl" />
          <p>暂无文件</p>
        </div>
      )}

      {previewPath && (
        <aside className="myfiles-preview" aria-label="文件预览">
          <div className="myfiles-preview__bar">
            <span className="myfiles-preview__name" title={previewPath}>{previewPath.split(/[\\/]/).pop()}</span>
            <button type="button" className="myfiles-link myfiles-link--quiet" onClick={() => void invoke("open_path", { path: previewPath })}>用系统应用打开</button>
            <button type="button" className="myfiles-link myfiles-link--quiet" onClick={() => setPreviewPath(null)}>关闭预览</button>
          </div>
          <div className="myfiles-preview__body">
            <FileQuickPreview path={previewPath} />
          </div>
        </aside>
      )}

      {!loading && filtered.length > 0 && (
        <div className="myfiles-table">
          <div className="myfiles-table-head">
            <span className="myfiles-col-name">名称</span>
            <span className="myfiles-col-type">类型</span>
            <span className="myfiles-col-time">更新时间</span>
            <span className="myfiles-col-size">大小</span>
          </div>
          {filtered.map((file) => (
            <div
              key={file.path}
              className={`myfiles-row ${file.isDir ? "myfiles-row--folder" : ""}${previewPath === file.path ? " myfiles-row--active" : ""}`}
              onClick={() => (file.isDir ? handleEnterFolder(file.path) : void openFile(file))}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (file.isDir) handleEnterFolder(file.path);
                else void openFile(file);
              }}
            >
              <span className="myfiles-col-name">
                <FileTypeIcon type={file.type} size={18} />
                <span className="myfiles-row-name">{file.name}</span>
              </span>
              <span className="myfiles-col-type">
                {file.isDir ? "文件夹" : file.type}
              </span>
              <span className="myfiles-col-time">
                {file.modifiedAt ? relativeTime(file.modifiedAt) : "—"}
              </span>
              <span className="myfiles-col-size">
                {file.isDir ? "-" : formatFileSize(file.size)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
