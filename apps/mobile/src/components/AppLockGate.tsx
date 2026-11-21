/**
 * The lock screen (20261115-mobile.md §4.2 P1 "安全锁").
 *
 * Drawn over everything once the store says `locked`. It asks the OS for a
 * scan on mount, so coming back from the switcher is one glance, and shows a
 * quiet card when the scan is cancelled or unavailable.
 */

import { useEffect, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LockIcon } from './icons'
import type { Theme } from '../theme'

export function AppLockGate({ theme, onUnlock }: { theme: Theme; onUnlock: () => Promise<boolean> }) {
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  const attempt = async () => {
    if (busy) return
    setBusy(true)
    setHint('')
    const ok = await onUnlock()
    if (!ok) {
      setHint(Platform.OS === 'web'
        ? '网页预览不支持生物识别，真机上会弹出面容 / 指纹。'
        : '没有通过验证，再试一次。')
    }
    setBusy(false)
  }

  // One prompt as the gate appears; the button is the retry path.
  useEffect(() => {
    void attempt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: theme.surface,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.card,
          borderWidth: theme.hairline,
          borderColor: theme.cardBorder,
          marginBottom: 18,
        }}
      >
        <LockIcon size={28} color={theme.text} />
      </View>
      <Text style={{ color: theme.text, fontSize: 19, fontWeight: '700' }}>OpenBuddy 已锁定</Text>
      <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 8 }}>
        用面容或指纹解锁。{'\n'}设备凭证始终只在这台手机上。
      </Text>
      <Pressable
        onPress={() => void attempt()}
        disabled={busy}
        style={({ pressed }) => ({
          marginTop: 26,
          height: 46,
          minWidth: 180,
          paddingHorizontal: 24,
          borderRadius: theme.radiusPill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.ink,
          opacity: pressed || busy ? 0.7 : 1,
        })}
      >
        {busy
          ? <ActivityIndicator color={theme.inkFg} />
          : <Text style={{ color: theme.inkFg, fontSize: 15, fontWeight: '600' }}>解锁</Text>}
      </Pressable>
      {hint ? (
        <Text style={{ color: theme.textWeak, fontSize: 12, marginTop: 14, textAlign: 'center' }}>{hint}</Text>
      ) : null}
    </View>
  )
}
