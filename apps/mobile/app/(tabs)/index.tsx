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
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, Text, TextInput, View, useColorScheme,
} from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Banner } from '../../src/components/Banner'
import { ChatIcon, PlusIcon } from '../../src/components/icons'
import { canRun } from '../../src/core/surface'
import {
  archivedCount, cleanSessionTitle, groupSessions, MAX_TITLE_LENGTH, sessionActions,
  type SessionActionKey, type SessionRow,
} from '../../src/core/session-actions'
import { unreadLabel } from '../../src/core/unread'
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
  const connection = useApp(state => state.connection)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [menu, setMenu] = useState<CachedSession | null>(null)
  const [renaming, setRenaming] = useState<CachedSession | null>(null)
  const [renameText, setRenameText] = useState('')

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

  const can = useCallback((command: string) => canRun(capabilities, command), [capabilities])
  const manageable = ['agent_set_session_pinned', 'agent_rename_session', 'agent_set_session_archived', 'agent_delete_session'].some(can)

  // The desktop sidebar groups the list; the phone keeps the same two groups
  // with a quiet section label instead of a collapsible tree.
  const groups = useMemo(() => groupSessions(sessions, showArchived), [sessions, showArchived])
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

  const canCreate = canRun(capabilities, 'agent_new_session') && canRun(capabilities, 'agent_init')

  const renderItem = useCallback(({ item }: { item: SessionRow }) => {
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
      onLongPress={manageable ? () => setMenu(session) : undefined}
      delayLongPress={350}
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
        <Text style={{ color: theme.textWeak, fontSize: 11 }}>{relative(session.updatedAt)}</Text>
      </View>
      {session.preview ? (
        <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 13, marginTop: 3 }}>
          {session.preview}
        </Text>
      ) : null}
    </Pressable>
    )
  }, [theme, router, manageable, setMenu])

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
    </View>
  )
}
