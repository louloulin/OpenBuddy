/**
 * TerminalPanel —— chat 侧终端面板(阶段 1)。
 *
 * 数据面:`terminal:*` IPC → 主进程终端会话(spawn 用户 shell,cwd 限信任
 * 工作区);输出经 `terminal:output` 事件流回,xterm.js 渲染,用户击键经
 * `terminal:input` 直通 stdin。
 *
 * 已知限制:主进程 spawn 管道非真 PTY(无 node-pty),全屏程序(vim/htop)
 * 与 TTY 探测会退化;常规命令(颜色/进度/交互输入)正常。
 */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@/lib/platform/electron-api";
import { useLocale } from "@openbuddy/ui-locale/client";

export interface TerminalPanelProps {
  /** 终端工作区 cwd(信任工作区内)。 */
  cwd?: string;
  /** 主题适配:xterm 前景/背景跟随明暗。 */
  theme?: { background: string; foreground: string };
}

/**
 * 终端配色走 CSS 变量(token 真源),不写字面色值——深色主题重定义 token,
 * 字面量不会跟着变(硬编码色值门禁会拦)。
 */
function cssToken(host: HTMLElement, name: string): string | undefined {
  const value = getComputedStyle(host).getPropertyValue(name).trim();
  return value || undefined;
}

export function TerminalPanel({ cwd, theme }: TerminalPanelProps) {
  // locale.t 是普通方法(不是 hook),可在 effect 内按会话 id 现取。
  const locale = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<{ id: string } | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
      // 背景/前景取自 token;调用方显式传入时优先,都没有就让 xterm 用默认。
      theme: {
        background: theme?.background ?? cssToken(host, "--wb-bg-primary"),
        foreground: theme?.foreground ?? cssToken(host, "--wb-text-strong"),
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // 容器尚未布局时 fit 可能抛错;下一次 observer 再试。
    }

    let sessionId: string | null = null;
    let disposed = false;
    const offHandlers: Array<() => void> = [];

    const api = (window as unknown as {
      api?: {
        invoke: (channel: string, payload?: unknown) => Promise<unknown>;
        events?: { on: (channel: string, cb: (payload: unknown) => void) => () => void };
      };
    }).api;

    term.onData((data) => {
      if (!sessionId) return;
      void api?.invoke("terminal:input", { id: sessionId, data }).catch(() => undefined);
    });

    void (async () => {
      try {
        const created = (await invoke("terminal:create", {
          cwd,
          cols: term.cols,
          rows: term.rows,
        })) as { id: string };
        if (disposed) {
          void invoke("terminal:kill", { id: created.id }).catch(() => undefined);
          return;
        }
        sessionId = created.id;
        sessionRef.current = { id: created.id };
        host.dataset.sessionId = created.id;

        const onOutput = (payload: unknown) => {
          const data = (payload as { id?: string; data?: string }) ?? {};
          if (data.id !== created.id) return;
          term.write(data.data ?? "");
        };
        const onExit = (payload: unknown) => {
          const data = (payload as { id?: string; code?: number }) ?? {};
          if (data.id !== created.id) return;
          term.write(`\r\n\x1b[2m[${locale.t("chat.terminal.exit", { code: data.code ?? "?" })}]\x1b[0m\r\n`);
        };
        // events.on 返回退订函数(preload 契约),直接收集。
        offHandlers.push(
          api?.events?.on("terminal:output", onOutput) ?? (() => undefined),
          api?.events?.on("terminal:exit", onExit) ?? (() => undefined),
        );
      } catch (error) {
        term.write(`\r\n\x1b[31m${locale.t("chat.terminal.createFailed", { error: String(error).replace(/^Error:\s*/, "") })}\x1b[0m\r\n`);
      }
    })();

    return () => {
      disposed = true;
      offHandlers.forEach((fn) => fn?.());
      if (sessionRef.current) {
        void invoke("terminal:kill", { id: sessionRef.current.id }).catch(() => undefined);
      }
      term.dispose();
      termRef.current = null;
    };
  // theme 以序列化比较,避免调用方传字面量导致每渲染重建终端。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, theme, JSON.stringify(theme)]);

  return (
    <div className="terminal-panel" data-testid="terminal-panel">
      <div ref={hostRef} className="terminal-panel__host" />
    </div>
  );
}
