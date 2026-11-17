/**
 * Session list (20261115-mobile.md §4.2 P0, §4.3).
 *
 * The phone's version of the desktop sidebar conversation list: rows on the
 * surface colour, a hairline separator, the title in strong text and the last
 * line of the conversation in weak text. Cached rows paint first; pulling
 * refreshes from the desktop.
 */

import { useCallback, useMemo, useState } from 'react'
import { Pressable, RefreshControl, Text, View, useColorScheme } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'

import { Banner } from '../../src/components/Banner'
import { ChatIcon, PlusIcon } from '../../src/components/icons'
import { canRun } from '../../src/core/surface'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'
import type { CachedSession } from '../../src/db/cache'

function relative(ms: number): string {
  const delta = Date.now() - ms
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return `${Math.floor(delta / 86_400_000)} 天前`
}

export default function SessionsScreen() {
  const theme = themeFor(useColorScheme())
  const capabilities = useApp(state => state.capabilities)
  const sessions = useApp(state => state.sessions)
  const refresh = useApp(state => state.refreshSessions)
  const createSession = useApp(state => state.createSession)
  const connection = useApp(state => state.connection)
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)

  // A new task starts on the computer: the phone asks it for the working
  // directory and opens the session it creates.
  const startNewTask = async () => {
    if (creating) return
    setCreating(true)
    try {
      const sessionId = await createSession()
      if (sessionId) router.push(`/chat/${encodeURIComponent(sessionId)}`)
    } finally {
      setCreating(false)
    }
  }

  // The desktop sidebar groups the list; the phone keeps the same two groups
  // with a quiet section label instead of a collapsible tree.
  const groups = useMemo(() => {
    const pinned = sessions.filter(item => item.pinned)
    const rest = sessions.filter(item => !item.pinned)
    const rows: ({ kind: 'label'; id: string; title: string } | { kind: 'session'; id: string; session: CachedSession })[] = []
    if (pinned.length) {
      rows.push({ kind: 'label', id: 'label:pinned', title: '置顶会话' })
      for (const session of pinned) rows.push({ kind: 'session', id: session.id, session })
    }
    if (rest.length) {
      rows.push({ kind: 'label', id: 'label:recent', title: pinned.length ? '其他会话' : '最近会话' })
      for (const session of rest) rows.push({ kind: 'session', id: session.id, session })
    }
    return rows
  }, [sessions])

  const canCreate = canRun(capabilities, 'agent_new_session') && canRun(capabilities, 'agent_init')

  const renderItem = useCallback(({ item }: { item: { kind: 'label'; id: string; title: string } | { kind: 'session'; id: string; session: CachedSession } }) => {
    if (item.kind === 'label') {
      return (
        <Text style={{ color: theme.textWeak, fontSize: 12, fontWeight: '600', paddingHorizontal: theme.gutter, paddingTop: 14, paddingBottom: 4 }}>
          {item.title}
        </Text>
      )
    }
    const session = item.session
    return (
    <Pressable
      onPress={() => router.push(`/chat/${encodeURIComponent(item.id)}`)}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.hover : theme.surface,
        paddingHorizontal: theme.gutter,
        paddingVertical: 13,
        borderBottomWidth: theme.hairline,
        borderBottomColor: theme.cardBorder,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '500' }}>
          {session.title}
        </Text>
        {session.pinned ? (
          <View style={{ backgroundColor: theme.pressed, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: theme.textMedium, fontSize: 10 }}>置顶</Text>
          </View>
        ) : null}
        <Text style={{ color: theme.textWeak, fontSize: 11 }}>{relative(session.updatedAt)}</Text>
      </View>
      {session.preview ? (
        <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 13, marginTop: 3 }}>
          {session.preview}
        </Text>
      ) : null}
    </Pressable>
    )
  }, [theme, router])

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <Banner />
      {canCreate ? (
        <Pressable
          onPress={() => void startNewTask()}
          disabled={creating || connection !== 'open'}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginHorizontal: theme.gutter,
            marginTop: 10,
            marginBottom: 4,
            height: 44,
            paddingHorizontal: 14,
            borderRadius: theme.radiusPill,
            backgroundColor: pressed ? theme.pressed : theme.card,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
            opacity: creating || connection !== 'open' ? 0.55 : 1,
          })}
        >
          <PlusIcon size={17} color={theme.text} />
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
            {creating ? '正在新建…' : '新建任务'}
          </Text>
          <Text style={{ flex: 1, color: theme.textWeak, fontSize: 12, textAlign: 'right' }}>在电脑上执行</Text>
        </Pressable>
      ) : null}
      {sessions.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
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
            <ChatIcon size={26} color={theme.textWeak} />
          </View>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>还没有会话</Text>
          <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            在电脑上开始一个会话，{'\n'}它会出现在这里，对话过程实时同步。
          </Text>
        </View>
      ) : (
        <FlashList
          data={groups}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              tintColor={theme.textMedium}
              enabled={connection === 'open'}
              onRefresh={async () => {
                setRefreshing(true)
                await refresh()
                setRefreshing(false)
              }}
            />
          )}
        />
      )}
    </View>
  )
}
