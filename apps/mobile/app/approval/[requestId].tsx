/**
 * Approval detail (20261115-mobile.md §4.2 P0 / 20261117-mobile.md 阶段 B).
 *
 * Reached from a push notification, so it must work as the app's very first
 * screen after launch. The card is shared with the inline chat row, which keeps
 * the permission / question / trust answers identical in both places.
 */

import { useEffect, useState } from 'react'
import { ActivityIndicator, Text, View, useColorScheme } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { RequestCard } from '../../src/components/RequestCard'
import type { ApprovalAction } from '../../src/core/approvals'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

export default function ApprovalScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const params = useLocalSearchParams<{ requestId: string }>()
  const requestId = decodeURIComponent(params.requestId ?? '')

  const approval = useApp(state => state.approvals.find(item => item.requestId === requestId))
  const resolveApproval = useApp(state => state.resolveApproval)
  const resolveQuestion = useApp(state => state.resolveQuestion)
  const resolveTrust = useApp(state => state.resolveTrust)
  const booted = useApp(state => state.booted)
  const transport = useApp(state => state.transport)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (booted && !transport) router.replace('/pair')
  }, [booted, transport, router])

  const settle = async (action: ApprovalAction) => {
    setBusy(true)
    try {
      if (action.type === 'permission') await resolveApproval(requestId, action.approved)
      else if (action.type === 'question') {
        await resolveQuestion(requestId, approval?.sessionId ?? '', action.value, action.cancelled)
      } else if (action.type === 'trust' && approval?.cwd) {
        await resolveTrust(approval.cwd, action.trusted)
      }
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
    <View style={{ flex: 1, backgroundColor: theme.surface, padding: 16 }}>
      <RequestCard approval={approval} busy={busy} onAction={action => void settle(action)} />
    </View>
  )
}
