/**
 * 语音输入按钮 —— 把 Composer 接到 `voice-contract` 的 ASR provider。
 *
 * 默认 provider 是浏览器 Web Speech（`voice-web.ts` 启动时注册）；环境不支持时
 * 组件自己隐藏，不需要外部开关。识别结果通过 `onChange` 写回输入框，中间结果
 * 实时回显，最终结果叠加到起始文本之后。
 */
import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { getActiveAsr } from "./voice-contract";

function joinText(base: string, voice: string): string {
  if (!base) return voice;
  if (!voice) return base;
  const needsSpace = !/\s$/.test(base);
  return `${base}${needsSpace ? " " : ""}${voice}`;
}

function voiceError(reason: string): string {
  switch (reason) {
    case "not-allowed":
    case "permission-denied":
      return "麦克风权限被拒绝，请在系统设置中授权";
    case "no-speech":
      return "未检测到语音，请重试";
    case "audio-capture":
      return "未检测到可用的麦克风";
    case "network":
      return "语音识别网络异常，请稍后重试";
    default:
      return "语音输入启动失败，请重试";
  }
}

export function VoiceInputButton({
  text,
  onChange,
  lang,
  disabled,
  onToast,
}: {
  /** Current composer text at the moment recording starts. */
  text: string;
  onChange: (next: string) => void;
  lang: string;
  disabled?: boolean;
  onToast?: (message: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const baseRef = useRef("");
  const finalRef = useRef("");
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    return () => stopRef.current?.();
  }, []);

  // Registry access is cheap; re-reading it each render keeps the button honest
  // if an external provider is registered later.
  const asr = getActiveAsr();
  if (!asr) return null;

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setListening(false);
  };

  const start = () => {
    if (listening || disabled) return;
    baseRef.current = textRef.current;
    finalRef.current = "";
    let ended = false;
    setListening(true);
    stopRef.current = asr.listen(lang, {
      onInterim: (interim) => onChange(joinText(baseRef.current, finalRef.current + interim)),
      onFinal: (final) => {
        finalRef.current += final;
        onChange(joinText(baseRef.current, finalRef.current));
      },
      onError: (reason) => {
        onToast?.(voiceError(reason));
        ended = true;
        setListening(false);
        stopRef.current = null;
      },
      onEnd: () => {
        if (ended) return;
        setListening(false);
        stopRef.current = null;
      },
    });
  };

  return (
    <button
      type="button"
      className={"wb-composer__voice" + (listening ? " wb-composer__voice--on" : "")}
      onClick={(event) => {
        event.stopPropagation();
        if (listening) stop();
        else start();
      }}
      disabled={disabled}
      aria-label={listening ? "停止录音" : "语音输入"}
      aria-pressed={listening}
      title={listening ? "停止录音" : "语音输入"}
      data-tip={listening ? "停止录音" : "语音输入"}
    >
      {listening ? <Square size={13} strokeWidth={2.4} /> : <Mic size={15} strokeWidth={2} />}
    </button>
  );
}
