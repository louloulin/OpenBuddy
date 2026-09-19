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

/**
 * Toggle microphone input. Bound to the mic button in Composer's footer.
 *
 * This function used to live inline in `Composer.tsx`; phase-3 split moved it
 * here so the component file stays under the 800-line cap. All deps are passed
 * explicitly — there is no module-level state shared with the caller.
 *
 * Two paths are tried in order:
 *   1. Provider-agnostic registry (`getActiveAsr()` from `@/lib/agent/voice-contract`)
 *      — preferred when an external STT provider has been registered.
 *   2. Built-in Web Speech API fallback via `getSpeechRecognitionCtor()`.
 * Both paths funnel through `updateText` (the renderer's controlled text
 * mutator) so the textarea reflects interim + final transcripts in real time.
 */
import { getActiveAsr } from "@/lib/agent/voice-contract";

export interface ToggleVoiceDeps {
  listening: boolean;
  setListening: (v: boolean) => void;
  recognitionRef: { current: VoiceRecognition | null };
  updateText: (next: string | ((prev: string) => string)) => void;
  onToast?: (msg: string) => void;
  onPlaceholder?: (label: string) => void;
}

export function toggleVoice(deps: ToggleVoiceDeps): void {
  if (deps.listening) {
    deps.recognitionRef.current?.stop();
    return;
  }
  ensureWebSpeechAsrRegistered();
  const provider = getActiveAsr();
  if (provider) {
    let finalText = "";
    const stop = provider.listen("zh-CN", {
      onInterim: (interim: string) => {
        deps.updateText((prev) => {
          const base = finalText || prev;
          return interim ? base + interim : base;
        });
      },
      onFinal: (text: string) => {
        finalText += text;
        deps.updateText((prev) => (finalText ? finalText : prev));
      },
      onError: (reason: string) => {
        deps.setListening(false);
        const msg = reason === "not-allowed"
          ? "未授予麦克风权限"
          : `语音识别错误：${reason}`;
        deps.onToast?.(msg);
      },
      onEnd: () => deps.setListening(false),
    });
    deps.recognitionRef.current = {
      lang: "zh-CN",
      interimResults: true,
      continuous: false,
      start: () => {},
      stop,
    } as VoiceRecognition;
    deps.setListening(true);
    return;
  }
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    deps.onToast?.("当前环境不支持语音输入（需要 WebView2/WKWebView）");
    deps.onPlaceholder?.("语音输入");
    return;
  }
  const rec = new Ctor();
  rec.lang = "zh-CN";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onresult = (event: SpeechRecognitionEventLike) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    deps.updateText((prev) => {
      const base = finalText || prev;
      return interim ? base + interim : base;
    });
  };
  rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
    deps.setListening(false);
    const msg = e.error === "not-allowed"
      ? "未授予麦克风权限"
      : `语音识别错误：${e.error}`;
    deps.onToast?.(msg);
  };
  rec.onend = () => deps.setListening(false);
  deps.recognitionRef.current = rec;
  try {
    rec.start();
    deps.setListening(true);
  } catch {
    deps.onToast?.("无法启动语音识别");
  }
}
