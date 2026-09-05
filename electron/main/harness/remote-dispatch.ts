type ServiceContext = {
	get?: (name: string) => unknown;
};

import { parseRemoteCodec, validateRemoteCodec, type RemoteCodec } from "@openbuddy/plugin-host";

type LookupProvider = {
	resolve: (value: unknown) => unknown | Promise<unknown>;
};

type HostContextProvider = {
	wire?: string;
	resolve: (value: unknown) => ServiceContext | undefined | Promise<ServiceContext | undefined>;
};

type RemoteDiscovery = (context: ServiceContext) => readonly RemoteContribution[];

export type RemoteInvocation =
	| { kind: "direct" }
	| { kind: "context"; context: string; wire?: string; codec?: RemoteCodec };

export type RemoteErrorCode =
	| "arguments-invalid"
	| "context-unavailable"
	| "context-not-found"
	| "context-failed"
	| "invocation-unavailable"
	| "method-unavailable"
	| "package-invalid"
	| "remote-invalid"
	| "service-unavailable"
	| "lookup-unavailable"
	| "lookup-not-found"
	| "endpoint-not-registered"
	| "cancelled";

export class RemoteDispatchError extends Error {
	readonly code: RemoteErrorCode;
	readonly endpoint?: string;
	readonly field?: string;

	constructor(code: RemoteErrorCode, message: string, options: { endpoint?: string; field?: string; cause?: unknown } = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "RemoteDispatchError";
		this.code = code;
		this.endpoint = options.endpoint;
		this.field = options.field;
	}
}

export type RemoteDescriptor = {
	id?: string;
	service?: string;
	namespace: string;
	method: string;
	implementation?: string;
	invocation?: RemoteInvocation;
	parameters?: Array<{ name?: string; wire?: string; source?: "json" | "lookup"; lookup?: string; optional?: boolean; acceptsUndefined?: boolean; codec?: RemoteCodec }>;
	result?: RemoteCodec;
	cancellation?: boolean | { parameter: "signal" };
};

export type RemoteContribution = {
	package: string;
	descriptors: RemoteDescriptor[];
};

type RemoteRegistration = {
	package: string;
	endpoints: Map<string, RemoteBinding>;
};

type RemoteBinding = {
	package: string;
	descriptor: RemoteDescriptor;
	namespace: string;
	method: string;
	service: string;
	implementation: string;
	parameters: Array<{ name: string; wire: string; source: "json" | "lookup"; lookup?: string; optional: boolean; codec?: RemoteCodec }>;
	invocation: RemoteInvocation;
	result?: RemoteCodec;
	cancellation: boolean;
	receiver?: object | Function;
};

const packagePattern = /^[A-Za-z0-9@_./-]{1,160}$/;
const namespacePattern = /^[A-Za-z0-9_.-]{1,80}$/;
const methodPattern = /^[A-Za-z0-9_$.-]{1,80}$/;
const forbiddenMethods = new Set([
	"__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
	"__proto__", "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
	"prototype", "toLocaleString", "toString", "valueOf",
]);

function endpointOf(namespace: string, method: string): string {
	return `${namespace}/${method}`;
}

function serviceMethod(service: object | Function, method: string): Function | undefined {
	const own = Object.getOwnPropertyDescriptor(service, method);
	if (own) return typeof own.value === "function" ? own.value : undefined;
	for (let current: object | null = service; current && current !== Object.prototype; current = Object.getPrototypeOf(current) as object | null) {
		const descriptor = Object.getOwnPropertyDescriptor(current, method);
		if (descriptor) return typeof descriptor.value === "function" ? descriptor.value : undefined;
	}
	return undefined;
}

function invalid(code: RemoteErrorCode, message: string, endpoint?: string, field?: string): RemoteDispatchError {
	return new RemoteDispatchError(code, message, { endpoint, field });
}

function isSignalCancellation(value: unknown): value is { parameter: "signal" } {
	return Boolean(value && typeof value === "object" && (value as { parameter?: unknown }).parameter === "signal");
}

function decodeBoundary(codec: RemoteCodec | undefined, value: unknown, endpoint: string, field: string): unknown {
	try {
		return parseRemoteCodec(codec, value, `${endpoint}.${field}`);
	} catch (error) {
		throw new RemoteDispatchError("remote-invalid", `DeepSeek remote ${field} does not match its codec`, { endpoint, field, cause: error });
	}
}

