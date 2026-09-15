'use client';

import { useEffect } from 'react';

/**
 * HtmlLang —— 把 <html lang> 修正为当前 locale。
 *
 * 根 layout 无法读取路由参数(它不在 [locale] 段内),所以 `<html>` 上只能写死
 * `lang="en"`。中文页面上这个值是错的:屏幕阅读器会按英文发音规则读中文,
 * 搜索引擎也会误判页面语言。这里在 [locale] 段内把它改回来。
 */
export default function HtmlLang({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
