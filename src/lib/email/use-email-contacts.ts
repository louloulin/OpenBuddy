/**
 * useEmailContacts — React hook 返回近期联系人列表。
 *
 * 第 5 周(P3 期间 build 修复):ComposerPortal 在导入 `useEmailContacts` 时
 * 该 hook 尚未实现 — 这里补一个最小可用版本:
 *   - 不阻塞 composer 打开(返回空数组即可,EmailComposer 可以无 contacts 渲染)。
 *   - 后续接入 `useEmailData` 或 `runtime.listThreads` 后再 populate。
 *
 * 设计为把 collectEmailContacts 的 reuse 写成内部空数组调用,这样以后接 useEmailData 时只改这个文件。
 */
import { useMemo } from "react";
import { collectEmailContacts, type EmailContact } from "./email-contacts";

export function useEmailContacts(): EmailContact[] {
  return useMemo<EmailContact[]>(() => collectEmailContacts([]), []);
}
