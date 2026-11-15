/**
 * Builds the push providers a gateway actually has credentials for.
 *
 * A gateway is often self-hosted with neither a Firebase project nor a
 * notification relay, and relaying sessions must not depend on either. So a
 * provider that cannot be configured is simply absent, and the dispatcher
 * reports its registrations as skipped instead of failing.
 */

import { readFileSync } from 'node:fs'

import type { GatewayConfig } from '../config.js'
import { createFcmProvider, type FcmServiceAccount } from './fcm.js'
import type { PushProvider, PushProviderName } from './types.js'
import { createWebhookProvider } from './webhook.js'

/** The subset of the downloaded service-account JSON that FCM needs. */
export function parseServiceAccount(raw: unknown): FcmServiceAccount {
  const account = raw as Record<string, unknown> | null
  const projectId = account?.project_id
  const clientEmail = account?.client_email
  const privateKey = account?.private_key
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error('fcm: service account is missing project_id')
  }
  if (typeof clientEmail !== 'string' || !clientEmail) {
    throw new Error('fcm: service account is missing client_email')
  }
  if (typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY')) {
    throw new Error('fcm: service account is missing private_key')
  }
  return {
    projectId,
    clientEmail,
    // A key pasted into an env var arrives with escaped newlines; one read from
    // the downloaded file arrives with real ones.
    privateKeyPem: privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey,
  }
}

export function loadServiceAccount(path: string): FcmServiceAccount {
  return parseServiceAccount(JSON.parse(readFileSync(path, 'utf8')))
}

export type BuildProvidersOptions = {
  fetchImpl?: typeof fetch
  warn?: (message: string) => void
}

export function buildPushProviders(
  config: GatewayConfig,
  options: BuildProvidersOptions = {},
): Partial<Record<PushProviderName, PushProvider>> {
  const warn = options.warn ?? ((message: string) => console.warn(message))
  const providers: Partial<Record<PushProviderName, PushProvider>> = {}

  if (config.fcmServiceAccountPath) {
    try {
      providers.fcm = createFcmProvider({
        serviceAccount: loadServiceAccount(config.fcmServiceAccountPath),
        channelId: config.fcmChannelId,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })
    } catch (error) {
      warn(`[push] fcm disabled: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // The webhook provider needs no credential of its own — a device registers
  // whatever URL it wants to be reached at — so it is always available.
  providers.webhook = createWebhookProvider({
    ...(config.webhookToken ? { token: config.webhookToken } : {}),
    allowedHosts: config.webhookAllowedHosts,
    allowCleartext: config.webhookAllowCleartext,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })

  return providers
}
