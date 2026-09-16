/**
 * MermaidNodeView —— 图表块的编辑态渲染。
 *
 * 三种状态,任何一步失败都不会白屏:
 *   1. 渲染中:骨架占位;
 *   2. 渲染成功:插入 SVG(严格模式,禁 script);
 *   3. 渲染失败 / mermaid 加载失败:降级为 Mermaid 源码文本 + 可编辑
 *      textarea,用户至少能看到并修正自己的图。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { loadMermaid } from "../lib/mermaid-loader";
import styles from "./MermaidNodeView.module.css";

type RenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

export function MermaidNodeView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const code = String(node.attrs.code ?? "");
  const [state, setState] = useState<RenderState>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  const renderIdRef = useRef(0);

  // 只在源码真的变了时同步草稿:同值时 React 会跳过重渲染,避免
  // 挂载阶段产生一次多余的状态写入。
  useEffect(() => {
    setDraft((current) => (current === code ? current : code));
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    const ticket = ++renderIdRef.current;
    if (code.trim().length === 0) {
      setState({ status: "error", message: "图表源码为空" });
      return () => {
        cancelled = true;
      };
    }
    setState({ status: "loading" });
    void loadMermaid()
      .then((mermaid) => mermaid.render(`ob-mermaid-${ticket}`, code))
      .then((result) => {
        if (cancelled || renderIdRef.current !== ticket) return;
        setState({ status: "ready", svg: result.svg });
      })
      .catch((error: unknown) => {
        if (cancelled || renderIdRef.current !== ticket) return;
        setState({ status: "error", message: String(error).replace(/^Error:\s*/, "") });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const commit = useCallback(() => {
    setEditing(false);
    updateAttributes({ code: draft });
  }, [draft, updateAttributes]);

  return (
    <NodeViewWrapper
      className={[
        styles.node,
        selected ? styles.nodeSelected : "",
        editing ? styles.nodeEditing : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-type="mermaid"
    >
      <div className={styles.header} contentEditable={false}>
        <span className={styles.badge}>Mermaid</span>
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => setEditing((v) => !v)}>
            {editing ? "取消" : "编辑源码"}
          </button>
          <button type="button" className={styles.action} onClick={() => deleteNode()}>
            删除
          </button>
        </div>
      </div>

      {editing ? (
        <div className={styles.editor} contentEditable={false}>
          <textarea
            className={styles.textarea}
            value={draft}
            spellCheck={false}
            aria-label="Mermaid 源码"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(code);
                setEditing(false);
              }
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit();
            }}
          />
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className={styles.placeholder} contentEditable={false} aria-busy="true">
          正在渲染图表…
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div
          className={styles.canvas}
          contentEditable={false}
          // mermaid securityLevel=strict 已禁用 script / 事件属性,
          // 这里仍显式声明来源以免被误当成用户内容。
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      ) : null}

      {state.status === "error" ? (
        <div className={styles.error} contentEditable={false} role="status">
          <div className={styles.errorTitle}>图表无法渲染</div>
          <div className={styles.errorMessage}>{state.message}</div>
          <pre className={styles.errorCode}>{code}</pre>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}
