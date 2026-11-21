import type { Scope } from './auth.js'

/**
 * The scope list, restated here on purpose: `auth.ts` imports the store,
 * the store imports this module, so a runtime import of `SCOPES` from here
 * would close a cycle. `tests/policy.test.ts` pins the two lists together.
 */
export const SUPPORTED_SCOPES: Scope[] = ['sessions:read', 'sessions:write', 'approve', 'proxy']

/**
 * Deployment policy: the operator-facing switches the gateway itself
 * enforces, backed by the console (Settings) and readable by every
 * authenticated client so desktops can mirror the same rules locally.
 *
 * Everything here is enforceable *at the gateway* — pair/start, pair/claim,
 * desktop enrollment and device provisioning are the choke points, so a
 * policy change takes effect on the next request without touching clients.
 * Rules only a desktop can enforce (tool allowlists, provider limits) do not
 * belong here until the desktop actually reads and applies them.
 */
export type GatewayPolicy = {
  /** Kill switch: no new pairing codes are minted while false. */
  pairingEnabled: boolean
  /** Whether codes may omit a desktopId and land on the shared route. */
  allowSharedRoute: boolean
  /** Active devices allowed per desktop. 0 = unlimited. */
  maxDevicesPerDesktop: number
  /** Active desktops allowed per user. 0 = unlimited. */
  maxDesktopsPerUser: number
  /** Scopes a new credential may request; others are filtered out. */
  allowedScopes: Scope[]
  /**
   * Tools every desktop must deny (`--disallowedTools`). The gateway cannot
   * enforce this itself — it never sees the agent loop — so desktops read the
   * policy and mirror it locally. Empty means "no extra denials".
   */
  disabledTools: string[]
  /**
   * Sites the desktop's embedded workspace browser may load. Entries are
   * `host`, `host/path`, `https://host/path` or a `*.host` wildcard; schemes
   * are case-insensitive and a missing scheme matches both http and https.
   * Empty means "no restriction" — the browser is a user tool by default, and
   * an operator opts into governance. Like `disabledTools`, only the desktop
   * can enforce it, so the value is mirrored rather than acted on here.
   */
  allowedBrowserSites: string[]
  /**
   * White-label identity the desktop paints at launch.
   *
   * Deliberately only two values: a product name and one accent color.
   * Everything else — the derived accent shades, their contrast-checked
   * foregrounds — is computed by the desktop from that one color. A policy
   * that carried raw token values could ship unreadable UI, and the operator
   * has no way to check 30 shades by hand.
   *
   * Absent means "ship the default identity"; optional so rows written before
   * the field existed keep working.
   */
  branding?: GatewayBranding
}

export type GatewayBranding = {
  /** Window title, sidebar header and About panel. */
  displayName: string
  /** `#RRGGBB`. The desktop derives the rest. */
  accentColor: string
}

export const DEFAULT_POLICY: GatewayPolicy = {
  pairingEnabled: true,
  // Off by default: a code that names no computer produces a device bound to
  // the gateway's shared upstream, which on a multi-account deployment is one
  // user's sessions handed to another user's phone. An operator who really
  // runs one shared machine turns it back on in the console.
  allowSharedRoute: false,
  maxDevicesPerDesktop: 0,
  maxDesktopsPerUser: 0,
  allowedScopes: [...SUPPORTED_SCOPES],
  disabledTools: [],
  allowedBrowserSites: [],
}

/** Hard ceiling so a typo cannot store an effectively unlimited limit. */
const MAX_LIMIT = 10_000
const MAX_DISABLED_TOOLS = 200
const MAX_TOOL_NAME_LENGTH = 128
const MAX_BROWSER_SITES = 200
const MAX_BROWSER_SITE_LENGTH = 512
const MAX_BRAND_NAME_LENGTH = 48

/**
 * A brand name is rendered in a window title and a header, so it is one line
 * of printable text: no control characters (a newline would break the title
 * bar), and bounded so a paste of a paragraph cannot overflow the header.
 */
function parseBranding(value: unknown): GatewayBranding | null | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const name = typeof record.displayName === 'string' ? record.displayName.trim() : null
  if (!name || name.length > MAX_BRAND_NAME_LENGTH) return null
  if (/[\u0000-\u001f\u007f]/.test(name)) return null

  const accent = typeof record.accentColor === 'string' ? record.accentColor.trim() : null
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return null

  return { displayName: name, accentColor: accent.toUpperCase() }
}

function clampLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const floored = Math.floor(value)
  if (floored < 0 || floored > MAX_LIMIT) return null
  return floored
}

/**
 * Missing `disabledTools` means "no denials": rows written before this field
 * existed must keep working instead of falling back to the whole default
 * policy (which would silently re-enable pairing and limits set by an
 * operator). Present but malformed is still a validation error.
 */
function parseDisabledTools(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const names: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const name = entry.trim()
    if (!name || name.length > MAX_TOOL_NAME_LENGTH) return null
    if (/[\u0000-\u001f\u007f]/.test(name)) return null
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names.length > MAX_DISABLED_TOOLS ? null : names
}

/**
 * Site entries are stored verbatim (case preserved for path segments) so the
 * operator's console round-trips exactly what was typed; the desktop normalizes
 * them when matching. What is refused here is anything that cannot be a site
 * pattern: whitespace, control characters, over-long entries, and non-http(s)
 * schemes such as `file:` or `javascript:`.
 */
function parseAllowedBrowserSites(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const sites: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    const site = entry.trim()
    if (!site || site.length > MAX_BROWSER_SITE_LENGTH) return null
    if (/[\s\u0000-\u001f\u007f]/.test(site)) return null
    // `host:port` also matches a scheme-shaped prefix, so only treat text
    // before a colon as a scheme when it is not a numeric port.
    const explicit = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(site)
    if (explicit && !/^\d{1,5}(\/|$)/.test(explicit[2]!)) {
      const scheme = explicit[1]!.toLowerCase()
      if (scheme !== 'http' && scheme !== 'https') return null
      if (!explicit[2]!.startsWith('//')) return null
    }
    const key = site.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sites.push(site)
  }
  return sites.length > MAX_BROWSER_SITES ? null : sites
}

/**
 * Normalize an unknown payload (request body or stored JSON) into a policy.
 * Returns null when a field is present but invalid — the route answers 400
 * instead of silently guessing, and a corrupted stored row falls back to the
 * default rather than locking the deployment out.
 */
export function parsePolicy(raw: unknown): GatewayPolicy | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>

  if (typeof body.pairingEnabled !== 'boolean') return null
  if (typeof body.allowSharedRoute !== 'boolean') return null

  const maxDevices = clampLimit(body.maxDevicesPerDesktop)
  if (maxDevices === null) return null
  const maxDesktops = clampLimit(body.maxDesktopsPerUser)
  if (maxDesktops === null) return null

  if (!Array.isArray(body.allowedScopes)) return null
  const allowedScopes = body.allowedScopes.filter((scope): scope is Scope =>
    typeof scope === 'string' && (SUPPORTED_SCOPES as string[]).includes(scope),
  )
  // An empty (or all-unknown) allowlist would disable pairing with no
  // explanation, so it is a validation error: an operator who wants that has
  // the pairing kill switch, and the refusal says so.
  if (allowedScopes.length === 0) return null

  const disabledTools = parseDisabledTools(body.disabledTools)
  if (disabledTools === null) return null

  const allowedBrowserSites = parseAllowedBrowserSites(body.allowedBrowserSites)
  if (allowedBrowserSites === null) return null

  const branding = parseBranding(body.branding)
  // `null` is "present but malformed" — a typo'd color must be refused rather
  // than silently dropped, or the operator sees a save succeed and a desktop
  // that still shows the default brand.
  if (branding === null) return null

  return {
    pairingEnabled: body.pairingEnabled,
    allowSharedRoute: body.allowSharedRoute,
    maxDevicesPerDesktop: maxDevices,
    maxDesktopsPerUser: maxDesktops,
    allowedScopes,
    disabledTools,
    allowedBrowserSites,
    ...(branding ? { branding } : {}),
  }
}

/** Branding as the desktop should see it: absent means "use the defaults". */
export function policyBranding(policy: GatewayPolicy): GatewayBranding | null {
  return policy.branding ?? null
}

/** Scopes a credential may actually receive, under this policy. */
export function policyAllowsScopes(policy: GatewayPolicy, requested: Scope[]): Scope[] {
  const allowed = new Set(policy.allowedScopes)
  return requested.filter(scope => allowed.has(scope))
}
