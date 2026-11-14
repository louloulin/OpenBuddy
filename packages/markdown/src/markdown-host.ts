import { invoke } from "@openbuddy/client/ipc";
import { ask, save } from "@openbuddy/client/ipc";
import type { MarkdownConfig, PathType } from "./types";
import { appConfirm } from "../../../src/components/AppDialog";
import { artifactSave } from "@openbuddy/client/agent-client";

export type MarkdownHostOptions = {
  cwd?: string;
  sessionId?: string | null;
  onToast?: (msg: string) => void;
};

type PathStat = {
  path: string;
  exists: boolean;
  kind: string;
  absolute: string;
};

function linePreview(code: string, maxLines = 8): string {
  const lines = code.split(/\r?\n/);
  const head = lines.slice(0, maxLines).join("\n");
  if (lines.length > maxLines) {
    return `${head}\n…共 ${lines.length} 行`;
  }
  return head;
}

function joinPath(cwd: string, relative: string): string {
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const base = cwd.endsWith("/") || cwd.endsWith("\\") ? cwd : `${cwd}${sep}`;
  // If preferred path is already absolute, use as-is.
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(relative)) return relative;
  return `${base}${relative.replace(/^\.[\\/]/, "")}`;
}

function defaultSnippetName(language: string): string {
  const ext =
    language === "typescript" || language === "ts"
      ? "ts"
      : language === "javascript" || language === "js"
        ? "js"
        : language === "python" || language === "py"
          ? "py"
          : language === "rust" || language === "rs"
            ? "rs"
            : language === "json"
              ? "json"
              : language === "markdown" || language === "md"
                ? "md"
                : language === "css"
                  ? "css"
                  : language === "html"
                    ? "html"
                    : language === "tsx"
                      ? "tsx"
                      : language === "jsx"
                        ? "jsx"
                        : "txt";
  return `snippet.${ext}`;
}

/**
 * Open a local path with the OS (reveal file when possible).
 * Shared by markdown inline paths and tool-call diff paths.
 */
export async function openLocalPath(
  path: string,
  opts: { cwd?: string; type?: PathType; onToast?: (msg: string) => void },
): Promise<void> {
  const { cwd, type, onToast: toast } = opts;
  if (!cwd && !path.match(/^(?:[a-zA-Z]:[\\/]|[\\/])/)) {
    toast?.("无工作区，无法打开相对路径");
    return;
  }
  try {
    if (type === "directory") {
      await invoke("open_path", { path, cwd: cwd ?? null });
      return;
    }
    try {
      await invoke("reveal_in_folder", { path, cwd: cwd ?? null });
    } catch {
      await invoke("open_path", { path, cwd: cwd ?? null });
    }
  } catch (e) {
    toast?.(String(e).replace(/^Error:\s*/, ""));
  }
}


