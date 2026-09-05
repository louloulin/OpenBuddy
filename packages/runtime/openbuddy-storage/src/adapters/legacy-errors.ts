export function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function isMissingSource(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

export function legacySourceError(label: string, path: string, error: unknown): Error {
  return new Error(`${label} legacy source failed: ${path}`, { cause: error });
}
