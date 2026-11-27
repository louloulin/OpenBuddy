import { ShieldCheck } from "lucide-react";
import type { ExtensionPackagePreview } from "@openbuddy/protocol/extensions";
import { describeAppInstallError } from "@openbuddy/protocol/apps";

/** 预演结果汇总：工具/命令/技能/prompt 数与失败项（加载失败的扩展也算失败）。 */
export function summarizePreview(preview: ExtensionPackagePreview) {
  const tools = preview.extensions.reduce((sum, entry) => sum + entry.tools.length, 0);
  const commands = preview.extensions.reduce((sum, entry) => sum + entry.commands.length, 0);
  const failures = [
    ...preview.failures.map((failure) => describeAppInstallError(failure.message)),
    ...preview.extensions.filter((entry) => entry.error).map((entry) => `${entry.path.split(/[\\/]/).slice(-2).join("/")}：${entry.error}`),
  ];
  const skills = preview.skills.length;
  const prompts = preview.prompts.length;
  // 预演什么都解析不出来（典型：缺 npm / 克隆失败）时，确认了也只会装一个空壳。
  const empty = tools + commands + skills + prompts === 0;
  return { tools, commands, skills, prompts, failures, empty };
}

/**
 * 安装确认卡 (20261126-upup UP-2.5，安全闸)。
 *
 * 内容全部来自真实 `agent_extensions_preview_package`（Pi 在临时目录解析、不落盘）：
 * 来源、将注册的资源数、`pi.app.toolPolicy` 摘要、预演失败项。用户点「确认安装」才真正安装。
 */
export function AppInstallConfirm({
  preview,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: ExtensionPackagePreview;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const sum = summarizePreview(preview);
  const app = preview.app;
  const deny = app?.toolPolicy?.deny ?? [];
  const readonly = app?.toolPolicy?.readonly ?? [];
  const title = app ? `${app.name}${app.version ? ` ${app.version}` : ""}` : preview.source;
  return (
    <section className="app-install" role="dialog" aria-label={`安装确认 ${title}`}>
      <header className="app-install__head">
        <span className="app-install__icon" aria-hidden><ShieldCheck size={18} /></span>
        <div>
          <strong className="app-install__title">安装 {title}？</strong>
          {app?.tagline && <span className="app-install__desc">{app.tagline}</span>}
        </div>
      </header>
      <dl className="app-install__facts">
        <dt>来源</dt>
        <dd><code>{preview.source}</code></dd>
        <dt>将注册</dt>
        <dd>
          {sum.tools} 个工具 · {sum.commands} 个命令 · {sum.skills} 个技能 · {sum.prompts} 个提示词
          {app ? ` · ${app.scenes} 个场景` : ""}
        </dd>
        <dt>工具策略</dt>
        <dd>
          {deny.length || readonly.length ? (
            <>
              {deny.length > 0 && <span>禁止调用：{deny.join("、")}</span>}
              {readonly.length > 0 && <span>只读：{readonly.length} 个</span>}
            </>
          ) : (
            <span>未声明（平台红线仍会拦截交易类工具）</span>
          )}
        </dd>
      </dl>
      {sum.failures.length > 0 && (
        <div className="app-install__failures" role="alert">
          <strong>预演失败 {sum.failures.length} 项{sum.empty ? "，修复后再安装" : ""}</strong>
          <ul>
            {sum.failures.slice(0, 5).map((failure) => <li key={failure}>{failure}</li>)}
          </ul>
        </div>
      )}
      <footer className="app-install__actions">
        <button type="button" className="app-install__cancel" onClick={onCancel} disabled={busy}>取消</button>
        <button type="button" className="app-install__confirm" onClick={onConfirm} disabled={busy || sum.empty}>
          {busy ? "安装中…" : "确认安装"}
        </button>
      </footer>
    </section>
  );
}