export function createMarkdownHostConfig(
  opts: MarkdownHostOptions,
): MarkdownConfig {
  const { cwd, sessionId, onToast } = opts;
  const toast = (msg: string) => onToast?.(msg);

  const pathClickHandler: MarkdownConfig["pathClickHandler"] = {
    onPathClick: (path, type, range) => {
      void (async () => {
        await openLocalPath(path, { cwd, type, onToast: toast });
        if (range?.start) {
          toast(
            `已打开 ${path}（L${range.start}${range.end ? `–${range.end}` : ""}）`,
          );
        }
      })();
    },
  };

  const resolveCode: MarkdownConfig["resolveCode"] = async (
    _requestId,
    code,
  ) => {
    const pure = code.replace(/#L\d+(?:-L\d+)?$/, "");
    // There is no symbol index: a bare identifier (`useEffect`, `true`) stays
    // plain code unless it names a real file or folder in the workspace.
    if (!pure.trim() || /\s/.test(pure.trim()) || pure.length > 260) return "unknown";
    try {
      const stat = await invoke<PathStat>("path_stat", {
        path: pure,
        cwd: cwd ?? null,
      });
      if (!stat.exists) return "unknown";
      if (stat.kind === "directory") return "directory";
      if (stat.kind === "file") return "file";
      return "unknown";
    } catch {
      return "unknown";
    }
  };

  const openCodeLink: MarkdownConfig["openCodeLink"] = (
    _requestId,
    code,
    type,
  ) => {
    pathClickHandler?.onPathClick(code.replace(/#L\d+(?:-L\d+)?$/, ""), type);
  };

  const onLinkClick: MarkdownConfig["onLinkClick"] = ({ href, event }) => {
    if (!href) return;
    // target=_blank is unreliable / may be blocked).
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
      event.preventDefault();
      void invoke("open_url", { url: href }).catch((e) =>
        toast(String(e).replace(/^Error:\s*/, "")),
      );
      return false;
    }
    return;
  };

  const onApplyCode: MarkdownConfig["onApplyCode"] = (
    code,
    language,
    preferredPath,
  ) => {
    void (async () => {
      if (!cwd) {
        toast("无工作区，无法应用代码到文件");
        return;
      }

      let target: string | null = null;

      // The fence named the file: show what would change, then write through the checkpoint
      // store so the write can be undone from the workbench (20261115-ui U1.7).
      if (preferredPath && preferredPath.trim()) {
        const resolved = joinPath(cwd, preferredPath.trim());
        let before: string | null = null;
        try {
          before = await invoke<string>("read_text_file", { path: resolved, maxBytes: 4 * 1024 * 1024 });
        } catch {
          before = null; // new file
        }
        if (before === code) {
          toast("内容与当前文件相同，无需写入");
          return;
        }
        const ok = await appConfirm({
          title: before === null ? `新建 ${preferredPath.trim()}？` : `覆盖 ${preferredPath.trim()}？`,
          message: `位置：${resolved}${sessionId ? "\n写入前会留快照，之后可在工作台的变更里还原。" : ""}`,
          diff: { before: before ?? "", after: code },
          confirmLabel: before === null ? "新建文件" : "写入",
        });
        if (!ok) return;
        try {
          if (sessionId) {
            await artifactSave(sessionId, resolved, code, "apply");
            toast(`已写入 ${preferredPath.trim()} · 可还原`);
          } else {
            const written = await invoke<string>("write_text_file", { path: preferredPath.trim(), content: code, workspaceRoot: cwd });
            toast(`已写入 ${written}`);
          }
        } catch (e) {
          toast(String(e).replace(/^Error:\s*/, ""));
        }
        return;
      }

      // No preferred path — let user pick via save dialog.
      try {
        const picked = await save({
          defaultPath: joinPath(cwd, defaultSnippetName(language)),
          filters: [
            {
              name: "Code",
              extensions: [defaultSnippetName(language).split(".").pop() || "txt", "txt", "*"],
            },
          ],
        });
        if (!picked) {
          toast("已取消应用");
          return;
        }
        target = picked;
      } catch (e) {
        toast(`选择保存路径失败：${String(e).replace(/^Error:\s*/, "")}`);
        return;
      }

      const preview = linePreview(code);
      let ok = false;
      try {
        ok = await ask(
          `将把以下代码写入：\n${target}\n\n${preview}\n\n确认覆盖/创建该文件？`,
          {
            title: "应用代码到文件",
            kind: "warning",
            okLabel: "写入",
            cancelLabel: "取消",
          },
        );
      } catch {
        toast("无法显示确认对话框");
        return;
      }
      if (!ok) {
        toast("已取消写入");
        return;
      }

      try {
        const written = await invoke<string>("export_text_file", {
          path: target,
          content: code,
        });
        toast(`已写入 ${written}`);
      } catch (e) {
        toast(String(e).replace(/^Error:\s*/, ""));
      }
    })();
  };

  return {
    cwd,
    requestId: sessionId ?? undefined,
    pathClickHandler,
    resolveCode,
    openCodeLink,
    onLinkClick,
    onApplyCode,
  };
}

/** Map path_stat kind → Markdown PathType. */
export function pathStatToType(kind: string): PathType {
  if (kind === "file") return "file";
  if (kind === "directory") return "directory";
  return "unknown";
}
