export type RemoteSchema =
  | { type: "any" | "unknown" | "string" | "number" | "integer" | "boolean" | "null" | "undefined" }
  | { type: "literal"; value: string | number | boolean | null }
  | { type: "array"; items: RemoteSchema }
  | { type: "object"; properties: Record<string, { schema: RemoteSchema; optional?: boolean }>; additionalProperties?: boolean; additionalPropertiesSchema?: RemoteSchema }
  | { type: "tuple"; items: readonly RemoteSchema[]; rest?: RemoteSchema }
  | { type: "intersection"; allOf: readonly RemoteSchema[] }
  | { type: "union"; anyOf: readonly RemoteSchema[] };

export type RemoteCodec =
  | { mode: "src-json" }
  | { mode: "strict"; typeSymbol: string; schema: RemoteSchema };

export class RemoteCodecError extends Error {
  readonly path: string;

  constructor(message: string, path = "value") {
    super(`${path}: ${message}`);
    this.name = "RemoteCodecError";
    this.path = path;
  }
}

function schemaError(message: string): never {
  throw new Error(`invalid Remote schema: ${message}`);
}

export function validateRemoteSchema(value: unknown, path = "schema"): RemoteSchema {
  if (!value || typeof value !== "object" || Array.isArray(value)) schemaError(`${path} must be an object`);
  const schema = value as Record<string, unknown>;
  const type = schema.type;
  if (typeof type !== "string") schemaError(`${path}.type must be a string`);
  if (["any", "unknown", "string", "number", "integer", "boolean", "null", "undefined"].includes(type)) {
    return { type: type as RemoteSchema["type"] & string } as RemoteSchema;
  }
  if (type === "literal") {
    const literal = schema.value;
    if (literal !== null && typeof literal !== "string" && typeof literal !== "number" && typeof literal !== "boolean") {
      schemaError(`${path}.value must be a JSON primitive`);
    }
    return { type, value: literal as string | number | boolean | null };
  }
  if (type === "array") {
    return { type, items: validateRemoteSchema(schema.items, `${path}.items`) };
  }
  if (type === "tuple") {
    if (!Array.isArray(schema.items) || schema.items.length > 32) schemaError(`${path}.items must contain 0-32 schemas`);
    return {
      type,
      items: schema.items.map((item, index) => validateRemoteSchema(item, `${path}.items[${index}]`)),
      ...(schema.rest === undefined ? {} : { rest: validateRemoteSchema(schema.rest, `${path}.rest`) }),
    };
  }
  if (type === "intersection") {
    if (!Array.isArray(schema.allOf) || schema.allOf.length < 2 || schema.allOf.length > 16) schemaError(`${path}.allOf must contain 2-16 schemas`);
    return { type, allOf: schema.allOf.map((item, index) => validateRemoteSchema(item, `${path}.allOf[${index}]`)) };
  }
  if (type === "union") {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0 || schema.anyOf.length > 32) schemaError(`${path}.anyOf must contain 1-32 schemas`);
    return { type, anyOf: schema.anyOf.map((item, index) => validateRemoteSchema(item, `${path}.anyOf[${index}]`)) };
  }
  if (type === "object") {
    if (!schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) schemaError(`${path}.properties must be an object`);
    const properties: Record<string, { schema: RemoteSchema; optional?: boolean }> = {};
    for (const [key, entry] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9_$.-]{1,80}$/.test(key) || !entry || typeof entry !== "object" || Array.isArray(entry)) schemaError(`${path}.properties.${key} is invalid`);
      const item = entry as Record<string, unknown>;
      if (item.optional !== undefined && typeof item.optional !== "boolean") schemaError(`${path}.properties.${key}.optional is invalid`);
      properties[key] = { schema: validateRemoteSchema(item.schema, `${path}.properties.${key}.schema`), ...(item.optional === true ? { optional: true } : {}) };
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") schemaError(`${path}.additionalProperties is invalid`);
    return {
      type,
      properties,
      ...(schema.additionalProperties === true ? { additionalProperties: true } : {}),
      ...(schema.additionalPropertiesSchema === undefined ? {} : { additionalPropertiesSchema: validateRemoteSchema(schema.additionalPropertiesSchema, `${path}.additionalPropertiesSchema`) }),
    };
  }
  schemaError(`${path}.type is unsupported`);
}

export function validateRemoteCodec(value: unknown, path = "codec"): RemoteCodec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid Remote codec: ${path}`);
  const codec = value as Record<string, unknown>;
  if (codec.mode === "src-json") return { mode: "src-json" };
  if (codec.mode !== "strict" || typeof codec.typeSymbol !== "string" || !/^[A-Za-z0-9_.:#@/-]{1,160}$/.test(codec.typeSymbol)) {
    throw new Error(`invalid Remote codec: ${path}`);
  }
  return { mode: "strict", typeSymbol: codec.typeSymbol, schema: validateRemoteSchema(codec.schema, `${path}.schema`) };
}

type RuntimeSchemaDef = { type?: unknown; [key: string]: unknown };

function runtimeSchemaDef(value: unknown, path: string): RuntimeSchemaDef {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} is not a runtime schema`);
  const internals = (value as Record<string, unknown>)._zod;
  if (!internals || typeof internals !== "object" || Array.isArray(internals)) {
    throw new Error(`${path} is not a Zod v4 schema`);
  }
  const definition = (internals as Record<string, unknown>).def;
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error(`${path} has no Zod definition`);
  return definition as RuntimeSchemaDef;
}

