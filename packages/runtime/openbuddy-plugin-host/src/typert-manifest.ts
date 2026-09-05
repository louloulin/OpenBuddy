import { resolveExportTarget, RUNTIME_EXPORT_CONDITIONS } from "./export-target";

export interface TypertManifestEntry {
  packageName: string;
  packageJson: string;
  moduleName: string;
  moduleUrl?: string;
}

export interface DiscoverTypertManifestOptions {
  additionalPackages?: readonly string[];
  resolvePackageJson?: (specifier: string) => string | Promise<string>;
  readPackageJson?: (path: string) => Promise<Record<string, unknown>>;
  resolveModule?: (specifier: string, packageJson: string) => string | Promise<string>;
}

async function defaultResolvePackageJson(specifier: string): Promise<string> {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  try { return require.resolve(`${specifier}/package.json`); }
  catch {
    const { dirname, join } = await import("node:path");
    const resolved = require.resolve(specifier);
    let directory = dirname(resolved);
    for (let index = 0; index < 8; index += 1) {
      const candidate = join(directory, "package.json");
      try {
        await (await import("node:fs/promises")).access(candidate);
        return candidate;
      } catch {
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    throw new Error(`typert-manifest: cannot locate package.json for ${specifier}`);
  }
}

async function defaultReadPackageJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as Record<string, unknown>;
}

function hasTypertExport(pkg: Record<string, unknown>): boolean {
  const exportsField = pkg.exports;
  return Boolean(exportsField && typeof exportsField === "object" && !Array.isArray(exportsField)
    && resolveExportTarget(
      (exportsField as Record<string, unknown>)["./typert"],
      RUNTIME_EXPORT_CONDITIONS.node,
    ));
}

export async function discoverTypertManifestEntries(
  options: DiscoverTypertManifestOptions = {},
): Promise<TypertManifestEntry[]> {
  const resolvePackageJson = options.resolvePackageJson ?? defaultResolvePackageJson;
  const readPackageJson = options.readPackageJson ?? defaultReadPackageJson;
  const result: TypertManifestEntry[] = [];
  const seen = new Set<string>();
  for (const packageName of options.additionalPackages ?? []) {
    if (!packageName || seen.has(packageName)) continue;
    seen.add(packageName);
    let packageJson: string;
    try { packageJson = await resolvePackageJson(packageName); } catch { continue; }
    const manifest = await readPackageJson(packageJson);
    if (!hasTypertExport(manifest)) continue;
    const moduleName = `${packageName}/typert`;
    const moduleUrl = options.resolveModule ? await options.resolveModule(moduleName, packageJson) : undefined;
    result.push({ packageName, packageJson, moduleName, ...(moduleUrl ? { moduleUrl } : {}) });
  }
  return result;
}

export interface TypertHostSchemaRecord {
  name: string;
  schema: object;
}

export interface TypertHostContribution {
  package: string;
  face: "host";
  schemas: TypertHostSchemaRecord[];
  invocations: unknown[];
  model: Record<string, unknown>;
}

function requireObject(packageName: string, value: unknown, subject: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`typert-manifest: ${packageName} ${subject} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(packageName: string, value: Record<string, unknown>, key: string, subject: string): string {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    throw new Error(`typert-manifest: ${packageName} ${subject} has a missing or empty ${key}`);
  }
  return value[key] as string;
}

function requireStrictCodec(packageName: string, value: unknown, subject: string): void {
  const codec = requireObject(packageName, value, subject);
  if (codec.mode !== "strict") throw new Error(`typert-manifest: ${packageName} ${subject} must use a strict codec`);
  requireString(packageName, codec, "typeSymbol", subject);
  const schema = codec.schema as { _zod?: unknown; parse?: unknown } | undefined;
  if (!schema || typeof schema !== "object" || !("_zod" in schema) || typeof schema.parse !== "function") {
    throw new Error(`typert-manifest: ${packageName} ${subject} is not backed by a zod v4 schema`);
  }
}

function requireArray(packageName: string, value: unknown, subject: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`typert-manifest: ${packageName} ${subject} must be an array`);
  return value;
}

function validateDocumentation(packageName: string, value: Record<string, unknown>, subject: string): void {
  requireArray(packageName, value.tags, `${subject}.tags`);
  for (const key of ["description", "summary", "jsDoc"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") throw new Error(`typert-manifest: ${packageName} ${subject}.${key} must be a string`);
  }
}

function validateModelMembers(packageName: string, value: unknown, subject: string): void {
  for (const item of requireArray(packageName, value, `${subject}.members`)) {
    const member = requireObject(packageName, item, `${subject} member`);
    requireString(packageName, member, "name", `${subject} member`);
    requireString(packageName, member, "signature", `${subject} member`);
    if (!["property", "method", "getter", "setter", "call", "construct", "index"].includes(String(member.kind))) {
      throw new Error(`typert-manifest: ${packageName} ${subject} member has invalid kind`);
    }
  }
}

function validateModelTypes(packageName: string, value: unknown, subject: string): void {
  for (const item of requireArray(packageName, value, `${subject}.types`)) {
    const type = requireObject(packageName, item, `${subject} type`);
    requireString(packageName, type, "name", `${subject} type`);
    requireString(packageName, type, "declaration", `${subject} type`);
  }
}

function validateModel(packageName: string, value: unknown): Record<string, unknown> {
  const model = requireObject(packageName, value, "TYPERT.model");
  for (const item of requireArray(packageName, model.services, "TYPERT.model.services")) {
    const service = requireObject(packageName, item, "service");
    validateDocumentation(packageName, service, "service");
    requireString(packageName, service, "key", "service");
    requireString(packageName, service, "exportName", "service");
    validateModelMembers(packageName, service.members, `service "${service.key as string}"`);
    validateModelTypes(packageName, service.types, `service "${service.key as string}"`);
  }
  for (const item of requireArray(packageName, model.events, "TYPERT.model.events")) {
    const event = requireObject(packageName, item, "event");
    validateDocumentation(packageName, event, "event");
    requireString(packageName, event, "name", "event");
    requireString(packageName, event, "signature", `event "${event.name as string}"`);
    if (event.mode !== undefined && typeof event.mode !== "string") throw new Error(`typert-manifest: ${packageName} event mode must be a string`);
  }
  for (const item of requireArray(packageName, model.objects, "TYPERT.model.objects")) {
    const object = requireObject(packageName, item, "object");
    validateDocumentation(packageName, object, "object");
    requireString(packageName, object, "name", "object");
    requireString(packageName, object, "exportName", "object");
    validateModelMembers(packageName, object.members, `object "${object.name as string}"`);
    validateModelTypes(packageName, object.types, `object "${object.name as string}"`);
  }
  return model;
}

function validateInvocation(packageName: string, value: unknown, index: number): { id: string; namespace: string; method: string } {
  const invocation = requireObject(packageName, value, `invocation[${index}]`);
  const id = requireString(packageName, invocation, "id", `invocation[${index}]`);
  const namespace = requireString(packageName, invocation, "namespace", `invocation "${id}"`);
  const method = requireString(packageName, invocation, "method", `invocation "${id}"`);
  requireString(packageName, invocation, "service", `invocation "${id}"`);
  const receiver = requireObject(packageName, invocation.invocation, `invocation "${id}" receiver`);
  if (receiver.kind === "context") {
    requireString(packageName, receiver, "context", `invocation "${id}" Context receiver`);
    requireString(packageName, receiver, "wire", `invocation "${id}" Context receiver`);
    requireStrictCodec(packageName, receiver.codec, `invocation "${id}" Context codec`);
  } else if (receiver.kind !== "direct") {
    throw new Error(`typert-manifest: ${packageName} invocation "${id}" receiver kind must be "direct" or "context"`);
  }
  const wires = new Set<string>();
  const lookups = new Map<string, string>();
  if (!Array.isArray(invocation.parameters)) throw new Error(`typert-manifest: ${packageName} invocation "${id}" parameters must be an array`);
  for (const [parameterIndex, valueParameter] of invocation.parameters.entries()) {
    const parameter = requireObject(packageName, valueParameter, `invocation "${id}" parameter[${parameterIndex}]`);
    requireString(packageName, parameter, "name", `invocation "${id}" parameter`);
    const wire = requireString(packageName, parameter, "wire", `invocation "${id}" parameter`);
    if (wires.has(wire)) throw new Error(`typert-manifest: ${packageName} invocation "${id}" repeats wire field "${wire}"`);
    wires.add(wire);
    if (parameter.source === "lookup") {
      const lookup = requireString(packageName, parameter, "lookup", `invocation "${id}" lookup parameter`);
      if (parameter.acceptsUndefined === true) throw new Error(`typert-manifest: ${packageName} invocation "${id}" lookup parameters cannot be optional`);
      lookups.set(wire, lookup);
    } else if (parameter.source !== "json") {
      throw new Error(`typert-manifest: ${packageName} invocation "${id}" parameter source must be "json" or "lookup"`);
    } else if (parameter.lookup !== undefined) {
      throw new Error(`typert-manifest: ${packageName} invocation "${id}" JSON parameter declares a lookup`);
    }
    if (parameter.acceptsUndefined !== undefined && typeof parameter.acceptsUndefined !== "boolean") {
      throw new Error(`typert-manifest: ${packageName} invocation "${id}" parameter acceptsUndefined must be a boolean`);
    }
    requireStrictCodec(packageName, parameter.codec, `invocation "${id}" parameter codec`);
  }
  if (invocation.cancellation !== undefined) {
    const cancellation = requireObject(packageName, invocation.cancellation, `invocation "${id}" cancellation`);
    if (cancellation.parameter !== "signal") throw new Error(`typert-manifest: ${packageName} invocation "${id}" cancellation parameter must be "signal"`);
  }
  if (invocation.scope !== undefined) {
    if (receiver.kind !== "direct") throw new Error(`typert-manifest: ${packageName} invocation "${id}" Context receiver cannot declare a direct scope projection`);
    const scope = requireObject(packageName, invocation.scope, `invocation "${id}" scope`);
    const context = requireString(packageName, scope, "context", `invocation "${id}" scope`);
    const wire = requireString(packageName, scope, "wire", `invocation "${id}" scope`);
    if (lookups.size !== 1 || lookups.get(wire) !== context) {
      throw new Error(`typert-manifest: ${packageName} invocation "${id}" scope wire "${wire}" must select its only lookup parameter`);
    }
  }
  if (receiver.kind === "context" && wires.has(receiver.wire as string)) {
    throw new Error(`typert-manifest: ${packageName} invocation "${id}" repeats Context wire field "${receiver.wire as string}"`);
  }
  requireStrictCodec(packageName, invocation.result, `invocation "${id}" result codec`);
  if (invocation.sourceLocation !== undefined) {
    const location = requireObject(packageName, invocation.sourceLocation, `invocation "${id}" sourceLocation`);
    requireString(packageName, location, "file", `invocation "${id}" sourceLocation`);
    for (const key of ["line", "column"]) {
      if (!Number.isInteger(location[key]) || (location[key] as number) < 1) {
        throw new Error(`typert-manifest: ${packageName} invocation "${id}" sourceLocation.${key} must be a positive integer`);
      }
    }
  }
  return { id, namespace, method };
}

export function validateTypertHostContribution(packageName: string, value: unknown): TypertHostContribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`typert-manifest: ${packageName} TYPERT must be an object`);
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.package !== packageName) throw new Error(`typert-manifest: ${packageName} TYPERT.package is invalid`);
  if (manifest.face !== "host") throw new Error(`typert-manifest: ${packageName} TYPERT.face must be \"host\"`);
  if (!Array.isArray(manifest.schemas)) throw new Error(`typert-manifest: ${packageName} TYPERT.schemas must be an array`);
  const schemas = manifest.schemas.map((schema, index) => {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`typert-manifest: ${packageName} schema[${index}] is invalid`);
    const item = schema as Record<string, unknown>;
    const name = requireString(packageName, item, "name", `schema[${index}]`);
    const schemaValue = item.schema as { _zod?: unknown; parse?: unknown } | undefined;
    if (!schemaValue || typeof schemaValue !== "object" || !("_zod" in schemaValue) || typeof schemaValue.parse !== "function") {
      throw new Error(`typert-manifest: ${packageName} schema[${index}] is not backed by a zod v4 schema`);
    }
    return { name, schema: schemaValue as object };
  });
  const schemaNames = new Set<string>();
  for (const schema of schemas) {
    if (schemaNames.has(schema.name)) throw new Error(`typert-manifest: ${packageName} schema is duplicated: ${schema.name}`);
    schemaNames.add(schema.name);
  }
  if (!Array.isArray(manifest.invocations)) throw new Error(`typert-manifest: ${packageName} TYPERT.invocations must be an array`);
  const invocationIds = new Set<string>();
  const invocationEndpoints = new Set<string>();
  const invocations = manifest.invocations.map((invocation, index) => {
    const descriptor = validateInvocation(packageName, invocation, index);
    if (invocationIds.has(descriptor.id)) throw new Error(`typert-manifest: ${packageName} invocation id is duplicated: ${descriptor.id}`);
    invocationIds.add(descriptor.id);
    const endpoint = `${descriptor.namespace}/${descriptor.method}`;
    if (invocationEndpoints.has(endpoint)) throw new Error(`typert-manifest: ${packageName} invocation endpoint is duplicated: ${endpoint}`);
    invocationEndpoints.add(endpoint);
    return invocation;
  });
  const model = validateModel(packageName, manifest.model);
  return {
    package: packageName,
    face: "host",
    schemas,
    invocations,
    model,
  };
}
