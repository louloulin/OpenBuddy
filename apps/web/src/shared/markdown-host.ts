/**
 * The web app's Markdown host (20261115-md R6), installed once in app/main.tsx.
 * These are the calls packages/markdown used to make itself (markdown-host.ts and
 * CodeBlockActions.tsx), moved here unchanged so the package no longer imports the client,
 * the platform clipboard or AppDialog.
 *
 * (Not under shared/markdown/: on Windows that folder collides with shared/Markdown.tsx.)
 */
import { ask, invoke, save } from "@openbuddy/client/ipc";
import { artifactSave } from "@openbuddy/client/agent-client";
import { copyText } from "@openbuddy/platform/clipboard";
import type { MarkdownHost, PathStat } from "@openbuddy/markdown/host";
import { appConfirm } from "./ui/AppDialog";

export const webMarkdownHost: MarkdownHost = {
  copyText: text => copyText(text),
  openUrl: url => invoke("open_url", { url }),
  openPath: (path, cwd) => invoke("open_path", { path, cwd: cwd ?? null }),
  revealInFolder: (path, cwd) => invoke("reveal_in_folder", { path, cwd: cwd ?? null }),
  pathStat: (path, cwd) => invoke<PathStat>("path_stat", { path, cwd: cwd ?? null }),
  readTextFile: (path, maxBytes) => invoke<string>("read_text_file", { path, maxBytes }),
  writeTextFile: (path, content, workspaceRoot) => invoke<string>("write_text_file", { path, content, workspaceRoot }),
  artifactSave: (sessionId, path, content, origin) => artifactSave(sessionId, path, content, origin),
  exportTextFile: (path, content) => invoke<string>("export_text_file", { path, content }),
  saveDialog: options => save(options),
  askDialog: (message, options) => ask(message, options),
  confirm: options => appConfirm(options),
};
