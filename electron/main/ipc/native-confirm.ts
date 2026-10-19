/**
 * native-confirm.ts — 渲染进程发起的高危写操作的原生确认(P0.2,生产评审
 * B3/B4,2026-10-11)。
 *
 * 威胁模型:渲染进程一旦被注入(XSS / 恶意插件 UI),一发 IPC 就能改企业
 * 鉴权配置(fail-open)或安装任意代码包。本模块把这类操作的确认放到
 * **原生对话框** —— 用户看得到具体改动内容,渲染进程无法绕过、无法伪造
 * 点击(与 folder-trust 对话框同一信任级别)。
 */
import { dialog, type BrowserWindow } from "electron";

export async function confirmDangerousAction(options: {
  window: BrowserWindow | null | undefined;
  title: string;
  message: string;
  detail?: string;
  /** 确认按钮文案(默认「允许」);取消按钮恒为「拒绝」且是默认项。 */
  confirmLabel?: string;
}): Promise<void> {
  const boxOptions = {
    type: "warning" as const,
    buttons: [options.confirmLabel ?? "允许", "拒绝"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: options.title,
    message: options.message,
    detail: options.detail,
  };
  const { response } = options.window && !options.window.isDestroyed()
    ? await dialog.showMessageBox(options.window, boxOptions)
    : await dialog.showMessageBox(boxOptions);
  if (response !== 0) {
    throw new Error(`${options.title}: 用户拒绝了该操作`);
  }
}
