import { useEffect, useRef, useState } from "react";
import { agentInit, agentNewSession, agentSend } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";

/**
 * 全局快速输入 (20261116-pii W7.2).
 *
 * A small always-on-top window opened by a system-wide shortcut. Sending creates a
 * new task with the configured default model/workspace and closes the window; the
 * main window is not brought forward.
 */
export function QuickInput() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const close = () => window.close();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    try {
      const init = await agentInit();
      const sessionId = await agentNewSession(init.cwd);
      await agentSend(sessionId, prompt);
      close();
    } catch (reason) {
      setError(friendlyError(reason));
      setBusy(false);
    }
  };

  return (
    <div className="quick-input">
      <header className="quick-input__head">
        <span className="quick-input__title">快速输入</span>
        <span className="quick-input__hint">新建任务 · 不切换主窗口</span>
        <button type="button" className="quick-input__close" aria-label="关闭" onClick={close}>×</button>
      </header>
      <textarea
        ref={inputRef}
        className="quick-input__box"
        value={text}
        placeholder="交给 Buddy 做点什么…（Enter 发送，Shift+Enter 换行，Esc 取消）"
        aria-label="快速输入内容"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      {error && <p className="quick-input__error" role="alert">{error}</p>}
      <footer className="quick-input__foot">
        <span className="quick-input__meta">{busy ? "正在创建任务…" : "使用当前默认模型与工作空间"}</span>
        <button type="button" className="quick-input__send" disabled={!text.trim() || busy} onClick={() => void send()}>
          发送
        </button>
      </footer>
    </div>
  );
}
