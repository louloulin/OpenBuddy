// 更新检查 (A3): fetch the release manifest; never installs silently.
import { invoke } from "../ipc";

export type UpdateChannel = "stable" | "beta";

export interface UpdateResult {
  status: "available" | "up-to-date";
  currentVersion: string;
  version: string;
  channel: UpdateChannel;
  notes?: string;
  publishedAt?: string;
  download: { url: string; sha256?: string; size?: number };
}

export const updateCheck = (input: { feedUrl?: string; channel?: UpdateChannel } = {}) =>
  invoke<UpdateResult>("update_check", input);

export interface UpdateDownloadResult {
  path: string;
  bytes: number;
  sha256: string;
}

/** Download + verify the installer into the app's own directory; the user still runs it. */
export const updateDownload = (download: { url: string; sha256?: string; size?: number }) =>
  invoke<UpdateDownloadResult>("update_download", {
    url: download.url,
    ...(download.sha256 ? { sha256: download.sha256 } : {}),
    ...(download.size !== undefined ? { size: download.size } : {}),
  });
