/**
 * Long-press to copy (20261115-mobile.md §4.3).
 *
 * The desktop shows a copy button on message hover. A phone has no hover, so the
 * equivalent is a long press on the message itself: one tap into the system
 * clipboard, with a brief confirmation instead of an alert (an alert for a copy
 * is more interruption than the action deserves).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, Text, View, useColorScheme } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import { themeFor } from '../theme'

export function CopyableText({ text, children }: { text: string; children: React.ReactNode }) {
  const theme = themeFor(useColorScheme())
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = useCallback(async () => {
    if (!text.trim()) return
    try {
      await Clipboard.setStringAsync(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard permission or a missing module: the message is still readable.
    }
  }, [text])

  return (
    <Pressable onLongPress={() => void copy()} delayLongPress={350}>
      {children}
      {copied ? (
        <View style={{ alignItems: 'flex-end', paddingTop: 4 }}>
          <Text style={{ color: theme.textWeak, fontSize: 11 }}>已复制</Text>
        </View>
      ) : null}
    </Pressable>
  )
}
