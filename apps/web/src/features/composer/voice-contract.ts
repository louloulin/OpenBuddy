/**
 * 语音能力 provider-agnostic 契约 —— 对齐 WorkBuddy `tts:*` / `asr:*` RPC
 * (`tts:startTts` / `tts:stopTts` / `tts:event` / `asr:speechToText`)。
 *
 * WorkBuddy 的 TTS/ASR 契约本身 provider 无关(可绑定任意 STT/TTS 厂商);
 * OpenBuddy 是 BYOK 桌面应用,默认用浏览器 Web Speech API 作为内建 provider,
 * 同时允许注册外部 provider(例如对接云端 STT/TTS)。本模块是纯注册表 + 状态机,
 * 无 DOM/网络副作用,便于单测。
 */

/** 一次 TTS 任务的状态。 */
export type TtsStatus = "idle" | "speaking" | "paused" | "error";

/** ASR 识别状态。 */
export type AsrStatus = "idle" | "listening" | "error";

/** TTS provider 接口(任意实现:Web Speech、云端 TTS、本地模型)。 */
export interface TtsProvider {
  id: string;
  /** 开始朗读;text 非空才会调用。返回一个 stop 函数。 */
  speak(text: string, lang: string, opts?: { rate?: number; pitch?: number }): () => void;
  /** 是否可用(env 不支持时返回 false)。 */
  isAvailable(): boolean;
}

/** ASR provider 接口。 */
export interface AsrProvider {
  id: string;
  /**
   * 开始监听;通过回调实时回报:
   *  - onInterim:中间结果(实时回显用)
   *  - onFinal:最终结果
   *  - onError:出错
   *  - onEnd:会话结束(无论正常/异常)
   * 返回一个 stop 函数(停止监听)。
   */
  listen(
    lang: string,
    handlers: {
      onInterim?: (text: string) => void;
      onFinal?: (text: string) => void;
      onError?: (reason: string) => void;
      onEnd?: () => void;
    },
  ): () => void;
  /** 是否可用。 */
  isAvailable(): boolean;
}

interface VoiceRegistry {
  tts: TtsProvider[];
  asr: AsrProvider[];
}

const registry: VoiceRegistry = { tts: [], asr: [] };

/** 注册一个 TTS provider(后注册的优先级更高 = 排在前面)。 */
export function registerTtsProvider(p: TtsProvider): void {
  registry.tts = [p, ...registry.tts.filter((x) => x.id !== p.id)];
}

/** 注册一个 ASR provider。 */
export function registerAsrProvider(p: AsrProvider): void {
  registry.asr = [p, ...registry.asr.filter((x) => x.id !== p.id)];
}

/** 清空所有 provider(测试用)。 */
export function resetVoiceRegistry(): void {
  registry.tts = [];
  registry.asr = [];
}

/** 取第一个可用的 TTS provider(优先级最高);无则 null。 */
export function getActiveTts(): TtsProvider | null {
  return registry.tts.find((p) => p.isAvailable()) ?? null;
}

/** 取第一个可用的 ASR provider;无则 null。 */
export function getActiveAsr(): AsrProvider | null {
  return registry.asr.find((p) => p.isAvailable()) ?? null;
}

/** 列出所有已注册 provider 的 id(调试/状态展示用)。 */
export function listProviderIds(): { tts: string[]; asr: string[] } {
  return {
    tts: registry.tts.map((p) => p.id),
    asr: registry.asr.map((p) => p.id),
  };
}

// ---------- 内建 Web Speech provider(默认,可被外部 provider 覆盖)----------

/** 最小 SpeechRecognition 构造器形状(避免耦合 DOM 类型)。 */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort?: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechSynthesisLike {
  cancel(): void;
  speak(utter: { rate?: number; pitch?: number; lang?: string; onend?: () => void; onerror?: () => void }): void;
}

/**
 * 创建内建 Web Speech ASR provider。传入依赖注入以保持可测(env 谓词 + 构造器)。
 */
export function createWebSpeechAsrProvider(deps: {
  isAvailable: () => boolean;
  createRecognition: (lang: string) => SpeechRecognitionLike;
}): AsrProvider {
  return {
    id: "web-speech-asr",
    isAvailable: deps.isAvailable,
    listen(lang, handlers) {
      const rec = deps.createRecognition(lang);
      let finalText = "";
      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (interim) handlers.onInterim?.(interim);
        if (finalText) handlers.onFinal?.(finalText);
      };
      rec.onerror = (e) => handlers.onError?.(e.error);
      rec.onend = () => handlers.onEnd?.();
      try {
        rec.start();
      } catch {
        handlers.onError?.("start-failed");
      }
      return () => {
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      };
    },
  };
}

/**
 * 创建内建 Web Speech TTS provider(依赖注入以保持可测)。
 */
export function createWebSpeechTtsProvider(deps: {
  isAvailable: () => boolean;
  createUtterance: (text: string, lang: string, opts?: { rate?: number; pitch?: number }) => {
    rate?: number;
    pitch?: number;
    lang?: string;
    onend?: () => void;
    onerror?: () => void;
  };
  synth: SpeechSynthesisLike;
}): TtsProvider {
  return {
    id: "web-speech-tts",
    isAvailable: deps.isAvailable,
    speak(text, lang, opts) {
      const u = deps.createUtterance(text, lang, opts);
      deps.synth.cancel();
      deps.synth.speak(u);
      return () => deps.synth.cancel();
    },
  };
}

// ---------- 运行时状态机(可选,供 UI 反馈)----------

/** TTS 状态机:从 idle 出发,限定合法迁移。 */
export function nextTtsStatus(from: TtsStatus, action: "start" | "stop" | "pause" | "resume" | "fail"): TtsStatus {
  switch (action) {
    case "start":
      return from === "idle" || from === "paused" ? "speaking" : from;
    case "stop":
      return from === "speaking" || from === "paused" ? "idle" : from;
    case "pause":
      return from === "speaking" ? "paused" : from;
    case "resume":
      return from === "paused" ? "speaking" : from;
    case "fail":
      return "error";
  }
}

/** ASR 状态机。 */
export function nextAsrStatus(from: AsrStatus, action: "start" | "stop" | "fail"): AsrStatus {
  switch (action) {
    case "start":
      return from === "idle" ? "listening" : from;
    case "stop":
      return from === "listening" ? "idle" : from;
    case "fail":
      return "error";
  }
}
