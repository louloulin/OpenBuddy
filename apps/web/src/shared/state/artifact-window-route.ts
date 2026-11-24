/**
 * 产物独立窗口 (G3-3)：主进程打开 `#/artifact/<sessionId>?path=<path>`，
 * 渲染进程启动后把该产物直接挂到右侧工作台。
 *
 * 解析与「待打开目标」分开：`parseArtifactRoute` 是纯函数（可单测），
 * `takePendingArtifact` 让 ChatView 在会话就绪后消费一次，避免重复打开。
 */
export interface ArtifactRoute {
  sessionId: string;
  path: string;
}

export function parseArtifactRoute(hash: string): ArtifactRoute | null {
  const match = hash.match(/^#\/artifact\/([^/?#]+)(?:\?(.*))?$/);
  if (!match) return null;
  const sessionId = decodeURIComponent(match[1]);
  const query = new URLSearchParams(match[2] ?? "");
  const path = query.get("path") ?? "";
  if (!sessionId || !path) return null;
  return { sessionId, path };
}

let pending: ArtifactRoute | null = null;

/** Read the route once at boot and remember it until the session is ready. */
export function rememberArtifactRoute(hash: string): void {
  pending = parseArtifactRoute(hash);
}

/** ChatView: the file to open in the workbench, consumed once per window. */
export function takePendingArtifact(sessionId: string): string | null {
  if (!pending || pending.sessionId !== sessionId) return null;
  const path = pending.path;
  pending = null;
  return path;
}
