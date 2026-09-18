/**
 * composer/voice-recognition — 内建 Web Speech ASR 的类型与注册逻辑。
 *
 * P0 拆分（见 `docs/plan/06-roadmap.md` P0-1）：从 `Composer.tsx` 抽出，
 * **纯移动，逻辑零改动**。抽出的理由是这一块与 React 完全无关（纯类型 +
 * 两个模块级函数），却在 `Composer.tsx` 里占了 80 行，与组件的渲染逻辑混在
 * 一起。
 *
 * 依赖面只有 `@/lib/agent/voice-contract` 的 provider 注册表，因此可独立测试。
 */

import {
  registerAsrProvider,
  createWebSpeechAsrProvider,
} from "@/lib/agent/voice-contract";

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
export interface SpeechRecognitionErrorEventLike {
  error: string;
}
export interface VoiceRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: (e: SpeechRecognitionEventLike) => void;
  onerror: (e: SpeechRecognitionErrorEventLike) => void;
  onend: () => void;
}
type VoiceRecognitionCtor = new () => VoiceRecognition;

export function getSpeechRecognitionCtor(): VoiceRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  // SAFETY: `SpeechRecognition` / `webkitSpeechRecognition` are non-standard
  // DOM extensions absent from lib.dom.d.ts, so TypeScript cannot type `window`
  // here. The invariant is runtime-checked at the call site instead: the value
  // is only ever used after `??` yields a constructor, and the constructed
  // instance is consumed through the locally-declared `VoiceRecognition` shape
  // above — which mirrors exactly the four members this module reads/writes
  // (`lang`/`interimResults`/`continuous` + `start`/`stop`/`on*`). No member
  // outside that shape is touched, so a mismatch degrades to a no-op rather
  // than unsafe access.
  const w = window as unknown as {
    SpeechRecognition?: VoiceRecognitionCtor;
    webkitSpeechRecognition?: VoiceRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 注册内建 Web Speech ASR provider 到 voice-contract 注册表(provider-agnostic,
 * 对齐 WorkBuddy `asr:*` 契约)。外部 provider(如云端 STT)注册后会因其更高
 * 优先级而被优先使用。仅在首次调用时注册一次。
 */
let webSpeechAsrRegistered = false;
export function ensureWebSpeechAsrRegistered(): void {
  if (webSpeechAsrRegistered) return;
  webSpeechAsrRegistered = true;
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return;
  registerAsrProvider(
    createWebSpeechAsrProvider({
      isAvailable: () => getSpeechRecognitionCtor() !== null,
      createRecognition: (lang) => {
        const rec = new Ctor();
        rec.lang = lang;
        rec.interimResults = true;
        rec.continuous = false;
        return rec as never;
      },
    }),
  );
}
