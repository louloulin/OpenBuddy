/**
 * 默认语音 provider 装配 —— 把浏览器 Web Speech API 注册进 provider-agnostic 契约。
 *
 * 只在渲染层启动时调用一次。环境不支持时静默跳过，UI 通过 `getActiveAsr/Tts`
 * 决定是否显示麦克风/朗读按钮，因此不需要额外开关。
 */
import {
  createWebSpeechAsrProvider,
  createWebSpeechTtsProvider,
  getActiveAsr,
  getActiveTts,
  registerAsrProvider,
  registerTtsProvider,
} from "./voice-contract";

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort?: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

type SpeechSynthesisUtteranceCtor = new (text: string) => {
  rate?: number;
  pitch?: number;
  lang?: string;
  onend?: (() => void) | null;
  onerror?: (() => void) | null;
};

interface VoiceWindow {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
  speechSynthesis?: {
    cancel(): void;
    speak(utterance: unknown): void;
  };
  SpeechSynthesisUtterance?: SpeechSynthesisUtteranceCtor;
}

/** 安装内建 Web Speech ASR/TTS（重复调用幂等）。 */
export function installWebVoiceProviders(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as VoiceWindow;

  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (Recognition && !getActiveAsr()) {
    registerAsrProvider(
      createWebSpeechAsrProvider({
        isAvailable: () => !!(w.SpeechRecognition ?? w.webkitSpeechRecognition),
        createRecognition: (lang) => {
          const rec = new Recognition();
          rec.lang = lang;
          rec.interimResults = true;
          rec.continuous = false;
          return rec;
        },
      }),
    );
  }

  const Utterance = w.SpeechSynthesisUtterance;
  const synth = w.speechSynthesis;
  if (Utterance && synth && !getActiveTts()) {
    registerTtsProvider(
      createWebSpeechTtsProvider({
        isAvailable: () => !!w.speechSynthesis,
        createUtterance: (text, lang, opts) => {
          const utterance = new Utterance(text);
          utterance.lang = lang;
          if (opts?.rate !== undefined) utterance.rate = opts.rate;
          if (opts?.pitch !== undefined) utterance.pitch = opts.pitch;
          if (opts?.onEnd) utterance.onend = opts.onEnd;
          return utterance;
        },
        synth,
      }),
    );
  }
}
