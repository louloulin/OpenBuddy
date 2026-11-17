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
import { ApprovalCard } from '../../src/components/ApprovalCard'
import { LoadingRow } from '../../src/components/LoadingRow'
import { MessageRow } from '../../src/components/MessageRow'
import { ChevronRightIcon } from '../../src/components/icons'
import { emptyTranscript, isTurnPending, type TranscriptRow } from '../../src/core/transcript'
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
  const setActiveSession = useApp(state => state.setActiveSession)
  const send = useApp(state => state.send)
  const sendImage = useApp(state => state.sendImage)
  const sendImages = useApp(state => state.sendImages)
  const approvals = useApp(state => state.approvals.filter(item => !item.sessionId || item.sessionId === sessionId))
  const resolveApproval = useApp(state => state.resolveApproval)
  const regenerate = useApp(state => state.regenerate)
  const awaiting = useApp(state => state.awaiting.includes(sessionId))

  useEffect(() => {
    if (sessionId) void openSession(sessionId)
  }, [sessionId, openSession])

  // While this screen is mounted its settles are read, not counted.
  useEffect(() => {
    if (!sessionId) return
    setActiveSession(sessionId)
    return () => setActiveSession(null)
  }, [sessionId, setActiveSession])

  // Approvals sit inline at the newest end, the way the desktop puts a
  // permission dialog inside the conversation rather than over it.
  type ChatItem = TranscriptRow | { kind: 'approval'; id: string; approval: typeof approvals[number] }
  const data = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = transcript.rows.map(row => row)
    for (const approval of approvals) {
      items.push({ kind: 'approval', id: `approval:${approval.requestId}`, approval })
    }
    return items.reverse()
  }, [transcript.rows, approvals])
  const streaming = isTurnPending(transcript)

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
        <Pressable
          onPress={() => router.push(`/session/${encodeURIComponent(sessionId)}`)}
          style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed ? 0.6 : 1 })}
        >
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>
            {session?.title ?? '会话'}
          </Text>
          <ChevronRightIcon size={14} color={theme.textWeak} />
        </Pressable>
      </View>

      <FlashList
        data={data}
        inverted
        renderItem={({ item }: { item: ChatItem }) => (item.kind === 'approval'
          ? (
            <ApprovalCard
              approval={item.approval}
              onResolve={approved => void resolveApproval(item.approval.requestId, approved)}
            />
          )
          : (
            <MessageRow
              row={item}
              onRegenerate={() => void regenerate(sessionId)}
            />
          ))}
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

      {awaiting || (streaming && transcript.rows.every(row => row.kind === 'thinking' || (row.kind === 'text' && row.role === 'user'))) ? (
        <LoadingRow />
      ) : null}

      <Composer
        streaming={streaming}
        onSend={text => void send(sessionId, text)}
        onImage={(bytes, mime, text) => void sendImage(sessionId, bytes, mime, text)}
        onImages={(images, text) => void sendImages(sessionId, images, text)}
        onStop={() => {
          void useApp.getState().transport?.invoke('agent_cancel', { sessionId })
        }}
      />
    </View>
  )
}
