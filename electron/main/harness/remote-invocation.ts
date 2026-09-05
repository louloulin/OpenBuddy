type RemoteGateway = {
	invoke: (request: unknown) => Promise<unknown>;
};

type RemoteFallback = (request: unknown) => Promise<unknown>;

function isNamedRemoteRequest(request: unknown): boolean {
	if (!request || typeof request !== "object" || Array.isArray(request)) return false;
	const value = request as Record<string, unknown>;
	return typeof value.namespace === "string"
		&& typeof value.method === "string"
		&& value.args !== undefined
		&& Boolean(value.args)
		&& typeof value.args === "object"
		&& !Array.isArray(value.args)
		&& Object.getPrototypeOf(value.args) === Object.prototype;
}

export function invokeRemoteWithGateway(
	request: unknown,
	gateway: RemoteGateway | undefined,
	fallback: RemoteFallback,
): Promise<unknown> {
	if (gateway && isNamedRemoteRequest(request)) return gateway.invoke(request);
	return fallback(request);
}
