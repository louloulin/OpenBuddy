/**
 * 删除态阅读 (B3d): when the file is gone, the latest checkpoint that recorded its content is
 * still readable. Both the workbench tab and the independent reader use this hook.
 */
import { useEffect, useState } from "react";
import { checkpointList, checkpointRead } from "@openbuddy/client/agent-client";
import { friendlyError } from "@openbuddy/chat-core/error-format";
import { Markdown } from "@openbuddy/markdown";
import { useTheme } from "@openbuddy/ui/ThemeProvider";
import { benchKind, isTextKind } from "./bench-kind";

export interface FallbackState {
  loading: boolean;
  text?: string;
  at?: number;
  error?: string;
}

export function useArtifactFallback(sessionId: string, path: string, active: boolean, version: number): FallbackState {
  const [state, setState] = useState<FallbackState>({ loading: false });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setState({ loading: true });
    (async () => {
      try {
        const records = [...(await checkpointList(sessionId, path))].sort((a, b) => b.at - a.at);
        const latest = records.find((record) => record.after);
        if (!latest?.after) {
          if (alive) setState({ loading: false });
          return;
        }
        const read = await checkpointRead(sessionId, latest.after);
        if (alive) setState({ loading: false, text: read.text ?? "", at: latest.at });
      } catch (error) {
        if (alive) setState({ loading: false, error: friendlyError(error) });
      }
    })();
    return () => { alive = false; };
  }, [active, sessionId, path, version]);
  return state;
}

/** Render deleted-artifact content without pretending the file still exists. */
export function ArtifactFallbackBody({ path, state }: { path: string; state: FallbackState }) {
  const { theme } = useTheme();
  const kind = benchKind(path);
  if (state.loading) return <div className="bench-skeleton" aria-label="正在读取最后保存的版本"><span /><span /><span /></div>;
  if (state.error) return <div className="bench-empty"><div className="bench-empty__title">无法读取最后保存的版本</div><div className="bench-empty__hint">{state.error}</div></div>;
  if (state.text === undefined) {
    return (
      <div className="bench-empty">
        <div className="bench-empty__title">还没有留存过这个文件的内容</div>
        <div className="bench-empty__hint">它可能在第一次修改前就被删除了。</div>
      </div>
    );
  }
  if (kind === "markdown") {
    return <div className="bench-doc"><Markdown complete markdownTheme="loose" theme={theme}>{state.text}</Markdown></div>;
  }
  if (isTextKind(kind)) return <pre className="bench-plain">{state.text}</pre>;
  return <div className="bench-empty"><div className="bench-empty__title">这个版本不是文本</div><div className="bench-empty__hint">二进制内容无法在这里显示。</div></div>;
}
