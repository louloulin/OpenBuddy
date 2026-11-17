/**
 * Sharing a file the desktop produced (20261117-mobile.md C2).
 *
 * Native builds hand the JSONL to the OS share sheet from the cache directory;
 * the web fallback downloads it, because expo-sharing has no browser surface.
 * No new native module is needed beyond expo-file-system/expo-sharing.
 */

import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

export type ShareResult = 'shared' | 'downloaded' | 'unavailable'

export async function shareTextFile(filename: string, content: string): Promise<ShareResult> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return 'unavailable'
    const blob = new Blob([content], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoke on the next tick so Safari has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return 'downloaded'
  }

  const file = new File(Paths.cache, filename)
  if (file.exists) file.delete()
  await file.write(content)
  if (!(await Sharing.isAvailableAsync())) return 'unavailable'
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/x-ndjson',
    dialogTitle: '导出会话',
    UTI: 'public.json',
  })
  return 'shared'
}
