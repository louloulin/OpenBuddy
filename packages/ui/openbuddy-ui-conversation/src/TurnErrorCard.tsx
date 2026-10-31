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
 *   - 恢复动作:重试(重新生成) / 切换模型(限流、余额、模型不可用) / 去设置(鉴权、余额)
 *
 * 对齐 Claude / ChatGPT / PI-Desktop 的「失败也要有明确落点」原则：
 * 任何回合结束时，转录里必须留下一个可读、可操作的终态。
 */
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Copy from "lucide-react/dist/esm/icons/copy";
import { useCallback, useState } from "react";
import { useT } from "@openbuddy/ui-locale/client";
import { openModelSelector } from "@openbuddy/ui-workbench";
export interface TurnErrorInfo {
  message: string;
  code?: string;
}
type MessageError = TurnErrorInfo;

/** 换个模型往往就能继续:限流、余额、模型不存在、服务不可用。 */
const SWITCH_MODEL_CODES = new Set([
  "rate_limit_error",
  "model_not_found",
  "provider_error",
  "insufficient_balance_error",
  "insufficient_quota",
]);

/** 机器码 → 中文标题。未命中时回退到通用文案。 */
const CODE_TITLES: Record<string, string> = {
  rate_limit_error: "已达到模型用量上限",
  auth_error: "API Key 无效或未授权",
  permission_error: "当前账号没有该模型的访问权限",
  model_not_found: "所选模型不存在或已下线",
  provider_error: "模型服务暂时不可用",
  network_error: "网络连接中断",
  aborted: "生成已中断",
  insufficient_balance_error: "账户余额不足",
  insufficient_quota: "账户额度已用尽",
};

/** 这些错误码应当引导用户去设置页修配置,而不是无脑重试。 */
const CONFIGURATION_CODES = new Set([
  "auth_error",
  "permission_error",
  "model_not_found",
  "insufficient_balance_error",
  "insufficient_quota",
]);

/** 没有机器码时按 HTTP 状态(整词)推断,让 401/402/404/429 也有对的标题和入口。 */
const STATUS_CODES: Array<[RegExp, string]> = [
  [/\b(401|403)\b/, "auth_error"],
  [/\b402\b|insufficient[_ ]balance/i, "insufficient_balance_error"],
  [/\b404\b/, "model_not_found"],
  // Also matches the friendly text from formatPiError: the banner path only
  // has that string, the raw status is gone by then.
  [/\b429\b|rate[_ ]limit|速率限制/i, "rate_limit_error"],
  [/\b5\d\d\b|overloaded|过载|暂时不可用/i, "provider_error"],
];

/** True when picking another model is a sensible next step for this error. */
export function suggestsModelSwitch(error: MessageError): boolean {
  const code = inferErrorCode(error);
  return Boolean(code && SWITCH_MODEL_CODES.has(code));
}

export function inferErrorCode(error: MessageError): string | undefined {
  if (error.code) return error.code;
  return STATUS_CODES.find(([re]) => re.test(error.message))?.[1];
}

function titleFor(code: string | undefined): string {
  if (code && CODE_TITLES[code]) return CODE_TITLES[code];
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
  const switchModelLabel = useT("chat.turnError.switchModel");
  const switchModelTitle = useT("chat.turnError.switchModelTitle");
  const switchModelHint = useT("chat.turnError.switchModelHint");
  const raw = error.message.trim();
  const isLong = raw.includes("\n") || raw.length > 180;
  const code = inferErrorCode(error);

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
        <span className="turn-error__title">{titleFor(code)}</span>
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
          {suggestsModelSwitch(error) && (
            <button
              type="button"
              className="turn-error__btn"
              onClick={() => {
                if (!openModelSelector()) onToast?.(switchModelHint);
              }}
              title={switchModelTitle}
            >
              {switchModelLabel}
            </button>
          )}
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
