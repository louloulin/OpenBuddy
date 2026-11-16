/**
 * Chat (20261115-mobile.md §4.2 P0, §4.3, §5.4).
 *
 * Layout follows the desktop conversation view: an 800px column becomes the
 * full width on a phone, a compact in-flow header replaces the window title bar,
 * a pending approval sits above the transcript as a card, and the composer is a
 * floating card at the bottom. The list is inverted so streaming tokens append
 * at the visual bottom without moving the thumb.
 */

import { useEffect, useMemo } from 'react'
import { Pressable, Text, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { Composer } from '../../src/components/Composer'
import { MessageRow } from '../../src/components/MessageRow'
import { CheckIcon, ChevronRightIcon, CloseIcon, SparkIcon } from '../../src/components/icons'
import { emptyTranscript, type TranscriptRow } from '../../src/core/transcript'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

export default function ChatScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ sessionId: string }>()
  const sessionId = decodeURIComponent(params.sessionId ?? '')

  const transcript = useApp(state => state.transcripts[sessionId]) ?? emptyTranscript()
  const session = useApp(state => state.sessions.find(item => item.id === sessionId))
  const openSession = useApp(state => state.openSession)
  const send = useApp(state => state.send)
  const sendImage = useApp(state => state.sendImage)
  const approvals = useApp(state => state.approvals.filter(item => !item.sessionId || item.sessionId === sessionId))
  const resolveApproval = useApp(state => state.resolveApproval)

  useEffect(() => {
    if (sessionId) void openSession(sessionId)
  }, [sessionId, openSession])

  // Newest first for the inverted list; memo keeps identity stable per change.
  const data = useMemo(() => [...transcript.rows].reverse(), [transcript.rows])
  const streaming = transcript.rows.some(row => row.kind === 'text' && row.streaming)

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, paddingTop: insets.top }}>
      {/* In-flow header, like the desktop's `.main-topbar`: no shadow, one line. */}
      <View
        style={{
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          borderBottomWidth: theme.hairline,
          borderBottomColor: theme.cardBorder,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? theme.pressed : 'transparent',
          })}
        >
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <ChevronRightIcon size={18} color={theme.text} />
          </View>
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
          {session?.title ?? '会话'}
        </Text>
      </View>

      {approvals.length > 0 ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 10 }}>
          {approvals.map(approval => (
            <View
              key={approval.requestId}
              style={{
                backgroundColor: theme.card,
                borderRadius: 16,
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                padding: 14,
                gap: 10,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <SparkIcon size={16} color={theme.warning} />
                <Text style={{ flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' }}>{approval.title}</Text>
              </View>
              {approval.detail ? (
                <Text style={{ color: theme.textMedium, fontSize: 13, lineHeight: 20 }} selectable>
                  {approval.detail}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => void resolveApproval(approval.requestId, false)}
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 38,
                    borderRadius: theme.radiusPill,
                    backgroundColor: pressed ? theme.pressed : theme.card,
                    borderWidth: theme.hairline,
                    borderColor: theme.cardBorder,
                  })}
                >
                  <CloseIcon size={14} color={theme.danger} />
                  <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>拒绝</Text>
                </Pressable>
                <Pressable
                  onPress={() => void resolveApproval(approval.requestId, true)}
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    height: 38,
                    borderRadius: theme.radiusPill,
                    backgroundColor: theme.ink,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <CheckIcon size={14} color={theme.inkFg} />
                  <Text style={{ color: theme.inkFg, fontSize: 13, fontWeight: '600' }}>允许</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <FlashList
        data={data}
        inverted
        renderItem={({ item }: { item: TranscriptRow }) => <MessageRow row={item} />}
        keyExtractor={row => row.id}
        contentContainerStyle={{ paddingVertical: 6 }}
        ListEmptyComponent={(
          <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
            <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              这个会话还没有消息。发送一条试试。
            </Text>
          </View>
        )}
      />

      <Composer
        streaming={streaming}
        onSend={text => void send(sessionId, text)}
        onImage={(bytes, mime, text) => void sendImage(sessionId, bytes, mime, text)}
        onStop={() => {
          void useApp.getState().transport?.invoke('agent_cancel', { sessionId })
        }}
      />
    </View>
  )
}