function validateInvocation(value: unknown, index: number): RemoteInvocation {
	if (value === undefined) return { kind: "direct" };
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].invocation is invalid`);
	}
	const invocation = value as Record<string, unknown>;
	if (invocation.kind !== "direct" && invocation.kind !== "context") {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].invocation is invalid`);
	}
	if (invocation.kind === "direct") return { kind: "direct" };
	if (typeof invocation.context !== "string" || !namespacePattern.test(invocation.context)) {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].invocation.context is invalid`);
	}
	if (invocation.wire !== undefined && (typeof invocation.wire !== "string" || !methodPattern.test(invocation.wire))) {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].invocation.wire is invalid`);
	}
	return {
		kind: "context",
		context: invocation.context,
		...(typeof invocation.wire === "string" ? { wire: invocation.wire } : {}),
		...(invocation.codec === undefined ? {} : { codec: validateRemoteCodec(invocation.codec, `descriptor[${index}].invocation.codec`) }),
	};
}

function validateDescriptor(descriptor: unknown, index: number): RemoteDescriptor {
	if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}] must be an object`);
	}
	const value = descriptor as Record<string, unknown>;
	const namespace = value.namespace;
	const method = value.method;
	if (typeof namespace !== "string" || !namespacePattern.test(namespace)) {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].namespace is invalid`);
	}
	if (typeof method !== "string" || !methodPattern.test(method) || forbiddenMethods.has(method)) {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].method is invalid`);
	}
	const service = value.service;
	if (service !== undefined && (typeof service !== "string" || !namespacePattern.test(service))) {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].service is invalid`);
	}
	const implementation = value.implementation;
	if (implementation !== undefined && (typeof implementation !== "string" || !methodPattern.test(implementation) || forbiddenMethods.has(implementation))) {
		throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].implementation is invalid`);
	}
	let invocation: RemoteInvocation;
	try {
		invocation = validateInvocation(value.invocation, index);
	} catch (error) {
		if (error instanceof RemoteDispatchError) throw error;
		throw invalid("remote-invalid", error instanceof Error ? error.message : String(error));
	}
	const parameters = value.parameters === undefined ? undefined : value.parameters;
	if (parameters !== undefined) {
		if (!Array.isArray(parameters) || parameters.length > 32) throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters is invalid`);
		for (const [parameterIndex, parameter] of parameters.entries()) {
			if (!parameter || typeof parameter !== "object") throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}] is invalid`);
			const item = parameter as Record<string, unknown>;
			const name = typeof item.wire === "string" ? item.wire : item.name;
			if (typeof name !== "string" || !/^[A-Za-z0-9_$.-]{1,80}$/.test(name)) {
				throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}] is invalid`);
			}
			if (item.source !== undefined && item.source !== "json" && item.source !== "lookup") throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}].source is invalid`);
			if (item.lookup !== undefined && (typeof item.lookup !== "string" || !namespacePattern.test(item.lookup))) throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}].lookup is invalid`);
			if (item.source === "lookup" && typeof item.lookup !== "string") throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}].lookup is required`);
			if (item.source === "json" && item.lookup !== undefined) throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}].lookup is only valid for lookup parameters`);
				if (item.optional !== undefined && typeof item.optional !== "boolean") throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}].optional is invalid`);
				if (item.acceptsUndefined !== undefined && typeof item.acceptsUndefined !== "boolean") throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}].acceptsUndefined is invalid`);
				if (item.source === "lookup" && (item.optional === true || item.acceptsUndefined === true)) throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].parameters[${parameterIndex}] lookup parameters cannot be optional`);
			if (item.codec !== undefined) {
				try { validateRemoteCodec(item.codec, `descriptor[${index}].parameters[${parameterIndex}].codec`); }
				catch (error) { throw invalid("remote-invalid", error instanceof Error ? error.message : String(error)); }
			}
		}
	}
	if (value.cancellation !== undefined) {
		if (typeof value.cancellation === "boolean") {
			// Legacy OpenBuddy wire shape.
		} else if (!isSignalCancellation(value.cancellation)) {
			throw invalid("remote-invalid", `DeepSeek remote descriptor[${index}].cancellation is invalid`);
		}
	}
	return {
		...(typeof value.id === "string" ? { id: value.id } : {}),
		namespace,
		method,
		...(service === undefined ? {} : { service }),
		...(implementation === undefined ? {} : { implementation }),
		...(parameters === undefined ? {} : { parameters: parameters as RemoteDescriptor["parameters"] }),
		...(value.result === undefined ? {} : {
			result: (() => {
				try { return validateRemoteCodec(value.result, `descriptor[${index}].result`); }
				catch (error) { throw invalid("remote-invalid", error instanceof Error ? error.message : String(error)); }
			})(),
		}),
		invocation,
		...(value.cancellation === true || isSignalCancellation(value.cancellation) ? { cancellation: value.cancellation } : {}),
	};
}

export class RemoteDispatcher {
	private readonly registrations = new Map<string, RemoteRegistration>();
	private readonly discoverServices?: RemoteDiscovery;

	constructor(discoverServices?: RemoteDiscovery) {
		this.discoverServices = discoverServices;
	}

	private discover(context: ServiceContext | null): void {
		if (!context || !this.discoverServices) return;
		for (const contribution of this.discoverServices(context)) {
			if (this.registrations.has(contribution.package)) continue;
			try {
				this.register(contribution, context);
			} catch (error) {
				if (!(error instanceof RemoteDispatchError) || error.code !== "remote-invalid" || !String(error.message).includes("already registered")) throw error;
			}
		}
	}

	register(contribution: unknown, context: ServiceContext | null): { package: string; count: number } {
		if (!contribution || typeof contribution !== "object" || Array.isArray(contribution)) {
			throw invalid("remote-invalid", "DeepSeek remote contribution must be an object");
		}
		const value = contribution as Record<string, unknown>;
		const packageName = value.package;
		if (typeof packageName !== "string" || !packagePattern.test(packageName)) {
			throw invalid("package-invalid", "DeepSeek remote package is invalid");
		}
		if (!Array.isArray(value.descriptors) || value.descriptors.length === 0 || value.descriptors.length > 256) {
			throw invalid("remote-invalid", "DeepSeek remote descriptors must contain 1-256 entries");
		}
		const descriptors = value.descriptors.map(validateDescriptor);
		const endpoints = new Map<string, RemoteBinding>();
		for (const descriptor of descriptors) {
			const endpoint = endpointOf(descriptor.namespace, descriptor.method);
			if (endpoints.has(endpoint)) throw invalid("remote-invalid", `DeepSeek remote endpoint is duplicated: ${endpoint}`, endpoint);
			const service = descriptor.service ?? descriptor.namespace;
			const implementation = descriptor.implementation ?? descriptor.method;
			const invocation = descriptor.invocation ?? { kind: "direct" as const };
			const receiverContext: ServiceContext | null = invocation.kind === "context"
				? (context?.get?.(invocation.context) as ServiceContext | undefined) ?? null
				: context;
			const hostContext = invocation.kind === "context" ? this.hostContext(context, invocation.context) : undefined;
			if (hostContext && invocation.kind === "context" && invocation.wire === undefined && hostContext.wire === undefined) {
				throw invalid("remote-invalid", `DeepSeek remote context wire is required: ${invocation.context}`, endpoint);
			}
			if (hostContext && invocation.kind === "context" && invocation.wire && hostContext.wire && invocation.wire !== hostContext.wire) {
				throw invalid("remote-invalid", `DeepSeek remote context wire does not match provider: ${invocation.context}`, endpoint, invocation.wire);
			}
			const normalizedInvocation = invocation.kind === "context" && invocation.wire === undefined && hostContext?.wire
				? { ...invocation, wire: hostContext.wire }
				: invocation;
			const receiver = receiverContext?.get?.(service);
			if (!receiver && !hostContext) {
				throw invalid("service-unavailable", `DeepSeek remote service is unavailable: ${service}`, endpoint);
			}
			if (receiver && !serviceMethod(receiver, implementation)) {
				throw invalid("method-unavailable", `DeepSeek remote method is unavailable: ${service}/${implementation}`, endpoint);
			}
			endpoints.set(endpoint, {
				package: packageName,
				descriptor,
				namespace: descriptor.namespace,
				method: descriptor.method,
				service,
				implementation,
			parameters: (descriptor.parameters ?? []).map((parameter) => ({
				name: parameter.name ?? parameter.wire!,
				wire: parameter.wire ?? parameter.name!,
				source: parameter.source ?? "json",
				...(parameter.lookup ? { lookup: parameter.lookup } : {}),
				optional: parameter.optional === true || parameter.acceptsUndefined === true,
					...(parameter.codec === undefined ? {} : { codec: parameter.codec }),
				})),
				invocation: normalizedInvocation,
				...(descriptor.result === undefined ? {} : { result: descriptor.result }),
			cancellation: descriptor.cancellation === true || (typeof descriptor.cancellation === "object" && descriptor.cancellation.parameter === "signal"),
				...(receiver ? { receiver } : {}),
			});
		}
		const previous = this.registrations.get(packageName);
		if (previous) {
			const same = previous.endpoints.size === endpoints.size
				&& [...endpoints].every(([endpoint, binding]) => {
					const previousBinding = previous.endpoints.get(endpoint);
					if (!previousBinding) return false;
					const { receiver: _previousReceiver, ...previousShape } = previousBinding;
					const { receiver: _receiver, ...shape } = binding;
					return JSON.stringify(previousShape) === JSON.stringify(shape);
				});
			if (same) return { package: packageName, count: endpoints.size };
		}
		for (const [registeredPackage, registration] of this.registrations) {
			if (registeredPackage === packageName) continue;
			for (const endpoint of endpoints.keys()) {
				if (registration.endpoints.has(endpoint)) {
					throw invalid("remote-invalid", `DeepSeek remote endpoint is already registered: ${endpoint}`, endpoint);
				}
			}
		}
		this.registrations.set(packageName, { package: packageName, endpoints });
		return { package: packageName, count: endpoints.size };
	}

	private hostContext(context: ServiceContext | null, key: string): HostContextProvider | undefined {
		const typert = context?.get?.("typert") as { contexts?: { getHost?: (name: string) => HostContextProvider | undefined } } | undefined;
		const provider = typert?.contexts?.getHost?.(key);
		return provider && typeof provider.resolve === "function" ? provider : undefined;
	}

	unregister(packageName: unknown): { package: string; removed: boolean } {
		if (typeof packageName !== "string" || !packagePattern.test(packageName)) {
			throw invalid("package-invalid", "DeepSeek remote package is invalid");
		}
		return { package: packageName, removed: this.registrations.delete(packageName) };
	}

	clear(): void {
		this.registrations.clear();
	}

	list(): string[] {
		return [...new Set([...this.registrations.values()].flatMap((registration) => [...registration.endpoints.keys()]))];
	}

	describe(endpoint: string): (RemoteDescriptor & { package: string }) | undefined {
		for (const registration of this.registrations.values()) {
			const binding = registration.endpoints.get(endpoint);
			if (binding) return { ...binding.descriptor, package: binding.package };
		}
		return undefined;
	}

	describeAll(): Array<RemoteDescriptor & { package: string }> {
		return [...this.registrations.values()].flatMap((registration) => [...registration.endpoints.values()].map((binding) => ({
			...binding.descriptor,
			package: binding.package,
		})));
	}

	async invoke(input: unknown, context: ServiceContext | null): Promise<unknown> {
		this.discover(context);
		if (!input || typeof input !== "object" || Array.isArray(input)) {
			throw invalid("remote-invalid", "DeepSeek remote payload must be an object");
		}
		const value = input as Record<string, unknown>;
		const packageName = value.package;
		const namespace = value.namespace;
		const method = value.method;
		if (packageName !== undefined && typeof packageName !== "string") {
			throw invalid("package-invalid", "DeepSeek remote package must be a string");
		}
		if (typeof namespace !== "string" || typeof method !== "string") {
			throw invalid("remote-invalid", "DeepSeek remote namespace and method are required");
		}
		if (!namespacePattern.test(namespace) || !methodPattern.test(method) || forbiddenMethods.has(method)) {
			throw invalid("remote-invalid", "DeepSeek remote namespace or method is invalid", endpointOf(String(namespace), String(method)));
		}
		const endpoint = endpointOf(namespace, method);
		const owner = [...this.registrations.values()].find((registration) => registration.endpoints.has(endpoint));
		if (!owner || (packageName !== undefined && owner.package !== packageName)) {
			throw invalid("endpoint-not-registered", `DeepSeek remote endpoint is not registered: ${endpoint}`, endpoint);
		}
		const binding = owner.endpoints.get(endpoint)!;
		let receiverContext: ServiceContext | null = binding.invocation.kind === "context"
			? (context?.get?.(binding.invocation.context) as ServiceContext | undefined) ?? null
			: context;
		if (binding.invocation.kind === "context") {
			const provider = this.hostContext(context, binding.invocation.context);
			if (provider) {
				const identity = this.contextIdentity(value.args, binding.invocation.wire, binding.parameters);
				if (identity === undefined) throw invalid("context-not-found", `DeepSeek remote context identity is missing: ${binding.invocation.context}`, endpoint, binding.invocation.wire);
				const decodedIdentity = decodeBoundary(binding.invocation.codec, identity, endpoint, binding.invocation.wire ?? binding.invocation.context);
				try {
					receiverContext = await provider.resolve(decodedIdentity) ?? null;
				} catch (error) {
					throw new RemoteDispatchError("context-failed", `DeepSeek remote context resolution failed: ${binding.invocation.context}`, { endpoint, field: binding.invocation.wire, cause: error });
				}
				if (!receiverContext) throw invalid("context-unavailable", `DeepSeek remote context is unavailable: ${binding.invocation.context}`, endpoint, binding.invocation.wire);
			}
		}
		if (binding.invocation.kind === "context" && (!receiverContext || typeof (receiverContext as ServiceContext).get !== "function")) {
			throw invalid("context-unavailable", `DeepSeek remote context is unavailable: ${binding.invocation.context}`, endpoint, binding.invocation.wire);
		}
		const service = receiverContext?.get?.(binding.service) ?? binding.receiver;
		if (!service || (typeof service !== "object" && typeof service !== "function")) {
			throw invalid("service-unavailable", `DeepSeek remote service is unavailable: ${binding.service}`, endpoint);
		}
		const callable = serviceMethod(service, binding.implementation);
		if (typeof callable !== "function") throw invalid("method-unavailable", `DeepSeek remote method is unavailable: ${endpoint}`, endpoint);
		const rawArgs = value.args === undefined ? [] : value.args;
		let args: unknown[];
		if (Array.isArray(rawArgs)) {
			if (binding.invocation.kind === "context" && this.hostContext(context, binding.invocation.context)) {
				throw invalid("arguments-invalid", "DeepSeek scoped remote args must be a named object", endpoint);
			}
			if (rawArgs.length > 32) throw invalid("arguments-invalid", "DeepSeek remote args must be an array of at most 32 values", endpoint);
			args = [...rawArgs];
			if (binding.parameters.some((parameter) => parameter.codec !== undefined)) {
				args = await Promise.all(binding.parameters.map((parameter, index) => decodeBoundary(parameter.codec, args[index], endpoint, parameter.wire)));
			}
		} else {
			if (!rawArgs || typeof rawArgs !== "object") throw invalid("arguments-invalid", "DeepSeek remote args must be an array or object", endpoint);
			const named = rawArgs as Record<string, unknown>;
			if (Object.keys(named).length > 32) throw invalid("arguments-invalid", "DeepSeek remote args must contain at most 32 values", endpoint);
			const expected = new Set(binding.parameters.map((parameter) => parameter.wire));
			if (binding.invocation.kind === "context" && binding.invocation.wire) expected.add(binding.invocation.wire);
			const actual = Object.keys(named);
			const extra = actual.filter((key) => !expected.has(key));
			const missing = binding.parameters.filter((parameter) => !parameter.optional && !Object.prototype.hasOwnProperty.call(named, parameter.wire));
			if (extra.length || missing.length) throw invalid("arguments-invalid", `DeepSeek remote args do not match ${endpoint}`, endpoint, missing[0]?.wire ?? extra[0]);
			args = await Promise.all(binding.parameters.map(async (parameter) => {
				const rawValue = named[parameter.wire];
				const parsedValue = decodeBoundary(parameter.codec, rawValue, endpoint, parameter.wire);
				if (parameter.source !== "lookup") return parsedValue;
				const typert = context?.get?.("typert") as { lookups?: { get?: (key: string) => LookupProvider | undefined } } | undefined;
				const provider = parameter.lookup === undefined ? undefined : typert?.lookups?.get?.(parameter.lookup);
				if (!provider || typeof provider.resolve !== "function") {
					throw invalid("lookup-unavailable", `DeepSeek remote lookup provider is unavailable: ${parameter.lookup}`, endpoint, parameter.wire);
				}
				const resolved = await provider.resolve(parsedValue);
				if (resolved === undefined) throw invalid("lookup-not-found", `DeepSeek remote lookup did not resolve: ${parameter.lookup}`, endpoint, parameter.wire);
				return resolved;
			}));
		}
		const signal = value.signal instanceof AbortSignal ? value.signal : undefined;
		if (binding.cancellation) args.push(signal ?? new AbortController().signal);
		if (signal?.aborted) throw invalid("cancelled", `DeepSeek remote invocation was cancelled: ${endpoint}`, endpoint);
		try {
			const result = await Reflect.apply(callable, service, args);
			return decodeBoundary(binding.result, result, endpoint, "result");
		} catch (error) {
			if (signal?.aborted) throw invalid("cancelled", `DeepSeek remote invocation was cancelled: ${endpoint}`, endpoint, undefined);
			throw error;
		}
	}

	private contextIdentity(rawArgs: unknown, wire: string | undefined, parameters: RemoteBinding["parameters"]): unknown {
		if (!wire) return undefined;
		if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) return (rawArgs as Record<string, unknown>)[wire];
		if (!Array.isArray(rawArgs)) return undefined;
		const index = parameters.findIndex((parameter) => parameter.wire === wire);
		return index >= 0 ? rawArgs[index] : undefined;
	}
}
