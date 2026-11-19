/**
 * Session list (20261115-mobile.md §4.2 P0, §4.3).
 *
 * The phone's version of the desktop sidebar conversation list: rows on the
 * surface colour, a hairline separator, the title in strong text and the last
 * line of the conversation in weak text. Cached rows paint first; pulling
 * refreshes from the desktop. Long-pressing a row opens the same management
 * menu the desktop has: pin, rename, archive, delete.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useColorScheme,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Banner } from '../../src/components/Banner'
import { ChatIcon, CheckIcon, PlusIcon } from '../../src/components/icons'
import { batchSummary, toggleSelection } from '../../src/core/batch'
import { haptic } from '../../src/native/haptics'
import { canRun } from '../../src/core/surface'
import {
  archivedCount, cleanSessionTitle, groupSessions, MAX_TITLE_LENGTH, sessionActions,
  type SessionActionKey, type SessionRow,
} from '../../src/core/session-actions'
import { unreadLabel } from '../../src/core/unread'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'
import { relativeTime } from '../../src/core/relative-time'
import type { CachedSession } from '../../src/db/cache'

const SHEET_BACKDROP = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }

export default function SessionsScreen() {
  const theme = themeFor(useColorScheme())
  const capabilities = useApp(state => state.capabilities)
  const sessions = useApp(state => state.sessions)
  const refresh = useApp(state => state.refreshSessions)
  const createSession = useApp(state => state.createSession)
  const setSessionPinned = useApp(state => state.setSessionPinned)
  const renameSession = useApp(state => state.renameSession)
  const setSessionArchived = useApp(state => state.setSessionArchived)
  const deleteSession = useApp(state => state.deleteSession)
  const archiveSessions = useApp(state => state.archiveSessions)
  const deleteSessions = useApp(state => state.deleteSessions)
  const workspaces = useApp(state => state.workspaces)
  const refreshWorkspaces = useApp(state => state.refreshWorkspaces)
  const forkSession = useApp(state => state.forkSession)
  const handoffSession = useApp(state => state.handoffSession)
  const compactSession = useApp(state => state.compactSession)
  const setDraft = useApp(state => state.setDraft)
  const connection = useApp(state => state.connection)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [workspaceSheet, setWorkspaceSheet] = useState(false)
  const [handoffTarget, setHandoffTarget] = useState<CachedSession | null>(null)
  const [handoffGoal, setHandoffGoal] = useState('')
  const [opsBusy, setOpsBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [menu, setMenu] = useState<CachedSession | null>(null)
  const [renaming, setRenaming] = useState<CachedSession | null>(null)
  const [renameText, setRenameText] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [batchNote, setBatchNote] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const projects = useApp(state => state.projects)

  // A new task starts on the computer: the phone asks it for the working
  // directory and opens the session it creates.
  const startNewTask = async () => {
    if (creating) return
    setCreating(true)
    try {
      await refreshWorkspaces()
      setWorkspaceSheet(true)
    } finally {
      setCreating(false)
    }
  }

  const createIn = async (cwd?: string) => {
    if (creating) return
    setWorkspaceSheet(false)
    setCreating(true)
    try {
      const sessionId = await createSession(cwd)
      if (sessionId) router.push(`/chat/${encodeURIComponent(sessionId)}`)
    } finally {
      setCreating(false)
    }
  }

  const forkTarget = async (session: CachedSession) => {
    if (opsBusy) return
    setOpsBusy(true)
    try {
      const forked = await forkSession(session.id)
      if (forked) router.push(`/chat/${encodeURIComponent(forked)}`)
    } finally {
      setOpsBusy(false)
    }
  }

  const handoff = async () => {
    if (!handoffTarget || opsBusy) return
    setOpsBusy(true)
    try {
      const result = await handoffSession(handoffTarget.id, handoffGoal.trim())
      if (!result) return
      setHandoffTarget(null)
      setHandoffGoal('')
      if (result.prompt) setDraft(result.sessionId, result.prompt)
      router.push(`/chat/${encodeURIComponent(result.sessionId)}`)
    } finally {
      setOpsBusy(false)
    }
  }

  const compactTarget = (session: CachedSession) => {
    Alert.alert(
      '压缩这段上下文？',
      '桌面会把较早的对话总结成摘要，保留最近的消息。无法撤销。',
      [
        { text: '取消', style: 'cancel' },
        { text: '压缩', onPress: () => { void compactSession(session.id) } },
      ],
    )
  }

  const can = useCallback((command: string) => canRun(capabilities, command), [capabilities])
  // The menu is worth opening for any session operation, not just the four
  // sidebar verbs: a desktop can serve fork/handoff/compact without serving
  // rename, and the long-press must still work there.
  const manageable = [
    'agent_set_session_pinned', 'agent_rename_session', 'agent_set_session_archived', 'agent_delete_session',
    'agent_fork_session', 'agent_handoff', 'agent_compact',
  ].some(can)

  // The desktop sidebar groups the list; the phone keeps the same two groups
  // with a quiet section label instead of a collapsible tree.
  const groups = useMemo(
    () => groupSessions(sessions, showArchived, { projects, collapsed }),
    [sessions, showArchived, projects, collapsed],
  )
  const toggleCollapsed = useCallback((labelId: string) => {
    setCollapsed(list => list.includes(labelId) ? list.filter(id => id !== labelId) : [...list, labelId])
  }, [])
  const archived = useMemo(() => archivedCount(sessions), [sessions])

  const runAction = (session: CachedSession, key: SessionActionKey) => {
    setMenu(null)
    switch (key) {
      case 'pin':
      case 'unpin':
        void setSessionPinned(session.id, key === 'pin')
        break
      case 'rename':
        setRenameText(session.title)
        setRenaming(session)
        break
      case 'archive':
      case 'unarchive':
        void setSessionArchived(session.id, key === 'archive')
        break
      case 'delete':
        Alert.alert(
          '删除这个会话？',
          `「${session.title}」会从电脑和手机上一起移除，无法撤销。`,
          [
            { text: '取消', style: 'cancel' },
            { text: '删除', style: 'destructive', onPress: () => { void deleteSession(session.id) } },
          ],
        )
        break
    }
  }

  const saveRename = () => {
    const clean = cleanSessionTitle(renameText)
    if (!renaming || !clean) return
    setRenaming(null)
    void renameSession(renaming.id, clean)
  }

  const leaveSelectMode = () => {
    setSelectMode(false)
    setSelected([])
  }

  const runBatch = async (kind: 'archive' | 'delete') => {
    if (!selected.length) return
    const ids = [...selected]
    const outcome = kind === 'archive' ? await archiveSessions(ids, true) : await deleteSessions(ids)
    setBatchNote(batchSummary(kind === 'archive' ? '已归档' : '已删除', outcome))
    leaveSelectMode()
  }

  // Alert buttons are ignored on the web build, so the browser path runs the
  // action directly; native keeps the destructive confirmation.
  const confirmBatchDelete = () => {
    if (!selected.length) return
    if (Platform.OS === 'web') {
      void runBatch('delete')
      return
    }
    Alert.alert(
      '删除选中的会话？',
      `${selected.length} 个会话会从电脑和手机上一起移除，无法撤销。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => { void runBatch('delete') } },
      ],
    )
  }

  const canCreate = canRun(capabilities, 'agent_new_session') && canRun(capabilities, 'agent_init')
  const canArchiveBatch = canRun(capabilities, 'agent_set_session_archived')
  const canDeleteBatch = canRun(capabilities, 'agent_delete_session')

  const renderItem = useCallback(({ item }: { item: SessionRow }) => {
    if (item.kind === 'label') {
      return (
        <Pressable
          disabled={!item.collapsible}
          onPress={() => toggleCollapsed(item.id)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: theme.gutter,
            paddingTop: 14,
            paddingBottom: 4,
            opacity: pressed && item.collapsible ? 0.6 : 1,
          })}
        >
          <Text style={{ color: theme.textWeak, fontSize: 12, fontWeight: '600' }}>
            {item.title}{item.count ? ` · ${item.count}` : ''}
          </Text>
          {item.collapsible ? (
            <Text style={{ marginLeft: 'auto', color: theme.textWeak, fontSize: 11 }}>
              {item.collapsed ? '展开' : '收起'}
            </Text>
          ) : null}
        </Pressable>
      )
    }
    const session = item.session
    const isSelected = selectMode && selected.includes(item.id)
    return (
    <Pressable
      onPress={() => {
        if (selectMode) setSelected(list => toggleSelection(list, item.id))
        else router.push(`/chat/${encodeURIComponent(item.id)}`)
      }}
      onLongPress={manageable && !selectMode ? () => { void haptic('longPress'); setMenu(session) } : undefined}
      delayLongPress={350}
      style={({ pressed }) => ({
        backgroundColor: isSelected ? theme.pressed : pressed ? theme.hover : theme.surface,
        paddingHorizontal: theme.gutter,
        paddingVertical: 13,
        borderBottomWidth: theme.hairline,
        borderBottomColor: theme.cardBorder,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {selectMode ? (
          <View style={{
            width: 19,
            height: 19,
            borderRadius: 10,
            borderWidth: theme.hairline,
            borderColor: isSelected ? theme.ink : theme.cardBorder,
            backgroundColor: isSelected ? theme.ink : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {isSelected ? <CheckIcon size={12} color={theme.inkFg} strokeWidth={2.6} /> : null}
          </View>
        ) : null}
        <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '500' }}>
          {session.title}
        </Text>
        {session.pinned ? (
          <View style={{ backgroundColor: theme.pressed, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: theme.textMedium, fontSize: 10 }}>置顶</Text>
          </View>
        ) : null}
        {session.archived ? (
          <View style={{ backgroundColor: theme.pressed, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
            <Text style={{ color: theme.textWeak, fontSize: 10 }}>归档</Text>
          </View>
        ) : null}
        {session.unread > 0 ? (
          <View style={{
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 5,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.ink,
          }}>
            <Text style={{ color: theme.inkFg, fontSize: 10, fontWeight: '700' }}>{unreadLabel(session.unread)}</Text>
          </View>
        ) : null}
        <Text style={{ color: theme.textWeak, fontSize: 11 }}>{relativeTime(session.updatedAt)}</Text>
      </View>
      {session.preview ? (
        <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 13, marginTop: 3 }}>
          {session.preview}
        </Text>
      ) : null}
    </Pressable>
    )
  }, [theme, router, manageable, setMenu, selectMode, selected, collapsed, toggleCollapsed])

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      <View style={{
        paddingTop: insets.top + 10,
        paddingHorizontal: theme.gutter,
        paddingBottom: 2,
        flexDirection: 'row',
        alignItems: 'flex-end',
      }}>
        <Text style={{ color: theme.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 }}>会话</Text>
        <Text style={{ marginLeft: 'auto', marginBottom: 4, color: theme.textWeak, fontSize: 12 }}>
          {connection === 'open' ? '电脑在线' : connection === 'connecting' ? '连接中' : '已断开'}
        </Text>
        {canArchiveBatch || canDeleteBatch ? (
          <Pressable
            onPress={() => {
              setSelectMode(value => !value)
              setSelected([])
              setBatchNote(null)
            }}
            hitSlop={10}
            style={{ marginLeft: 12, marginBottom: 2 }}
          >
            <Text style={{ color: theme.textMedium, fontSize: 13, fontWeight: '600' }}>
              {selectMode ? '取消' : '选择'}
            </Text>
          </Pressable>
        ) : null}
      </View>
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
      {batchNote ? (
        <Text style={{ marginHorizontal: theme.gutter, marginTop: 8, color: theme.textWeak, fontSize: 12 }}>
          {batchNote}
        </Text>
      ) : null}
      {archived > 0 ? (
        <Pressable
          onPress={() => setShowArchived(value => !value)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            marginHorizontal: theme.gutter,
            paddingVertical: 8,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ flex: 1, color: theme.textWeak, fontSize: 12 }}>已归档（{archived}）</Text>
          <Text style={{ color: theme.textMedium, fontSize: 12 }}>{showArchived ? '收起' : '显示'}</Text>
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

      {/* Multi-select bar: one desktop call per row, failures summarised. */}
      {selectMode ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            borderTopWidth: theme.hairline,
            borderTopColor: theme.cardBorder,
            backgroundColor: theme.card,
            paddingHorizontal: theme.gutter,
            paddingVertical: 10,
          }}
        >
          <Text style={{ flex: 1, color: theme.textMedium, fontSize: 13 }}>已选 {selected.length} 个</Text>
          {canArchiveBatch ? (
            <Pressable
              disabled={selected.length === 0}
              onPress={() => void runBatch('archive')}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: theme.radiusPill,
                backgroundColor: pressed ? theme.pressed : theme.surface,
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                opacity: selected.length ? 1 : 0.45,
              })}
            >
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>归档</Text>
            </Pressable>
          ) : null}
          {canDeleteBatch ? (
            <Pressable
              disabled={selected.length === 0}
              onPress={confirmBatchDelete}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: theme.radiusPill,
                backgroundColor: pressed ? theme.pressed : theme.surface,
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                opacity: selected.length ? 1 : 0.45,
              })}
            >
              <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>删除</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Long-press menu: the desktop sidebar's actions, in the same order. */}
      <Modal visible={menu !== null} transparent animationType="fade" onRequestClose={() => setMenu(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SHEET_BACKDROP} onPress={() => setMenu(null)} />
          <View style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingHorizontal: theme.gutter,
            paddingTop: 16,
            paddingBottom: 30,
          }}>
            <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 12, marginBottom: 6 }}>
              {menu?.title}
            </Text>
            {menu ? sessionActions(menu, can).map(action => (
              <Pressable
                key={action.key}
                onPress={() => runAction(menu, action.key)}
                style={({ pressed }) => ({
                  paddingVertical: 14,
                  borderTopWidth: theme.hairline,
                  borderTopColor: theme.cardBorder,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ color: action.destructive ? theme.danger : theme.text, fontSize: 16 }}>
                  {action.label}
                </Text>
              </Pressable>
            )) : null}
            {menu && canRun(capabilities, 'agent_fork_session') ? (
              <Pressable
                onPress={() => { const target = menu; setMenu(null); void forkTarget(target) }}
                style={({ pressed }) => ({ paddingVertical: 14, borderTopWidth: theme.hairline, borderTopColor: theme.cardBorder, opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ color: theme.text, fontSize: 16 }}>分叉会话</Text>
              </Pressable>
            ) : null}
            {menu && canRun(capabilities, 'agent_handoff') ? (
              <Pressable
                onPress={() => { setHandoffTarget(menu); setHandoffGoal(''); setMenu(null) }}
                style={({ pressed }) => ({ paddingVertical: 14, borderTopWidth: theme.hairline, borderTopColor: theme.cardBorder, opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ color: theme.text, fontSize: 16 }}>交接到新任务</Text>
              </Pressable>
            ) : null}
            {menu && canRun(capabilities, 'agent_compact') ? (
              <Pressable
                onPress={() => { const target = menu; setMenu(null); compactTarget(target) }}
                style={({ pressed }) => ({ paddingVertical: 14, borderTopWidth: theme.hairline, borderTopColor: theme.cardBorder, opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ color: theme.text, fontSize: 16 }}>压缩上下文</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setMenu(null)}
              style={({ pressed }) => ({
                marginTop: 10,
                paddingVertical: 13,
                borderRadius: theme.radiusPill,
                backgroundColor: theme.card,
                alignItems: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: theme.textMedium, fontSize: 15, fontWeight: '600' }}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Rename is a sheet rather than Alert.prompt so Android gets it too. */}
      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.35)' }}
        >
          <View style={{
            backgroundColor: theme.card,
            borderRadius: 14,
            padding: 18,
            gap: 12,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
          }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>重命名会话</Text>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              maxLength={MAX_TITLE_LENGTH}
              returnKeyType="done"
              onSubmitEditing={saveRename}
              placeholder="会话名称"
              placeholderTextColor={theme.textWeak}
              style={{
                color: theme.text,
                fontSize: 15,
                backgroundColor: theme.surface,
                borderRadius: 8,
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18 }}>
              <Pressable onPress={() => setRenaming(null)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: theme.textWeak, fontSize: 15 }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={saveRename}
                disabled={!cleanSessionTitle(renameText)}
                style={({ pressed }) => ({ opacity: pressed || !cleanSessionTitle(renameText) ? 0.5 : 1 })}
              >
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>保存</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* New task: pick the folder the desktop should work in. */}
      <Modal visible={workspaceSheet} transparent animationType="fade" onRequestClose={() => setWorkspaceSheet(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={SHEET_BACKDROP} onPress={() => setWorkspaceSheet(false)} />
          <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: theme.gutter, paddingTop: 14, paddingBottom: 30 }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>在哪里开始？</Text>
            <Text style={{ color: theme.textWeak, fontSize: 12, marginBottom: 8 }}>选择电脑上的一个工作目录。</Text>
            {workspaces.length === 0 ? (
              <Pressable onPress={() => void createIn()} style={({ pressed }) => ({ paddingVertical: 14, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: theme.text, fontSize: 15 }}>使用桌面当前目录</Text>
              </Pressable>
            ) : (
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                {workspaces.map(choice => (
                  <Pressable
                    key={choice.cwd}
                    onPress={() => void createIn(choice.cwd)}
                    style={({ pressed }) => ({ paddingVertical: 12, borderTopWidth: theme.hairline, borderTopColor: theme.cardBorder, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 }}>{choice.label}</Text>
                    {choice.detail ? <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 12, marginTop: 2 }}>{choice.detail}</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable
              onPress={() => setWorkspaceSheet(false)}
              style={({ pressed }) => ({ marginTop: 10, paddingVertical: 12, borderRadius: theme.radiusPill, backgroundColor: pressed ? theme.pressed : theme.card, alignItems: 'center' })}
            >
              <Text style={{ color: theme.textMedium, fontSize: 14, fontWeight: '600' }}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Handoff: what should the new task focus on? */}
      <Modal visible={handoffTarget !== null} transparent animationType="fade" onRequestClose={() => setHandoffTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <View style={{ backgroundColor: theme.card, borderRadius: 14, padding: 18, gap: 12, borderWidth: theme.hairline, borderColor: theme.cardBorder }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>交接到新任务</Text>
            <Text style={{ color: theme.textWeak, fontSize: 12, lineHeight: 18 }}>
              电脑会创建新会话，并把当前进展整理成草稿。这个目标会写进草稿。
            </Text>
            <TextInput
              value={handoffGoal}
              onChangeText={setHandoffGoal}
              autoFocus
              placeholder="例如：继续把并发压测补完"
              placeholderTextColor={theme.textWeak}
              style={{
                color: theme.text,
                fontSize: 14,
                backgroundColor: theme.surface,
                borderRadius: 8,
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18 }}>
              <Pressable onPress={() => setHandoffTarget(null)}><Text style={{ color: theme.textWeak, fontSize: 15 }}>取消</Text></Pressable>
              <Pressable
                onPress={() => void handoff()}
                disabled={opsBusy || !handoffGoal.trim()}
                style={({ pressed }) => ({ opacity: pressed || !handoffGoal.trim() ? 0.5 : 1 })}
              >
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600' }}>创建</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
