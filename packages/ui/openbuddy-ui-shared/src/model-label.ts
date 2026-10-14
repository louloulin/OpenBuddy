/**
 * 模型显示短名(AI chat UI 审计 A5,2026-10-14)。
 *
 * pi 的 modelId 形如 `<provider>/<model>`;内部自定义 provider 前缀
 * (`custom_anthropic` / `custom_openai` / …)是接线细节,对用户毫无意义,
 * UI 一律剥掉只显示模型名。此前「已切换到 custom_anthropic/glm-5.3-flash」
 * 分隔符、meta chip 的截断 id、composer 模型 chip 都因此漏过。
 */
export function shortModelLabel(modelId: string | undefined | null): string {
  if (!modelId) return "";
  let parts = modelId.split("/");
  while (parts.length > 1 && /^custom[-_]/i.test(parts[0])) parts = parts.slice(1);
  // 一段不切,两段也不切:保留 `sub-provider/model` 这种语义上有用的二级路径。
  // 三段及以上只保留末两段。
  if (parts.length <= 2) return parts.join("/");
  return parts.slice(-2).join("/");
}
