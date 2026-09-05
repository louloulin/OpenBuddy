/**
 * @openbuddy/auth-casdoor — Pure casdoor domain logic.
 *
 * Aggregates types and helpers previously split between
 * `src/lib/casdoor/*` and `electron/main/casdoor/casdoor-{permissions,authorization}.ts`.
 * All exports here are platform-agnostic: no Electron, no Node-specific imports.
 *
 * Domain map:
 *   - permissions.ts  → claims/capability helpers (CASDOOR_CAPABILITIES, normalizeClaims, hasCapability)
 *   - authorization.ts → tenant-scoped authorization decisions
 *   - capabilities.ts → IdP/application login capability derivation
 *   - lifecycle.ts    → lifecycle event shape (used by IPC + renderer listeners)
 *   - oidc-auth.ts    → OIDC/OAuth provider-agnostic helpers (PKCE, token exchange, JWT)
 *   - resources.ts    → protected resource + tenant policy + billing/credits DTOs
 */
export * from "./permissions";
export * from "./authorization";
export * from "./capabilities";
export * from "./lifecycle";
export * from "./oidc-auth";
export * from "./resources";
export * from "./resource-backend";
