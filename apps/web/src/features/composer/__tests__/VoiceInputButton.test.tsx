import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VoiceInputButton } from "../VoiceInputButton";
import { registerAsrProvider, resetVoiceRegistry, type AsrProvider } from "../voice-contract";

function fakeAsr(): { provider: AsrProvider; emitFinal: (text: string) => void; emitEnd: () => void } {
  let final: ((text: string) => void) | undefined;
  let end: (() => void) | undefined;
  const provider: AsrProvider = {
    id: "fake",
    isAvailable: () => true,
    listen: (_lang, handlers) => {
      final = handlers.onFinal;
      end = handlers.onEnd;
      return () => {};
    },
  };
  return { provider, emitFinal: (text) => final?.(text), emitEnd: () => end?.() };
}

afterEach(resetVoiceRegistry);

describe("VoiceInputButton", () => {
  it("没有 ASR provider 时不渲染", () => {
    render(<VoiceInputButton text="" onChange={() => {}} lang="zh-CN" />);
    expect(screen.queryByRole("button", { name: "语音输入" })).toBeNull();
  });

  it("识别结果追加到起始文本", () => {
    const asr = fakeAsr();
    registerAsrProvider(asr.provider);
    const onChange = vi.fn();
    render(<VoiceInputButton text="帮我" onChange={onChange} lang="zh-CN" />);
    fireEvent.click(screen.getByRole("button", { name: "语音输入" }));
    asr.emitFinal("总结");
    expect(onChange).toHaveBeenLastCalledWith("帮我 总结");
    expect(screen.getByRole("button", { name: "停止录音" })).toBeInTheDocument();
    act(() => asr.emitEnd());
    expect(screen.getByRole("button", { name: "语音输入" })).toBeInTheDocument();
  });
});
