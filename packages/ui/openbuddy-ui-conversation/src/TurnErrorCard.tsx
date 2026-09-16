/**
 * TurnErrorCard — assistant 回合失败的转录内错误卡片。
 *
 * 背景:pi 会把失败回合持久化成 `{ content: [], stopReason: "error",
 * errorMessage: "429 …" }` 的 assistant entry。此前会话投影只取
 * `content`，于是转录里出现一个「只有头像、没有内容」的空气泡——用户既
 * 看不出发生了什么，也没有任何恢复入口。
 *
 * 本组件把失败回合渲染成可读卡片：
 *   - 标题 + 机器码(rate_limit_error / auth_error …)
 *   - 原始错误正文(默认折叠到 3 行,可展开;可一键复制)
 *   - 恢复动作:重试(重新生成) / 去设置(鉴权类错误)
 *
 * 对齐 Claude / ChatGPT / PI-Desktop 的「失败也要有明确落点」原则：
 * 任何回合结束时，转录里必须留下一个可读、可操作的终态。
 */
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Copy from "lucide-react/dist/esm/icons/copy";
import { useCallback, useState } from "react";
export interface TurnErrorInfo {
  message: string;
  code?: string;
}
type MessageError = TurnErrorInfo;

/** 机器码 → 中文标题。未命中时回退到通用文案。 */
const CODE_TITLES: Record<string, string> = {
  rate_limit_error: "已达到模型用量上限",
  auth_error: "API Key 无效或未授权",
  permission_error: "当前账号没有该模型的访问权限",
  model_not_found: "所选模型不存在或已下线",
  provider_error: "模型服务暂时不可用",
  network_error: "网络连接中断",
  aborted: "生成已中断",
};

/** 这些错误码应当引导用户去设置页修配置,而不是无脑重试。 */
const CONFIGURATION_CODES = new Set([
  "auth_error",
  "permission_error",
  "model_not_found",
]);

function titleFor(error: MessageError): string {
  if (error.code && CODE_TITLES[error.code]) return CODE_TITLES[error.code];
  return "本次响应未能完成";
}

export function TurnErrorCard({
  error,
  onRetry,
  onOpenSettings,
  onToast,
}: {
  error: MessageError;
  /** 重新生成这条回复。 */
  onRetry?: () => void;
  /** 跳到设置页(仅鉴权 / 模型类错误展示)。 */
  onOpenSettings?: () => void;
  onToast?: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const raw = error.message.trim();
  const isLong = raw.includes("\n") || raw.length > 180;
  const code = error.code;

  const copy = useCallback(() => {
    if (!navigator.clipboard?.writeText) {
      onToast?.("当前环境不支持剪贴板");
      return;
    }
    navigator.clipboard
      .writeText(raw)
      .then(() => onToast?.("已复制错误信息"))
      .catch(() => onToast?.("复制失败"));
  }, [raw, onToast]);

  return (
    <div className="turn-error" role="alert" data-error-code={code ?? "unknown"}>
      <div className="turn-error__head">
        <span className="turn-error__icon" aria-hidden="true">
          <AlertTriangle size={15} strokeWidth={2} />
        </span>
        <span className="turn-error__title">{titleFor(error)}</span>
        {code && <code className="turn-error__code">{code}</code>}
        <div className="turn-error__actions">
          <button
            type="button"
            className="turn-error__btn"
            onClick={copy}
            title="复制错误信息"
          >
            <Copy size={12} strokeWidth={2} aria-hidden="true" />
            复制
          </button>
          {onOpenSettings && code && CONFIGURATION_CODES.has(code) && (
            <button
              type="button"
              className="turn-error__btn"
              onClick={onOpenSettings}
              title="打开设置检查模型配置"
            >
              去设置
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              className="turn-error__btn turn-error__btn--primary"
              onClick={onRetry}
              title="重新生成本次回复"
            >
              ↻ 重试
            </button>
          )}
        </div>
      </div>
      {raw && (
        <div className={"turn-error__body" + (expanded ? " turn-error__body--expanded" : "")}>
          <pre className="turn-error__text">{raw}</pre>
          {isLong && (
            <button
              type="button"
              className="turn-error__toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronDown
                size={12}
                strokeWidth={2}
                aria-hidden="true"
                style={{ transform: expanded ? "rotate(180deg)" : undefined }}
              />
              {expanded ? "收起详情" : "展开详情"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
