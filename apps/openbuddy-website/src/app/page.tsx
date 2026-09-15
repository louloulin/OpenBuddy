import { redirect } from 'next/navigation';

/**
 * `/` —— middleware 通常会基于 Accept-Language 把 `/` 重定向到 `/en` 或 `/zh-CN`。
 * 这个页面是 middleware 被绕过时的兜底,确保用户永远看到新的 5-section Home。
 */
export default function RootPage() {
  redirect('/en');
}