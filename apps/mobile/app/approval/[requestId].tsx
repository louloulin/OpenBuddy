/**
 * Approval detail (20261115-mobile.md §4.2 P0 / 20261117-mobile.md 阶段 B).
 *
 * Reached from a push notification, so it must work as the app's very first
 * screen after launch. The card is shared with the inline chat row, which keeps
 * the permission / question / trust answers identical in both places.
 */

import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { RequestCard } from '../../src/components/RequestCard'
import type { ApprovalAction } from '../../src/core/approvals'
import { isPreview } from '../../src/core/preview'
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
  const capabilities = useApp(state => state.capabilities)
  const refreshApprovals = useApp(state => state.refreshApprovals)
  const [busy, setBusy] = useState(false)
  // A push notification can outlive its request: the turn may have settled on
  // the desktop before the phone opened the link. Give the tunnel a moment to
  // hand it over, then say so instead of spinning forever.
  const [waited, setWaited] = useState(false)

  // A push can cold-start straight into this screen, so `back()` has nowhere to
  // go. Falling back to the session list keeps the approval dismissible without
  // forcing a decision.
  const dismiss = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  useEffect(() => {
    if (approval) return
    const timer = setTimeout(() => setWaited(true), 4000)
    return () => clearTimeout(timer)
  }, [approval])

  // The push tap can be the app's very first screen. The event stream has
  // nothing from before launch, so actively pull the pending card instead of
  // waiting for an event that will never arrive.
  useEffect(() => {
    if (!approval && booted && transport && capabilities) void refreshApprovals()
  }, [approval, booted, transport, capabilities, refreshApprovals])

  useEffect(() => {
    // The review build has no tunnel by design; it renders the demo request.
    if (!isPreview() && booted && !transport) router.replace('/pair')
  }, [booted, transport, router])

  const settle = async (action: ApprovalAction) => {
    setBusy(true)
    let answered = true
    try {
      if (action.type === 'permission') await resolveApproval(requestId, action.approved)
      else if (action.type === 'question') {
        await resolveQuestion(requestId, approval?.sessionId ?? '', action.value, action.cancelled)
      } else if (action.type === 'trust' && approval?.cwd) {
        await resolveTrust(approval.cwd, action.trusted)
      }
    } catch {
      // §2.4: a failed answer keeps the card and says why. Navigating away
      // would hide both the card and the reason.
      answered = false
    } finally {
      setBusy(false)
    }
    if (answered) router.back()
  }

  if (!approval) {
    if (waited) {
      return (
        <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>这次请求已经处理过了</Text>
          <Text style={{ color: theme.textWeak, textAlign: 'center', lineHeight: 20 }}>
            电脑上可能已经批准或取消了它。回到会话看看最新进展。
          </Text>
          <Pressable
            onPress={dismiss}
            accessibilityLabel="返回"
            style={({ pressed }) => ({
              marginTop: 4,
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: theme.radiusPill,
              backgroundColor: pressed ? theme.pressed : theme.ink,
            })}
          >
            <Text style={{ color: theme.inkFg, fontSize: 14, fontWeight: '600' }}>返回</Text>
          </Pressable>
        </View>
      )
    }
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
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.surface }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 }}>
          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="稍后处理"
            hitSlop={8}
            style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 6, opacity: pressed ? 0.5 : 1 })}
          >
            <Text style={{ color: theme.textMedium, fontSize: theme.fontMeta, fontWeight: '600' }}>稍后处理</Text>
          </Pressable>
        </View>
        <RequestCard approval={approval} busy={busy} onAction={action => void settle(action)} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
