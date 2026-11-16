/**
 * Approval detail (20261115-mobile.md §4.2 P0, §4.3).
 *
 * Reached from a push notification, so it must work as the app's very first
 * screen after launch. The decision pair is the same pill pair the desktop puts
 * on a permission dialog: a bordered "deny" and an ink "allow".
 */

import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View, useColorScheme } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { CheckIcon, CloseIcon, SparkIcon } from '../../src/components/icons'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

export default function ApprovalScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const params = useLocalSearchParams<{ requestId: string }>()
  const requestId = decodeURIComponent(params.requestId ?? '')

  const approval = useApp(state => state.approvals.find(item => item.requestId === requestId))
  const resolve = useApp(state => state.resolveApproval)
  const booted = useApp(state => state.booted)
  const transport = useApp(state => state.transport)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (booted && !transport) router.replace('/pair')
  }, [booted, transport, router])

  const settle = async (approved: boolean) => {
    setBusy(true)
    try {
      await resolve(requestId, approved)
      router.back()
    } finally {
      setBusy(false)
    }
  }

  if (!approval) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
        <ActivityIndicator color={theme.textMedium} />
        <Text style={{ color: theme.textWeak, textAlign: 'center', lineHeight: 20 }}>
          正在等待电脑发来这次请求…{'\n'}如果已经处理过，它会自动消失。
        </Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, padding: 16, gap: 16 }}>
      <View
        style={{
          backgroundColor: theme.card,
          borderRadius: 16,
          borderWidth: theme.hairline,
          borderColor: theme.cardBorder,
          padding: 16,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SparkIcon size={18} color={theme.warning} />
          <Text style={{ flex: 1, color: theme.text, fontSize: 18, fontWeight: '700' }}>{approval.title}</Text>
        </View>
        {approval.detail ? (
          <Text style={{ color: theme.textMedium, fontSize: 14, lineHeight: 21 }} selectable>
            {approval.detail}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 12, marginTop: 'auto' }}>
        <Pressable
          onPress={() => void settle(false)}
          disabled={busy}
          style={({ pressed }) => ({
            flex: 1,
            height: 50,
            borderRadius: theme.radiusPill,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: pressed ? theme.pressed : theme.card,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
          })}
        >
          <CloseIcon size={16} color={theme.danger} />
          <Text style={{ color: theme.danger, fontSize: 15, fontWeight: '600' }}>拒绝</Text>
        </Pressable>
        <Pressable
          onPress={() => void settle(true)}
          disabled={busy}
          style={({ pressed }) => ({
            flex: 1,
            height: 50,
            borderRadius: theme.radiusPill,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            backgroundColor: busy ? theme.pressed : theme.ink,
            opacity: pressed ? 0.88 : 1,
          })}
        >
          <CheckIcon size={16} color={theme.inkFg} />
          <Text style={{ color: theme.inkFg, fontSize: 15, fontWeight: '600' }}>允许</Text>
        </Pressable>
      </View>
    </View>
  )
}
