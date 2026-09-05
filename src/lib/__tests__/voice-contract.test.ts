import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerTtsProvider,
  registerAsrProvider,
  resetVoiceRegistry,
  getActiveTts,
  getActiveAsr,
  listProviderIds,
  createWebSpeechAsrProvider,
  createWebSpeechTtsProvider,
  nextTtsStatus,
  nextAsrStatus,
  type TtsProvider,
  type AsrProvider,
} from "../agent/voice-contract";

describe("voice-contract — 注册表", () => {
  beforeEach(resetVoiceRegistry);

  const tts = (id: string, avail = true): TtsProvider => ({
    id,
    isAvailable: () => avail,
    speak: () => () => {},
  });
  const asr = (id: string, avail = true): AsrProvider => ({
    id,
    isAvailable: () => avail,
    listen: () => () => {},
  });

  it("注册后可列出 id", () => {
    registerTtsProvider(tts("cloud-tts"));
    registerAsrProvider(asr("cloud-asr"));
    expect(listProviderIds()).toEqual({ tts: ["cloud-tts"], asr: ["cloud-asr"] });
  });

  it("getActive 取第一个可用 provider", () => {
    registerTtsProvider(tts("unavailable", false));
    registerTtsProvider(tts("available"));
    expect(getActiveTts()?.id).toBe("available");
  });

  it("无可用 provider 返回 null", () => {
    registerAsrProvider(asr("x", false));
    expect(getActiveAsr()).toBeNull();
    expect(getActiveTts()).toBeNull();
  });

  it("重复注册同 id 覆盖且提到最高优先级", () => {
    registerTtsProvider(tts("a"));
    registerTtsProvider(tts("b"));
    registerTtsProvider(tts("a")); // 重新注册 a
    const ids = listProviderIds().tts;
    expect(ids[0]).toBe("a"); // a 提到最前
    expect(ids).toHaveLength(2); // 不重复
  });

  it("reset 清空注册表", () => {
    registerTtsProvider(tts("a"));
    resetVoiceRegistry();
    expect(listProviderIds()).toEqual({ tts: [], asr: [] });
  });
});

describe("createWebSpeechAsrProvider", () => {
  beforeEach(resetVoiceRegistry);

  it("listen 把中间/最终结果回调出去,并返回 stop", () => {
    let started = false;
    const fakeRec = {
      lang: "",
      interimResults: false,
      continuous: false,
      start: () => {
        started = true;
      },
      stop: vi.fn(),
      onresult: null as ((e: unknown) => void) | null,
      onerror: null as ((e: unknown) => void) | null,
      onend: null as (() => void) | null,
    };
    const provider = createWebSpeechAsrProvider({
      isAvailable: () => true,
      createRecognition: (lang) => {
        fakeRec.lang = lang;
        return fakeRec;
      },
    });
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    const onEnd = vi.fn();
    const stop = provider.listen("zh-CN", { onInterim, onFinal, onEnd });
    expect(started).toBe(true);
    expect(fakeRec.lang).toBe("zh-CN");

    // 模拟一条中间 + 一条最终结果。
    fakeRec.onresult!({
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: "你" } },
        { isFinal: true, 0: { transcript: "你好" } },
      ],
    });
    expect(onInterim).toHaveBeenCalledWith("你");
    expect(onFinal).toHaveBeenCalledWith("你好");

    fakeRec.onend!();
    expect(onEnd).toHaveBeenCalled();

    stop();
    expect(fakeRec.stop).toHaveBeenCalled();
  });

  it("start 抛错时回调 onError", () => {
    const provider = createWebSpeechAsrProvider({
      isAvailable: () => true,
      createRecognition: () => ({
        lang: "",
        interimResults: false,
        continuous: false,
        start: () => {
          throw new Error("boom");
        },
        stop: () => {},
        onresult: null,
        onerror: null,
        onend: null,
      }),
    });
    const onError = vi.fn();
    provider.listen("en", { onError });
    expect(onError).toHaveBeenCalledWith("start-failed");
  });

  it("isAvailable 透传依赖谓词", () => {
    const p = createWebSpeechAsrProvider({
      isAvailable: () => false,
      createRecognition: () => ({}) as never,
    });
    expect(p.isAvailable()).toBe(false);
  });
});

describe("createWebSpeechTtsProvider", () => {
  beforeEach(resetVoiceRegistry);

  it("speak 调用 synth.speak 并返回 stop(=cancel)", () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() };
    const provider = createWebSpeechTtsProvider({
      isAvailable: () => true,
      createUtterance: (_text, lang, opts) => ({ lang, ...opts }),
      synth,
    });
    const stop = provider.speak("你好", "zh-CN", { rate: 1 });
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalled();
    stop();
    // stop 至少再 cancel 一次。
    expect(synth.cancel.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("空文本不强制要求 speak(由调用方决定),但 provider 可被调用", () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() };
    const provider = createWebSpeechTtsProvider({
      isAvailable: () => true,
      createUtterance: () => ({ lang: "zh-CN" }),
      synth,
    });
    provider.speak("", "zh-CN");
    expect(synth.speak).toHaveBeenCalled();
  });
});

describe("nextTtsStatus / nextAsrStatus 状态机", () => {
  it("TTS: idle → speaking → idle", () => {
    expect(nextTtsStatus("idle", "start")).toBe("speaking");
    expect(nextTtsStatus("speaking", "stop")).toBe("idle");
  });
  it("TTS: speaking → paused → speaking", () => {
    expect(nextTtsStatus("speaking", "pause")).toBe("paused");
    expect(nextTtsStatus("paused", "resume")).toBe("speaking");
    expect(nextTtsStatus("paused", "start")).toBe("speaking");
  });
  it("TTS: 非法迁移保持原状", () => {
    expect(nextTtsStatus("idle", "pause")).toBe("idle");
    expect(nextTtsStatus("idle", "resume")).toBe("idle");
    expect(nextTtsStatus("speaking", "start")).toBe("speaking");
  });
  it("TTS: fail → error", () => {
    expect(nextTtsStatus("speaking", "fail")).toBe("error");
  });

  it("ASR: idle → listening → idle", () => {
    expect(nextAsrStatus("idle", "start")).toBe("listening");
    expect(nextAsrStatus("listening", "stop")).toBe("idle");
  });
  it("ASR: 非法迁移保持原状", () => {
    expect(nextAsrStatus("listening", "start")).toBe("listening");
    expect(nextAsrStatus("idle", "stop")).toBe("idle");
  });
  it("ASR: fail → error", () => {
    expect(nextAsrStatus("listening", "fail")).toBe("error");
  });
});
