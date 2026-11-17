/**
 * Branches and checkpoints (20261115-mobile.md §4.2 P2).
 *
 * Two different undo surfaces, kept visually apart because they undo different
 * things: a branch switch moves the *conversation* to a sibling version, a
 * checkpoint restore writes *files* back. Both are confirmed first — the phone
 * is a remote control, and a stray tap must not rewrite a desktop workspace.
 *
 * `turn_revert` is deliberately absent: it needs the turn's tool-call ids,
 * which only the desktop's turn view has.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useLocalSearchParams, useNavigation } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BranchTree } from '@openbuddy/protocol/branches'

import { ChevronRightIcon, ClockIcon } from '../../src/components/icons'
import {
  branchLabel,
  branchTurns,
  checkpointAction,
  checkpointLabel,
  checkpointTitle,
  restoreHash,
  toCheckpoints,
  toRewindPoints,
  type CheckpointRecord,
  type RewindPoint,
} from '../../src/core/branches'
import { isPreview, previewState } from '../../src/core/preview'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

function SectionLabel({ text }: { text: string }) {
  const theme = themeFor(useColorScheme())
  return <Text style={{ color: theme.textWeak, fontSize: 12, fontWeight: '600', paddingHorizontal: 4 }}>{text}</Text>
}

function Card({ children }: { children: React.ReactNode }) {
  const theme = themeFor(useColorScheme())
  return (
    <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: theme.hairline, borderColor: theme.cardBorder, overflow: 'hidden' }}>
      {children}
    </View>
  )
}

export default function BranchesScreen() {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ sessionId: string }>()
  const sessionId = decodeURIComponent(params.sessionId ?? '')

  const transport = useApp(state => state.transport)
  const [tree, setTree] = useState<BranchTree | null>(null)
  const [points, setPoints] = useState<RewindPoint[]>([])
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isPreview()) {
      const demo = previewState()
      setTree(demo.branchTree)
      setPoints(demo.rewindPoints)
      setCheckpoints(demo.checkpoints)
      setLoading(false)
      return
    }
    if (!transport) { setLoading(false); return }
    try {
      const [rawTree, rawPoints, rawCheckpoints] = await Promise.all([
        transport.invoke<BranchTree>('agent_tree', { sessionId }).catch(() => null),
        transport.invoke<unknown>('rewind_points', { sessionId }).catch(() => []),
        transport.invoke<unknown>('checkpoint_list', { sessionId }).catch(() => []),
      ])
      setTree(rawTree)
      setPoints(toRewindPoints(rawPoints))
      setCheckpoints(toCheckpoints(rawCheckpoints))
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }, [sessionId, transport])

  useEffect(() => { void load() }, [load])
  useEffect(() => { navigation.setOptions({ title: '分支与检查点' }) }, [navigation])

  const switchBranch = (leafId: string, label: string) => {
    Alert.alert('切换到这个版本？', `${label}\n\n对话会移动到这一版；文件是否一并回退，请在桌面端选择。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '切换',
        onPress: async () => {
          if (isPreview() || !transport) return
          setBusy(leafId)
          try {
            await transport.invoke('agent_navigate', { sessionId, entryId: leafId })
            await load()
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          } finally {
            setBusy(null)
          }
        },
      },
    ])
  }

  const rewind = (point: RewindPoint) => {
    Alert.alert('回到这条提问？', `${point.preview}\n\n这条之后的对话会被撤掉。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '回退',
        style: 'destructive',
        onPress: async () => {
          if (isPreview() || !transport) return
          setBusy(point.entryId)
          try {
            await transport.invoke('rewind_execute', { sessionId, entryId: point.entryId })
            await load()
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          } finally {
            setBusy(null)
          }
        },
      },
    ])
  }

  const restore = (record: CheckpointRecord) => {
    Alert.alert('恢复这个文件？', `${record.path}\n${checkpointAction(record)}。之后的修改会被覆盖。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '恢复',
        style: 'destructive',
        onPress: async () => {
          if (isPreview() || !transport) return
          setBusy(record.id)
          try {
            await transport.invoke('checkpoint_restore', { sessionId, path: record.path, hash: restoreHash(record) })
            await load()
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          } finally {
            setBusy(null)
          }
        },
      },
    ])
  }

  const turns = branchTurns(tree)

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom, gap: 14 }}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.textMedium}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }}
        />
      )}
    >
      {error ? (
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: 12 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={theme.textMedium} />
        </View>
      ) : (
        <>
          <SectionLabel text="对话分支" />
          {turns.length === 0 ? (
            <Card>
              <View style={{ padding: 14 }}>
                <Text style={{ color: theme.textWeak, fontSize: 13, lineHeight: 19 }}>
                  这个会话还没有多个版本。重新生成或编辑一条提问后，旧版本会留在这里。
                </Text>
              </View>
            </Card>
          ) : (
            <Card>
              {turns.map((turn, index) => (
                <Pressable
                  key={turn.entryId}
                  disabled={busy !== null}
                  onPress={() => {
                    const sibling = turn.siblings[turn.index]
                    if (sibling) switchBranch(sibling.leafId, branchLabel(turn))
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingHorizontal: 14, minHeight: 48,
                    backgroundColor: pressed ? theme.hover : 'transparent',
                    borderBottomWidth: index === turns.length - 1 ? 0 : theme.hairline,
                    borderBottomColor: theme.cardBorder,
                  })}
                >
                  <View style={{ flex: 1, paddingVertical: 10 }}>
                    <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                      {branchLabel(turn)}
                    </Text>
                    <Text style={{ color: theme.textWeak, fontSize: 12, marginTop: 2 }}>
                      共 {turn.total} 个版本，当前第 {turn.index + 1} 个
                    </Text>
                  </View>
                  {busy === turn.siblings[turn.index]?.leafId
                    ? <ActivityIndicator color={theme.textMedium} />
                    : <ChevronRightIcon size={15} color={theme.textWeak} />}
                </Pressable>
              ))}
            </Card>
          )}

          <SectionLabel text="回到某条提问" />
          {points.length === 0 ? (
            <Card>
              <View style={{ padding: 14 }}>
                <Text style={{ color: theme.textWeak, fontSize: 13 }}>还没有可以回退的提问。</Text>
              </View>
            </Card>
          ) : (
            <Card>
              {points.map((point, index) => (
                <Pressable
                  key={point.entryId}
                  disabled={busy !== null}
                  onPress={() => rewind(point)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingHorizontal: 14, minHeight: 48,
                    backgroundColor: pressed ? theme.hover : 'transparent',
                    borderBottomWidth: index === points.length - 1 ? 0 : theme.hairline,
                    borderBottomColor: theme.cardBorder,
                  })}
                >
                  <ClockIcon size={16} color={theme.textWeak} />
                  <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 14, paddingVertical: 12 }}>
                    {point.preview || `第 ${point.index + 1} 条提问`}
                  </Text>
                  {busy === point.entryId ? <ActivityIndicator color={theme.textMedium} /> : null}
                </Pressable>
              ))}
            </Card>
          )}

          <SectionLabel text="文件检查点" />
          {checkpoints.length === 0 ? (
            <Card>
              <View style={{ padding: 14 }}>
                <Text style={{ color: theme.textWeak, fontSize: 13, lineHeight: 19 }}>
                  还没有文件改动记录。代理每写一次文件，保存前后的版本都会留在这里。
                </Text>
              </View>
            </Card>
          ) : (
            <Card>
              {checkpoints.map((record, index) => (
                <Pressable
                  key={record.id}
                  disabled={busy !== null || record.skipped === 'too_large'}
                  onPress={() => restore(record)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingHorizontal: 14, minHeight: 48,
                    backgroundColor: pressed ? theme.hover : 'transparent',
                    borderBottomWidth: index === checkpoints.length - 1 ? 0 : theme.hairline,
                    borderBottomColor: theme.cardBorder,
                    opacity: record.skipped === 'too_large' ? 0.6 : 1,
                  })}
                >
                  <View style={{ flex: 1, paddingVertical: 10 }}>
                    <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                      {checkpointTitle(record.path)}
                    </Text>
                    <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 12, marginTop: 2 }}>
                      {checkpointLabel(record)} · {checkpointAction(record)}
                    </Text>
                  </View>
                  {busy === record.id
                    ? <ActivityIndicator color={theme.textMedium} />
                    : record.skipped === 'too_large' ? null : <ChevronRightIcon size={15} color={theme.textWeak} />}
                </Pressable>
              ))}
            </Card>
          )}

          <Text style={{ color: theme.textWeak, fontSize: 11, lineHeight: 17, paddingHorizontal: 4 }}>
            撤销工具改动需要每一轮的工具调用信息，只在桌面端提供；手机负责切换分支和恢复文件。
          </Text>
        </>
      )}
    </ScrollView>
  )
}
