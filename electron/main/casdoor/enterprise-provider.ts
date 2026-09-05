export interface EnterpriseCatalogModel {
  id: string;
  ownedBy?: string;
}

export interface EnterpriseProviderConfig {
  name: string;
  baseUrl: string;
  api: "openai-completions";
  authHeader: false;
  models: Array<{
    id: string;
    name: string;
    contextWindow: number;
    maxTokens: number;
    ownedBy?: string;
  }>;
  [key: string]: unknown;
}

export function buildEnterpriseProviderConfig(
  existing: Record<string, unknown> | undefined,
  baseUrl: string,
  catalog: EnterpriseCatalogModel[],
): EnterpriseProviderConfig {
  const { apiKey: _apiKey, key: _key, token: _token, ...safeExisting } = existing ?? {};
  const models = [];
  const seen = new Set<string>();
  for (const entry of catalog) {
    const id = entry.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: id,
      contextWindow: 128_000,
      maxTokens: 16_384,
      ...(entry.ownedBy ? { ownedBy: entry.ownedBy } : {}),
    });
  }
  return {
    ...safeExisting,
    name: "OpenBuddy Enterprise",
    baseUrl,
    api: "openai-completions",
    authHeader: false,
    models,
  };
}
