/**
 * Credential storage across platforms (20261115-mobile.md §5.9).
 *
 * Native builds keep the device token in Keychain/Keystore via SecureStore.
 * The web preview (Expo export / H5) has no SecureStore, so it falls back to
 * localStorage — acceptable for a preview origin, and the H5 page is served
 * same-origin by the gateway over HTTPS in production.
 */

import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const isWeb = Platform.OS === 'web'

function webStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export async function getItem(key: string): Promise<string | null> {
  if (isWeb) return webStorage()?.getItem(key) ?? null
  return SecureStore.getItemAsync(key)
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    webStorage()?.setItem(key, value)
    return
  }
  await SecureStore.setItemAsync(key, value)
}

export async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    webStorage()?.removeItem(key)
    return
  }
  await SecureStore.deleteItemAsync(key)
}
