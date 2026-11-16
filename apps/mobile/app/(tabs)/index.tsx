/**
 * Session list (20261115-mobile.md §4.2 P0, §4.3).
 *
 * The phone's version of the desktop sidebar conversation list: rows on the
 * surface colour, a hairline separator, the title in strong text and the last
 * line of the conversation in weak text. Cached rows paint first; pulling
 * refreshes from the desktop.
 */

import { useCallback, useState } from 'react'
import { Pressable, RefreshControl, Text, View, useColorScheme } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'

import { Banner } from '../../src/components/Banner'
import { ChatIcon } from '../../src/components/icons'
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
  const sessions = useApp(state => state.sessions)
  const refresh = useApp(state => state.refreshSessions)
  const connection = useApp(state => state.connection)
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  const renderItem = useCallback(({ item }: { item: CachedSession }) => (
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
          {item.title}
        </Text>
        {item.pinned ? (
          <View style={{ backgroundColor: theme.pressed, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: theme.textMedium, fontSize: 10 }}>置顶</Text>
          </View>
        ) : null}
        <Text style={{ color: theme.textWeak, fontSize: 11 }}>{relative(item.updatedAt)}</Text>
      </View>
      {item.preview ? (
        <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 13, marginTop: 3 }}>
          {item.preview}
        </Text>
      ) : null}
    </Pressable>
  ), [theme, router])

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <Banner />
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
          data={sessions}
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