function runtimeSchema(value: unknown, path: string, lazyStack = new Set<object>()): RemoteSchema {
  if (value && typeof value === "object" && !Array.isArray(value) && !("_zod" in (value as Record<string, unknown>))) {
    return validateRemoteSchema(value, path);
  }
  const definition = runtimeSchemaDef(value, path);
  const type = definition.type;
  if (type === "lazy") {
    if (lazyStack.has(value as object)) return { type: "unknown" };
    const getter = definition.getter;
    if (typeof getter !== "function") throw new Error(`${path} lazy schema has no getter`);
    const nextStack = new Set(lazyStack);
    nextStack.add(value as object);
    let resolved: unknown;
    try {
      resolved = (getter as () => unknown)();
    } catch (error) {
      throw new Error(`${path} lazy schema getter failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    return runtimeSchema(resolved, `${path}.lazy`, nextStack);
  }
  if (type === "readonly") {
    return runtimeSchema(definition.innerType, `${path}.innerType`, lazyStack);
  }
  if (type === "any" || type === "unknown" || type === "string" || type === "boolean" || type === "null" || type === "undefined") {
    return { type };
  }
  if (type === "number") {
    const checks = Array.isArray(definition.checks) ? definition.checks : [];
    const safeInteger = checks.some((check) => check && typeof check === "object" && (check as Record<string, unknown>).def && ((check as Record<string, unknown>).def as Record<string, unknown>).format === "safeint");
    return { type: safeInteger ? "integer" : "number" };
  }
  if (type === "literal") {
    const values = definition.values;
    if (!Array.isArray(values) || values.length !== 1) throw new Error(`${path} literal must contain exactly one value`);
    const literal = values[0];
    if (literal !== null && typeof literal !== "string" && typeof literal !== "number" && typeof literal !== "boolean") throw new Error(`${path} literal is not JSON-safe`);
    return { type: "literal", value: literal as string | number | boolean | null };
  }
  if (type === "array") return { type: "array", items: runtimeSchema(definition.element, `${path}.element`, lazyStack) };
  if (type === "tuple") {
    const items = definition.items;
    if (!Array.isArray(items)) throw new Error(`${path} tuple has no items`);
    const rest = definition.rest;
    return { type: "tuple", items: items.map((item, index) => runtimeSchema(item, `${path}.items[${index}]`, lazyStack)), ...(rest === undefined ? {} : { rest: runtimeSchema(rest, `${path}.rest`, lazyStack) }) };
  }
  if (type === "union") {
    const options = definition.options;
    if (!Array.isArray(options)) throw new Error(`${path} union has no options`);
    return { type: "union", anyOf: options.map((option, index) => runtimeSchema(option, `${path}.options[${index}]`, lazyStack)) };
  }
  if (type === "enum") {
    const entries = definition.entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error(`${path} enum has no entries`);
    return { type: "union", anyOf: Object.values(entries as Record<string, unknown>).map((value, index) => {
      if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new Error(`${path}.entries[${index}] is not JSON-safe`);
      return { type: "literal", value: value as string | number | boolean | null };
    }) };
  }
  if (type === "optional") return { type: "union", anyOf: [runtimeSchema(definition.innerType, `${path}.innerType`, lazyStack), { type: "undefined" }] };
  if (type === "nullable") return { type: "union", anyOf: [runtimeSchema(definition.innerType, `${path}.innerType`, lazyStack), { type: "null" }] };
  if (type === "object") {
    const shape = definition.shape;
    if (!shape || typeof shape !== "object" || Array.isArray(shape)) throw new Error(`${path} object has no shape`);
    const properties: Record<string, { schema: RemoteSchema; optional?: boolean }> = {};
    for (const [key, schema] of Object.entries(shape as Record<string, unknown>)) {
      const child = runtimeSchemaDef(schema, `${path}.shape.${key}`);
      const optional = child.type === "optional";
      properties[key] = { schema: optional ? runtimeSchema((child.innerType as unknown), `${path}.shape.${key}.innerType`, lazyStack) : runtimeSchema(schema, `${path}.shape.${key}`, lazyStack), ...(optional ? { optional: true } : {}) };
    }
    return { type: "object", properties };
  }
  if (type === "record") {
    return { type: "object", properties: {}, additionalProperties: true, additionalPropertiesSchema: runtimeSchema(definition.valueType, `${path}.valueType`, lazyStack) };
  }
  if (type === "intersection") {
    const left = definition.left;
    const right = definition.right;
    if (left === undefined || right === undefined) throw new Error(`${path} intersection is incomplete`);
    return { type: "intersection", allOf: [runtimeSchema(left, `${path}.left`, lazyStack), runtimeSchema(right, `${path}.right`, lazyStack)] };
  }
  throw new Error(`${path} uses unsupported Zod type ${String(type)}`);
}

/** Convert a generated Harness Zod codec into the IPC-safe OpenBuddy AST. */
export function serializeRemoteSchema(value: unknown, path = "schema"): RemoteSchema {
  return validateRemoteSchema(runtimeSchema(value, path), path);
}

/** Normalize a generated Harness contribution without mutating its runtime object. */
export function serializeRemoteContribution(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("remote contribution must be an object");
  const contribution = value as Record<string, unknown>;
  if (!Array.isArray(contribution.descriptors)) return value;
  const descriptors = contribution.descriptors.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`descriptor[${index}] must be an object`);
    const descriptor = raw as Record<string, unknown>;
    const parameters = Array.isArray(descriptor.parameters) ? descriptor.parameters.map((parameter, parameterIndex) => {
      if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) throw new Error(`descriptor[${index}].parameters[${parameterIndex}] must be an object`);
      const item = parameter as Record<string, unknown>;
      return item.codec === undefined ? parameter : { ...item, codec: serializeRemoteCodec(item.codec, `descriptor[${index}].parameters[${parameterIndex}].codec`) };
    }) : descriptor.parameters;
    const invocation = descriptor.invocation && typeof descriptor.invocation === "object" && !Array.isArray(descriptor.invocation)
      ? ((descriptor.invocation as Record<string, unknown>).codec === undefined ? descriptor.invocation : { ...descriptor.invocation, codec: serializeRemoteCodec((descriptor.invocation as Record<string, unknown>).codec, `descriptor[${index}].invocation.codec`) })
      : descriptor.invocation;
    return {
      ...descriptor,
      ...(parameters === undefined ? {} : { parameters }),
      ...(invocation === undefined ? {} : { invocation }),
      ...(descriptor.result === undefined ? {} : { result: serializeRemoteCodec(descriptor.result, `descriptor[${index}].result`) }),
    };
  });
  return { ...contribution, descriptors };
}

export function serializeRemoteCodec(value: unknown, path = "codec"): RemoteCodec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`invalid Remote codec: ${path}`);
  const codec = value as Record<string, unknown>;
  if (codec.mode === "src-json") return { mode: "src-json" };
  if (codec.mode !== "strict" || typeof codec.typeSymbol !== "string") throw new Error(`invalid Remote codec: ${path}`);
  return { mode: "strict", typeSymbol: codec.typeSymbol, schema: serializeRemoteSchema(codec.schema, `${path}.schema`) };
}

export function parseRemoteCodec(codec: RemoteCodec | undefined, value: unknown, path = "value"): unknown {
  if (!codec || codec.mode === "src-json") return value;
  return parseSchema(codec.schema, value, path);
}

function parseSchema(schema: RemoteSchema, value: unknown, path: string): unknown {
  switch (schema.type) {
    case "any":
    case "unknown": return value;
    case "undefined": if (value === undefined) return value; break;
    case "null": if (value === null) return value; break;
    case "string": if (typeof value === "string") return value; break;
    case "number": if (typeof value === "number" && Number.isFinite(value)) return value; break;
    case "integer": if (typeof value === "number" && Number.isSafeInteger(value)) return value; break;
    case "boolean": if (typeof value === "boolean") return value; break;
    case "literal": if (Object.is(value, schema.value)) return value; break;
    case "array":
      if (Array.isArray(value)) return value.map((item, index) => parseSchema(schema.items, item, `${path}[${index}]`));
      break;
    case "tuple":
      if (Array.isArray(value)) {
        if (value.length < schema.items.length || (!schema.rest && value.length > schema.items.length)) {
          throw new RemoteCodecError("does not match tuple length", path);
        }
        return value.map((item, index) => index < schema.items.length
          ? parseSchema(schema.items[index]!, item, `${path}[${index}]`)
          : parseSchema(schema.rest!, item, `${path}[${index}]`));
      }
      break;
    case "intersection":
      return schema.allOf.reduce((current, candidate, index) => {
        parseSchema(candidate, current, `${path}&${index}`);
        return current;
      }, value);
    case "object":
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const known = new Set(Object.keys(schema.properties));
        if (schema.additionalProperties !== true) {
          const extra = Object.keys(record).find((key) => !known.has(key));
          if (extra) throw new RemoteCodecError("unexpected property", `${path}.${extra}`);
        }
        const output: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(schema.properties)) {
          if (!(key in record)) {
            if (entry.optional) continue;
            throw new RemoteCodecError("required property is missing", `${path}.${key}`);
          }
          output[key] = parseSchema(entry.schema, record[key], `${path}.${key}`);
        }
        if (schema.additionalProperties === true) {
          for (const [key, item] of Object.entries(record)) {
            if (known.has(key)) continue;
            output[key] = schema.additionalPropertiesSchema
              ? parseSchema(schema.additionalPropertiesSchema, item, `${path}.${key}`)
              : item;
          }
        }
        return output;
      }
      break;
    case "union":
      for (const candidate of schema.anyOf) {
        try { return parseSchema(candidate, value, path); } catch { /* try next branch */ }
      }
      break;
  }
  throw new RemoteCodecError(`does not match ${schema.type}`, path);
}
