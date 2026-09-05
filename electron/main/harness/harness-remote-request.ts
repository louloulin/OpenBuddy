import type { ClientRequest } from "@openbuddy/plugin-host";

export function remoteRequestFromHarnessRequest(request: Pick<ClientRequest, "method" | "payload">): Record<string, unknown> {
	if (!request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) {
		throw new Error("Harness Remote payload must be an object");
	}
	const payload = request.payload as Record<string, unknown>;
	if (typeof payload.namespace === "string" && typeof payload.method === "string") return { ...payload };
	const slash = request.method.indexOf("/");
	if (slash <= 0 || slash === request.method.length - 1) throw new Error(`Harness Remote endpoint is invalid: ${request.method}`);
	return {
		...payload,
		namespace: request.method.slice(0, slash),
		method: request.method.slice(slash + 1),
	};
}
