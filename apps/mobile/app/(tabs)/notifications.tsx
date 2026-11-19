/**
 * Notifications (20261115-mobile.md §4.2 P0, §5.8).
 *
 * Four kinds, one list, each on a card: approvals open the approval screen,
 * everything else opens its session. Unread rows keep a dot, read rows drop to
 * medium contrast — the same de-emphasis the desktop uses for read items.
 */

import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useRouter } from 'expo-router'

import { BellIcon } from '../../src/components/icons'
import { relativeTime } from '../../src/core/relative-time'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

const LABEL: Record<string, string> = {
  approval: '需要批准',
  question: '等待回答',
  done: '已完成',
  scheduled: '定时任务完成',
}

export default function NotificationsScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const notifications = useApp(state => state.notifications)
  const loaded = useApp(state => state.notificationsLoaded)
  const refresh = useApp(state => state.refreshNotifications)
  const markRead = useApp(state => state.markNotificationsRead)
  const markOne = useApp(state => state.markNotificationRead)
  const [refreshing, setRefreshing] = useState(false)

  // The backlog lives on the computer; push only covers what arrived while the
  // phone was away, so opening the tab has to ask.
  useEffect(() => { void refresh() }, [refresh])

  const pull = async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  if (!loaded && notifications.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface }}>
        <ActivityIndicator color={theme.textWeak} />
      </View>
    )
  }

  if (notifications.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.card,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
          }}
        >
          <BellIcon size={26} color={theme.textWeak} />
        </View>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>没有新通知</Text>
        <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
          只有会话需要你时才会打扰你。{'\n'}审批、提问和完成会出现在这里。
        </Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: theme.gutter, paddingVertical: 10 }}>
        <Pressable onPress={() => void markRead()} hitSlop={8} accessibilityLabel="全部标为已读">
          <Text style={{ color: theme.textMedium, fontSize: 12 }}>全部标为已读</Text>
        </Pressable>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.textMedium} onRefresh={() => void pull()} />}
      >
        {notifications.map(item => (
          <Pressable
            key={item.id}
            onPress={() => {
              // Reading a row is acknowledging it; the desktop keeps the flag.
              void markOne(item.id)
              // A backlog row knows the session; only push rows carry the live
              // request id, so without one we open the conversation itself.
              if (item.requestId && (item.kind === 'approval' || item.kind === 'question')) {
                router.push(`/approval/${encodeURIComponent(item.requestId)}`)
              } else if (item.sessionId) {
                router.push(`/chat/${encodeURIComponent(item.sessionId)}`)
              }
            }}
            style={({ pressed }) => ({
              marginHorizontal: 12,
              marginBottom: 8,
              backgroundColor: pressed ? theme.hover : theme.card,
              borderRadius: 14,
              borderWidth: theme.hairline,
              borderColor: theme.cardBorder,
              padding: 14,
              gap: 5,
              opacity: item.read ? 0.62 : 1,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.textWeak, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 }}>
                {LABEL[item.kind] ?? item.kind}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={{ color: theme.textWeak, fontSize: 11 }}>{relativeTime(item.at)}</Text>
              {/* The dot marks the row, not the label — keep it on the card edge. */}
              {!item.read ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.ink }} /> : null}
            </View>
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{item.title}</Text>
            {item.body ? (
              <Text numberOfLines={2} style={{ color: theme.textWeak, fontSize: 13, lineHeight: 19 }}>{item.body}</Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}
