/**
 * Chat (20261115-mobile.md §4.2 P0, §4.3, §5.4).
 *
 * Layout follows the desktop conversation view: an 800px column becomes the
 * full width on a phone, a compact in-flow header replaces the window title bar,
 * a pending approval sits above the transcript as a card, and the composer is a
 * floating card at the bottom. The list is inverted so streaming tokens append
 * at the visual bottom without moving the thumb.
 */

import { useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View, useColorScheme, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FlashList } from '@shopify/flash-list'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { Composer } from '../../src/components/Composer'
import { RequestCard } from '../../src/components/RequestCard'
import { LoadingRow } from '../../src/components/LoadingRow'
import { MessageRow } from '../../src/components/MessageRow'
import { ChevronRightIcon, SparkIcon } from '../../src/components/icons'
import { emptyTranscript, isTurnPending, type TranscriptRow, type ToolRow } from '../../src/core/transcript'
import { thinkingLevelLabel } from '../../src/core/session-panel'
import { summarizeRevert } from '../../src/core/revert'
import { canRun } from '../../src/core/surface'
import { followUpsFor } from '../../src/core/follow-ups'
import { queueLabel, queueRows } from '../../src/core/turn-input'
import type { ApprovalAction } from '../../src/core/approvals'
import type { Approval } from '../../src/core/models'
import { elapsedLabel, sessionTasks } from '../../src/core/tasks'
import { haptic } from '../../src/native/haptics'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

