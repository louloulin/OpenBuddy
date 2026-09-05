export type TypertCatalogSchemaSource = {
  package: string;
  face: "host";
  key: string;
  name: string;
};

export type TypertCatalogPackageSource = {
  package: string;
  face: "host";
  key: string;
  model: Record<string, unknown>;
  invocations: readonly unknown[];
};

export type TypertCatalogRegistry = {
  listPackages: (filter?: { face?: "host" }) => readonly TypertCatalogPackageSource[];
  list: (filter?: { face?: "host" }) => readonly TypertCatalogSchemaSource[];
  toJSONSchema: (key: string) => unknown;
};

export type TypertCatalogResponse = {
  packages: readonly {
    package: string;
    face: "host";
    key: string;
    model: Record<string, unknown>;
    invocations: readonly unknown[];
    schemas: readonly {
      key: string;
      name: string;
      schema?: Record<string, unknown>;
    }[];
  }[];
  diagnostics: readonly {
    package: string;
    key: string;
    message: string;
  }[];
};

function jsonValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, seen)).filter((entry) => entry !== undefined);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = jsonValue(entry, seen);
    if (normalized !== undefined) result[key] = normalized;
  }
  seen.delete(value);
  return result;
}

function jsonObject(value: unknown): Record<string, unknown> {
  const normalized = jsonValue(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeTypertCatalog(registry: TypertCatalogRegistry): TypertCatalogResponse {
  const schemasByPackage = new Map<string, TypertCatalogSchemaSource[]>();
  for (const schema of registry.list({ face: "host" })) {
    const entries = schemasByPackage.get(schema.package) ?? [];
    entries.push(schema);
    schemasByPackage.set(schema.package, entries);
  }
  const diagnostics: Array<{ package: string; key: string; message: string }> = [];
  const packages = registry.listPackages({ face: "host" }).map((entry) => ({
    package: entry.package,
    face: "host" as const,
    key: entry.key,
    model: jsonObject(entry.model),
    invocations: (jsonValue(entry.invocations) as unknown[] | undefined) ?? [],
    schemas: (schemasByPackage.get(entry.package) ?? []).map((schema) => {
      try {
        return { key: schema.key, name: schema.name, schema: jsonObject(registry.toJSONSchema(schema.key)) };
      } catch (error) {
        diagnostics.push({ package: schema.package, key: schema.key, message: errorMessage(error) });
        return { key: schema.key, name: schema.name };
      }
    }),
  }));
  return { packages, diagnostics };
}
