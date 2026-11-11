
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /macintosh|mac os x/i.test(navigator.userAgent);
}

/** 模块级常量:运行期平台不会变化,避免重复解析。 */
export const IS_MACOS = isMacOS();