export default function ChatScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  // Tablets get the desktop's two panes: the session rail stays put while the
  // conversation keeps its own scroll.
  const wide = width >= 768
  const params = useLocalSearchParams<{ sessionId: string }>()
  const sessionId = decodeURIComponent(params.sessionId ?? '')

  const transcript = useApp(state => state.transcripts[sessionId]) ?? emptyTranscript()
  const session = useApp(state => state.sessions.find(item => item.id === sessionId))
  const openSession = useApp(state => state.openSession)
  const setActiveSession = useApp(state => state.setActiveSession)
  const send = useApp(state => state.send)
  const steer = useApp(state => state.steer)
  const removeQueued = useApp(state => state.removeQueued)
  const queue = useApp(state => state.queues[sessionId])
  const prefill = useApp(state => state.drafts[sessionId])
  const setDraft = useApp(state => state.setDraft)
  const sendImage = useApp(state => state.sendImage)
  const sendImages = useApp(state => state.sendImages)
  const approvals = useApp(state => state.approvals.filter(item => !item.sessionId || item.sessionId === sessionId))
  const resolveApproval = useApp(state => state.resolveApproval)
  const resolveQuestion = useApp(state => state.resolveQuestion)
  const resolveTrust = useApp(state => state.resolveTrust)
  const tasks = useApp(state => state.tasks)
  const refreshTasks = useApp(state => state.refreshTasks)
  const killTask = useApp(state => state.killTask)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [busyRequest, setBusyRequest] = useState<string | null>(null)
  const regenerate = useApp(state => state.regenerate)
  const capabilities = useApp(state => state.capabilities)
  const awaiting = useApp(state => state.awaiting.includes(sessionId))
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [revertNotes, setRevertNotes] = useState<Record<string, string>>({})
  // Quote-reply / edit-resend (P1): both are local; a quote rides as a `>` prefix.
  const [quoted, setQuoted] = useState<string | null>(null)
  const [editToken, setEditToken] = useState(0)
  const [editText, setEditText] = useState('')
  // Composer chip: the session's thinking level, cycled with one tap.
  const thinkingLevel = useApp(state => state.thinkingLevels[sessionId])
  const refreshThinkingLevel = useApp(state => state.refreshThinkingLevel)
  const cycleThinkingLevel = useApp(state => state.cycleThinkingLevel)

  // D5: undo the files one tool call wrote. The desktop owns the checkpoints;
  // the phone reports what it restored and flags conflicts to resolve there.
  const revertTool = async (row: ToolRow) => {
    const transport = useApp.getState().transport
    if (!transport || revertingId) return
    setRevertingId(row.id)
    try {
      const result = await transport.invoke<unknown>('turn_revert', { sessionId, toolCallIds: [row.id] })
      const summary = summarizeRevert(result)
      setRevertNotes(notes => ({ ...notes, [row.id]: summary.message }))
    } catch (error) {
      setRevertNotes(notes => ({
        ...notes,
        [row.id]: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setRevertingId(null)
    }
  }
  const toolActions = canRun(capabilities, 'turn_revert')
    ? {
      onRevert: (row: ToolRow) => void revertTool(row),
      revertingId: revertingId ?? undefined,
      noteFor: (row: ToolRow) => revertNotes[row.id],
    }
    : undefined

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
  // The waiting row is for the gap before the first token. Once text is
  // streaming, its own assistant header is the waiting state; keeping both
  // puts two "OpenBuddy" identities on screen at once.
  const streamingText = transcript.rows.some(row => row.kind === 'text' && row.role === 'assistant' && row.streaming)
  // Kimi / Grok put next-question chips under the finished reply. They only
  // make sense once the turn is over and the answer is the latest one.
  const suggestions = useMemo(
    () => (!streaming && !awaiting && approvals.length === 0 && transcript.lastAssistantText
      ? followUpsFor(transcript.lastAssistantText)
      : []),
    [streaming, awaiting, approvals.length, transcript.lastAssistantText],
  )
  const queued = useMemo(() => queueRows(queue), [queue])
  const sessionTaskRows = useMemo(() => sessionTasks(tasks, sessionId), [tasks, sessionId])

  useEffect(() => {
    if (sessionId) void refreshTasks()
  }, [sessionId, refreshTasks])

  useEffect(() => {
    if (sessionId) void refreshThinkingLevel(sessionId)
  }, [sessionId, refreshThinkingLevel])

  // The handoff draft is read once by the composer; drop it immediately so a
  // later remount does not resurrect text the user already sent or cleared.
  useEffect(() => {
    if (prefill) setDraft(sessionId, '')
  }, [prefill, sessionId, setDraft])

  // Poll only while the drawer is open: running tasks are a foreground view.
  useEffect(() => {
    if (!tasksOpen) return
    const timer = setInterval(() => { void refreshTasks() }, 2000)
    return () => clearInterval(timer)
  }, [tasksOpen, refreshTasks])

  const handleRequest = async (approval: Approval, action: ApprovalAction) => {
    void haptic('approve')
    setBusyRequest(approval.requestId)
    try {
      if (action.type === 'permission') await resolveApproval(approval.requestId, action.approved)
      else if (action.type === 'question') {
        await resolveQuestion(approval.requestId, approval.sessionId ?? sessionId, action.value, action.cancelled)
      } else if (action.type === 'trust' && approval.cwd) {
        await resolveTrust(approval.cwd, action.trusted)
      }
    } finally {
      setBusyRequest(null)
    }
  }

  return (
    <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', backgroundColor: theme.surface }}>
      {wide ? (
        <SessionRail
          theme={theme}
          currentId={sessionId}
          topInset={insets.top}
          onPick={id => router.replace(`/chat/${encodeURIComponent(id)}`)}
        />
      ) : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, paddingTop: insets.top }}
      >
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
          accessibilityLabel="返回"
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

      {transcript.rows.length === 0 && approvals.length === 0 ? (
        // Grok-style empty state: the product name as the hero, then prompts
        // that can be sent with one tap instead of a centred "no messages".
        <View style={{
          flex: 1,
          justifyContent: 'flex-end',
          paddingHorizontal: theme.gutter + 8,
          paddingBottom: 36,
        }}>
          <SparkIcon size={22} color={theme.textWeak} />
          <Text style={{ color: theme.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.4, marginTop: 10 }}>
            OpenBuddy
          </Text>
          <Text style={{ color: theme.textWeak, fontSize: 14, marginTop: 6, lineHeight: 20 }}>
            把任务发过来，在电脑上执行。
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
            {['总结一下今天的改动', '把计划里的未完成项列出来', '这段代码为什么慢？'].map(text => (
              <Pressable
                key={text}
                onPress={() => void send(sessionId, text)}
                style={({ pressed }) => ({
                  borderWidth: theme.hairline,
                  borderColor: theme.cardBorder,
                  borderRadius: theme.radiusPill,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  backgroundColor: pressed ? theme.pressed : 'transparent',
                })}
              >
                <Text style={{ color: theme.textMedium, fontSize: 13 }}>{text}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <FlashList
          data={data}
          inverted
          style={{ flex: 1 }}
          renderItem={({ item }: { item: ChatItem }) => (item.kind === 'approval'
            ? (
              <RequestCard
                approval={item.approval}
                busy={busyRequest === item.approval.requestId}
                onAction={action => void handleRequest(item.approval, action)}
              />
            )
            : (
              <MessageRow
                row={item}
                onRegenerate={() => void regenerate(sessionId)}
                toolActions={toolActions}
                onQuote={text => setQuoted(text)}
                onEdit={text => { setQuoted(null); setEditText(text); setEditToken(token => token + 1) }}
              />
            ))}
          keyExtractor={row => row.id}
          contentContainerStyle={{ paddingVertical: 6 }}
        />
      )}

      {sessionTaskRows.length ? (
        <Pressable
          onPress={() => { setTasksOpen(true); void refreshTasks() }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            marginHorizontal: theme.gutter,
            paddingVertical: 7,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ flex: 1, color: theme.textMedium, fontSize: 12 }}>
            运行中 {sessionTaskRows.length}
          </Text>
          <Text style={{ color: theme.textWeak, fontSize: 12 }}>
            {elapsedLabel(Math.min(...sessionTaskRows.map(task => task.startedAt ?? Date.now())))}
          </Text>
        </Pressable>
      ) : null}

      {queued.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: theme.gutter, paddingVertical: 6 }}
        >
          {queued.map(row => (
            <View
              key={`${row.kind}-${row.index}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                borderRadius: theme.radiusPill,
                paddingLeft: 10,
                paddingRight: 6,
                paddingVertical: 6,
                backgroundColor: theme.card,
              }}
            >
              <Text style={{ color: theme.textWeak, fontSize: 10 }}>{queueLabel(row.kind)}</Text>
              <Text numberOfLines={1} style={{ maxWidth: 160, color: theme.textMedium, fontSize: 12 }}>{row.text}</Text>
              <Pressable onPress={() => void removeQueued(sessionId, row)} hitSlop={8} accessibilityLabel="移除排队消息">
                <Text style={{ color: theme.textWeak, fontSize: 13 }}>×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {suggestions.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 8, paddingHorizontal: theme.gutter, paddingVertical: 6 }}
        >
          {suggestions.map(text => (
            <Pressable
              key={text}
              onPress={() => void send(sessionId, text)}
              style={({ pressed }) => ({
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                borderRadius: theme.radiusPill,
                paddingHorizontal: 12,
                paddingVertical: 7,
                backgroundColor: pressed ? theme.pressed : 'transparent',
              })}
            >
              <Text style={{ color: theme.textMedium, fontSize: 12 }}>{text}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {!streamingText && (awaiting || (streaming && transcript.rows.every(row => row.kind === 'thinking' || (row.kind === 'text' && row.role === 'user')))) ? (
        <LoadingRow />
      ) : null}

      <Composer
        streaming={streaming}
        initialDraft={prefill ?? ''}
        quoted={quoted}
        onClearQuote={() => setQuoted(null)}
        prefill={editToken ? { text: editText, token: editToken } : undefined}
        thinkingLabel={canRun(capabilities, 'agent_set_thinking_level')
          ? (thinkingLevel ? thinkingLevelLabel(thinkingLevel) : '跟随')
          : undefined}
        onCycleThinking={canRun(capabilities, 'agent_set_thinking_level')
          ? () => { void cycleThinkingLevel(sessionId) }
          : undefined}
        onSend={text => void send(sessionId, text)}
        onImage={(bytes, mime, text) => void sendImage(sessionId, bytes, mime, text)}
        onImages={(images, text) => void sendImages(sessionId, images, text)}
        onSteer={text => void steer(sessionId, text)}
        onStop={() => {
          void haptic('stop')
          void useApp.getState().transport?.invoke('agent_cancel', { sessionId })
        }}
      />

      <Modal visible={tasksOpen} transparent animationType="fade" onRequestClose={() => setTasksOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }}
            onPress={() => setTasksOpen(false)}
          />
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingHorizontal: theme.gutter,
            paddingTop: 14,
            paddingBottom: 30,
            gap: 4,
          }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 6 }}>运行中的任务</Text>
            {sessionTaskRows.length === 0 ? (
              <Text style={{ color: theme.textWeak, fontSize: 13, paddingVertical: 12 }}>没有运行中的任务。</Text>
            ) : (
              // A busy turn can spawn many children; keep the sheet on-screen.
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                {sessionTaskRows.map(task => (
                  <View
                    key={task.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 12,
                      borderTopWidth: theme.hairline,
                      borderTopColor: theme.cardBorder,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 }}>{task.title || task.description || task.id}</Text>
                      <Text style={{ color: theme.textWeak, fontSize: 12, marginTop: 2 }}>
                        {[task.kind, elapsedLabel(task.startedAt), task.pending ? `待确认 ${task.pending}` : ''].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Pressable onPress={() => void killTask(task.id)} hitSlop={8}>
                      <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>结束</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
            <Pressable
              onPress={() => setTasksOpen(false)}
              style={({ pressed }) => ({
                marginTop: 10,
                paddingVertical: 12,
                borderRadius: theme.radiusPill,
                backgroundColor: pressed ? theme.pressed : theme.card,
                alignItems: 'center',
              })}
            >
              <Text style={{ color: theme.textMedium, fontSize: 14, fontWeight: '600' }}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      </KeyboardAvoidingView>
    </View>
  )
}

/** Tablet rail: the session list the phone shows in its own tab. */
function SessionRail({
  theme, currentId, topInset, onPick,
}: {
  theme: ReturnType<typeof themeFor>
  currentId: string
  topInset: number
  onPick: (sessionId: string) => void
}) {
  const sessions = useApp(state => state.sessions)
  return (
    <View
      style={{
        width: 280,
        paddingTop: topInset + 16,
        paddingBottom: 16,
        borderRightWidth: theme.hairline,
        borderRightColor: theme.cardBorder,
        backgroundColor: theme.surface,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700', paddingHorizontal: 16, marginBottom: 10 }}>
        会话
      </Text>
      <ScrollView>
        {sessions.map(session => {
          const active = session.id === currentId
          return (
            <Pressable
              key={session.id}
              onPress={() => onPick(session.id)}
              accessibilityLabel={`切换到 ${session.title}`}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 10,
                backgroundColor: active ? theme.pressed : pressed ? theme.hover : 'transparent',
              })}
            >
              <Text numberOfLines={1} style={{ color: active ? theme.text : theme.textMedium, fontSize: 14, fontWeight: active ? '600' : '400' }}>
                {session.title}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
    </View>
  )
}
