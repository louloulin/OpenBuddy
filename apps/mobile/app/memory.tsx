/**
 * Memory notes (20261115-mobile.md §4.2 P1).
 *
 * The phone browses what the desktop would inject into a session, and may edit
 * a note. Grouping and previews come from `src/core/memory.ts`; the files
 * themselves live on the computer. Only global memory is listed here — project
 * memory is scoped to a trusted workspace, and a workspace is a desktop idea.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { ChevronRightIcon, PlusIcon, SparkIcon } from '../src/components/icons'
import { groupMemory, memoryDir, memoryPreview, memoryTitle, type MemoryEntry } from '../src/core/memory'
import { isPreview, previewState } from '../src/core/preview'
import { canRun } from '../src/core/surface'
import { useApp } from '../src/stores/app'
import { themeFor } from '../src/theme'

export default function MemoryScreen() {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const transport = useApp(state => state.transport)
  const capabilities = useApp(state => state.capabilities)
  const connection = useApp(state => state.connection)

  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (isPreview()) {
      setEntries(previewState().memories)
      setLoading(false)
      return
    }
    if (!transport) { setLoading(false); return }
    try {
      const list = await transport.invoke<MemoryEntry[]>('memory_list', {})
      setEntries(Array.isArray(list) ? list : [])
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }, [transport])

  useEffect(() => { void load() }, [load])

  if (!canRun(capabilities, 'memory_list') && !isPreview()) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
        <SparkIcon size={26} color={theme.textWeak} />
        <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
          这台电脑没有开放记忆。{'\n'}记忆文件在电脑上管理。
        </Text>
      </View>
    )
  }

  const groups = groupMemory(entries)

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom, gap: 14 }}
      refreshControl={(
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.textMedium}
          enabled={connection === 'open'}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }}
        />
      )}
    >
      <Text style={{ color: theme.textWeak, fontSize: 12, lineHeight: 19, paddingHorizontal: 4 }}>
        这些笔记会在新会话里作为背景注入。编辑会直接写回电脑；项目记忆按工作区隔离，只在桌面端出现。
      </Text>

      {error ? (
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: 12 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={theme.textMedium} />
        </View>
      ) : groups.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 48, gap: 12 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.card, borderWidth: theme.hairline, borderColor: theme.cardBorder }}>
            <SparkIcon size={24} color={theme.textWeak} />
          </View>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>还没有记忆</Text>
          <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            让对话框住你的偏好和事实，{'\n'}下次开新会话时它会记得。
          </Text>
        </View>
      ) : (
        groups.map(group => (
          <View key={group.scope} style={{ gap: 8 }}>
            <Text style={{ color: theme.textWeak, fontSize: 12, fontWeight: '600', paddingHorizontal: 4 }}>{group.title}</Text>
            <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: theme.hairline, borderColor: theme.cardBorder, overflow: 'hidden' }}>
              {group.entries.map((entry, index) => (
                <Pressable
                  key={`${entry.scope}:${entry.path}`}
                  onPress={() => router.push({
                    pathname: '/memory/[path]',
                    params: { path: entry.path, scope: entry.scope },
                  })}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    minHeight: 48,
                    backgroundColor: pressed ? theme.hover : 'transparent',
                    borderBottomWidth: index === group.entries.length - 1 ? 0 : theme.hairline,
                    borderBottomColor: theme.cardBorder,
                  })}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                        {memoryTitle(entry.path)}
                      </Text>
                      {memoryDir(entry.path) ? (
                        <Text style={{ color: theme.textWeak, fontSize: 11 }}>{memoryDir(entry.path)}</Text>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 13 }}>
                      {memoryPreview(entry.content) || '空白笔记'}
                    </Text>
                  </View>
                  <ChevronRightIcon size={15} color={theme.textWeak} />
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}

      <Pressable
        onPress={() => router.push({ pathname: '/memory/[path]', params: { path: 'NEW.md', scope: 'global', create: '1' } })}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 46,
          borderRadius: theme.radiusPill,
          borderWidth: theme.hairline,
          borderColor: theme.cardBorder,
          backgroundColor: pressed ? theme.pressed : theme.card,
        })}
      >
        <PlusIcon size={17} color={theme.text} />
        <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>新建记忆</Text>
      </Pressable>
    </ScrollView>
  )
}
