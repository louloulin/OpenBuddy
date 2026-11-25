import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { defaultOpenGet, defaultOpenSet, openUrl, type DefaultOpenMap } from "@openbuddy/client/api/files";
import { SectionShell } from "./shared";

/**
 * 默认打开方式 (G1-6，并供工作台 G3-6 使用)。
 *
 * 按文件类型记住「应用内预览」还是「系统应用」：这是用户自己的偏好，存在本地设置里，
 * 打开文件时按它决定，不在每次点击时再问一遍。
 */
const GROUPS: Array<{ id: string; label: string; types: Array<{ key: string; label: string }> }> = [
  { id: "doc", label: "文档", types: [{ key: "markdown", label: "Markdown" }, { key: "text", label: "纯文本" }, { key: "code", label: "代码" }] },
  { id: "office", label: "办公文件", types: [{ key: "docx", label: "Word" }, { key: "sheet", label: "表格" }, { key: "pptx", label: "PPT" }, { key: "pdf", label: "PDF" }] },
  { id: "media", label: "媒体", types: [{ key: "image", label: "图片" }, { key: "audio", label: "音频" }, { key: "video", label: "视频" }] },
  { id: "other", label: "其他", types: [{ key: "html", label: "网页" }, { key: "mermaid", label: "Mermaid 图" }, { key: "binary", label: "未知类型" }] },
];

export function DefaultOpenPanel() {
  const [map, setMap] = useState<DefaultOpenMap>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMap(await defaultOpenGet());
    } catch {
      setMap({});
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (type: string, value: "embedded" | "system") => {
    const next = { ...map, [type]: value };
    setBusy(true);
    setMsg(null);
    try {
      setMap(await defaultOpenSet(next));
    } catch (error) {
      setMsg(`保存失败：${String(error).replace(/^Error:\s*/, "")}`);
    } finally {
      setBusy(false);
    }
  };

  const openSystemSettings = async () => {
    try {
      await openUrl("x-apple.systempreferences:com.apple.Desktop-Settings.extension");
    } catch {
      setMsg("无法打开系统设置；可以在「访达 → 显示简介 → 打开方式」里改关联应用");
    }
  };

  return (
    <SectionShell
      title="默认打开方式"
      desc="打开文件时默认用应用内预览，还是交给系统关联的应用。这里的选择会被「我的文件」和产物面板沿用。"
    >
      {msg && <div className="settings-msg">{msg}</div>}
      {GROUPS.map((group) => (
        <div className="open-pref" key={group.id}>
          <div className="open-pref__title">{group.label}</div>
          {group.types.map((type) => {
            const value = map[type.key] ?? "embedded";
            return (
              <div className="open-pref__row" key={type.key}>
                <span className="open-pref__label">{type.label}</span>
                <div className="open-pref__seg" role="radiogroup" aria-label={`${type.label} 的默认打开方式`}>
                  {([["embedded", "应用内预览"], ["system", "系统应用"]] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={value === id}
                      className={"open-pref__opt" + (value === id ? " open-pref__opt--on" : "")}
                      disabled={busy}
                      onClick={() => void choose(type.key, id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="open-pref__foot">
        <button type="button" className="settings-btn" onClick={() => void openSystemSettings()}>
          <FolderOpen size={14} /> 打开系统「默认应用」设置
        </button>
        <span className="open-pref__hint">系统关联只影响「系统应用」这一档；应用内预览不受影响。</span>
      </div>
    </SectionShell>
  );
}
