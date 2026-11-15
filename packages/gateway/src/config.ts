import { join } from 'node:path'

import { randomToken } from './credentials.js'

/**
 * Where a compiled binary keeps its database.
 *
 * `import.meta.url` inside `bun build --compile` points into Bun's read-only
 * virtual filesystem (`$bunfs`), so deriving a sibling data directory from it
 * would produce a path that cannot be created. A packaged gateway uses
 * `./data` under its working directory instead; services should still set
 * `GATEWAY_DB` explicitly.
 */
function defaultDbPath(): string {
  if (import.meta.url.includes('$bunfs')) {
    return join(process.cwd(), 'data', 'gateway.sqlite')
  }
  return new URL('../data/gateway.sqlite', import.meta.url).pathname
}

export type GatewayConfig = {
  host: string
  port: number
  /** lumos server the gateway forwards to, e.g. http://127.0.0.1:3456 */
  upstreamUrl: string
  /** Optional bearer token injected on the gateway → lumos hop. */
  upstreamToken?: string
  /** Token that may mint pairing codes and manage devices. */
  adminToken: string
  /** Token a desktop agent presents on /relay/agent. */
  agentToken: string
  dbPath: string
  /** One-time pairing code lifetime. */
  pairTtlMs: number
  /** Claim attempts allowed per IP per minute. */
  claimLimitPerMinute: number
  maxBodyBytes: number
  /** URL advertised to paired devices. Defaults to the request origin. */
  publicUrl?: string
  /**
   * Browser origins allowed to call the gateway cross-origin. Requests without
   * an Origin header (native apps, CLIs) are unaffected; browsers only need
   * this for the Capacitor shell. Empty list falls back to the shell origins.
   */
  allowedOrigins: string[]
  /** Path to a Firebase service-account JSON; enables the FCM provider. */
  fcmServiceAccountPath?: string
  /** Android notification channel the app registers. */
  fcmChannelId: string
  /** Shared secret sent as `Authorization: Bearer …` to webhook destinations. */
  webhookToken?: string
  /** Hosts a webhook destination may point at. Empty allows any https host. */
  webhookAllowedHosts: string[]
  /** Permit `http://` webhook destinations, for a relay on the LAN. */
  webhookAllowCleartext: boolean
  /** How often the gateway asks the desktop which sessions are live. */
  pushWatchIntervalMs: number
  /**
   * Force the session watcher on or off. Unset means "on when this gateway can
   * actually deliver a notification", so a gateway with no push credentials
   * never polls the desktop for nothing.
   */
  pushWatch?: boolean
  /** Whether `POST /auth/register` may create accounts. */
  allowRegistration: boolean
  /** Lifetime of an admin console login session. */
  adminSessionTtlMs: number
  /**
   * Whether the console is served at `/ui`.
   *
   * Off means the admin API still answers — a script that only needs JSON is
   * unaffected — but the browser surface is not published.
   */
  adminUiEnabled: boolean
  /**
   * Where the built console lives. The gateway only reads files from here; it
   * never depends on the UI package's toolchain.
   */
  uiDir: string
  /**
   * Whether the gateway publishes the phone web client at `/h5`.
   *
   * A phone that talks to a desktop through the gateway needs a page to open;
   * without one it can only reach the desktop on the LAN, which is the
   * situation the gateway exists to remove. Operators who serve the client
   * from a CDN instead can turn this off.
   */
  h5Enabled: boolean
  /**
   * Where the built phone web client lives.
   *
   * The bundle is tens of megabytes, so it is read from disk rather than
   * embedded in the binary; a packaged gateway therefore expects it in a
   * directory beside itself.
   */
  h5Dir: string
  /** Creates (or promotes) this account as an admin on boot when set with a password. */
  bootstrapAdminEmail?: string
  bootstrapAdminPassword?: string
  /**
   * Whether a pairing code may be minted without naming a desktop.
   *
   * A code with no desktop produces a device that reads the gateway's shared
   * upstream, which is what every code-paired phone on the machine sees. On a
   * gateway serving more than one account that hands one user's phone another
   * user's sessions, so this is **off by default**: a code must name the
   * computer it belongs to. A single-tenant operator who wants the old
   * behaviour sets `GATEWAY_PAIR_ALLOW_SHARED=1`.
   *
   * The gateway additionally refuses the shared route on its own once more
   * than one account exists, so a deployment that grows past one user cannot
   * leak sessions even if this switch is left on.
   */
  pairAllowsSharedRoute: boolean
  /** Lifetime of a user login session. */
  sessionTtlMs: number
  /** How often expired codes, dead sessions and old audit rows are swept. */
  pruneIntervalMs: number
  /** Login attempts allowed per IP per minute. */
  loginLimitPerMinute: number
  /** Login attempts allowed per email per minute. */
  loginEmailLimitPerMinute: number
  /** Registration attempts allowed per IP per minute. */
  registerLimitPerMinute: number
  /**
   * Requests one device may make through the reverse proxy per minute.
   *
   * A phone polls the desktop for live session status while a conversation
   * runs, so this has to leave room for a busy client; it exists to stop a
   * single credential from being turned into a request amplifier, not to
   * throttle normal use.
   */
  apiLimitPerMinute: number
  /**
   * Requests one client address may make through the reverse proxy per
   * minute. Higher than the per-device limit because several devices of one
   * person legitimately share an address behind a home router or a carrier
   * NAT.
   */
  apiIpLimitPerMinute: number
  /**
   * Relay connections one client address may open per minute.
   *
   * The desktop's tunnel reconnects with a backoff that tops out at 30
   * seconds, so a healthy client opens a handful of connections an hour.
   * The ceiling is here to stop a reconnect storm from turning into a
   * connection flood.
   */
  relayLimitPerMinute: number
  /**
   * Whether `X-Forwarded-For` / `X-Real-IP` may stand in for the client IP.
   *
   * Any client can send those headers, so a public gateway that trusts them
   * hands every caller a fresh rate-limit bucket — which is how a 6-to-8
   * digit pairing code gets brute-forced inside its TTL. The socket address
   * is the default; set this only when a trusted reverse proxy actually
   * terminates the connection and overwrites the header itself.
   */
  trustProxy: boolean
  /**
   * Refuse to start when the advertised public address is plain HTTP.
   *
   * A gateway on the open internet carries session transcripts and device
   * tokens; both are readable on a cleartext hop. TLS is the operator's job
   * (the gateway usually sits behind Caddy or a load balancer), so the default
   * is a loud warning rather than a refusal — but a deployment that knows it
   * is public can make the check fatal.
   */
  requireTls: boolean
}

function envInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function envBool(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

function envList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

/** The Capacitor shell origins, used when the operator does not pin a list. */
const DEFAULT_ALLOWED_ORIGINS = [
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]

export function loadConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  return {
    host: env.GATEWAY_HOST ?? '0.0.0.0',
    port: envInt(env.GATEWAY_PORT, 8787),
    upstreamUrl: (env.LUMOS_UPSTREAM_URL ?? 'http://127.0.0.1:3456').replace(/\/+$/, ''),
    upstreamToken: env.LUMOS_UPSTREAM_TOKEN || undefined,
    adminToken: env.GATEWAY_ADMIN_TOKEN || randomToken('adm_'),
    agentToken: env.GATEWAY_AGENT_TOKEN || randomToken('agt_'),
    dbPath: env.GATEWAY_DB ?? defaultDbPath(),
    pairTtlMs: envInt(env.GATEWAY_PAIR_TTL_MS, 120_000),
    claimLimitPerMinute: envInt(env.GATEWAY_CLAIM_LIMIT, 10),
    maxBodyBytes: envInt(env.GATEWAY_MAX_BODY_BYTES, 20 * 1024 * 1024),
    publicUrl: env.GATEWAY_PUBLIC_URL?.replace(/\/+$/, '') || undefined,
    allowedOrigins: envList(env.GATEWAY_ALLOWED_ORIGINS).length > 0
      ? envList(env.GATEWAY_ALLOWED_ORIGINS)
      : DEFAULT_ALLOWED_ORIGINS,
    fcmServiceAccountPath: env.GATEWAY_FCM_SERVICE_ACCOUNT || undefined,
    fcmChannelId: env.GATEWAY_FCM_CHANNEL_ID || 'lumos',
    webhookToken: env.GATEWAY_WEBHOOK_TOKEN || undefined,
    webhookAllowedHosts: envList(env.GATEWAY_WEBHOOK_ALLOWED_HOSTS),
    webhookAllowCleartext: envBool(env.GATEWAY_WEBHOOK_ALLOW_CLEARTEXT),
    pushWatchIntervalMs: envInt(env.GATEWAY_PUSH_WATCH_INTERVAL_MS, 5_000),
    pushWatch: env.GATEWAY_PUSH_WATCH === undefined ? undefined : envBool(env.GATEWAY_PUSH_WATCH),
    allowRegistration: env.GATEWAY_ALLOW_REGISTRATION === undefined
      ? true
      : envBool(env.GATEWAY_ALLOW_REGISTRATION),
    // Off unless the operator says otherwise: a code that names no computer
    // lands on the gateway's shared upstream, which is one user's sessions for
    // another user's phone on a multi-account deployment.
    pairAllowsSharedRoute: env.GATEWAY_PAIR_ALLOW_SHARED === undefined
      ? false
      : envBool(env.GATEWAY_PAIR_ALLOW_SHARED),
    adminSessionTtlMs: envInt(env.GATEWAY_ADMIN_SESSION_TTL_MS, 12 * 60 * 60 * 1000),
    // On unless an operator turns it off; a gateway with no build simply 404s.
    adminUiEnabled: env.GATEWAY_ADMIN_UI === undefined ? true : envBool(env.GATEWAY_ADMIN_UI),
    uiDir: env.GATEWAY_UI_DIR || new URL('../../gateway-ui/dist', import.meta.url).pathname,
    h5Enabled: env.GATEWAY_H5 === undefined ? true : envBool(env.GATEWAY_H5),
    h5Dir: env.GATEWAY_H5_DIR || new URL('../www', import.meta.url).pathname,
    // Only together: a half-configured bootstrap would silently do nothing.
    bootstrapAdminEmail: env.GATEWAY_ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    bootstrapAdminPassword: env.GATEWAY_ADMIN_PASSWORD || undefined,
    sessionTtlMs: envInt(env.GATEWAY_SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000),
    pruneIntervalMs: envInt(env.GATEWAY_PRUNE_INTERVAL_MS, 60 * 60 * 1000),
    loginLimitPerMinute: envInt(env.GATEWAY_LOGIN_LIMIT, 10),
    loginEmailLimitPerMinute: envInt(env.GATEWAY_LOGIN_EMAIL_LIMIT, 5),
    registerLimitPerMinute: envInt(env.GATEWAY_REGISTER_LIMIT, 5),
    apiLimitPerMinute: envInt(env.GATEWAY_API_LIMIT, 900),
    apiIpLimitPerMinute: envInt(env.GATEWAY_API_IP_LIMIT, 3_000),
    relayLimitPerMinute: envInt(env.GATEWAY_RELAY_LIMIT, 120),
    // Secure default: the socket address is the client until the operator
    // says a trusted proxy sits in front and rewrites the forwarding headers.
    trustProxy: envBool(env.GATEWAY_TRUST_PROXY),
    requireTls: envBool(env.GATEWAY_REQUIRE_TLS),
  }
}
