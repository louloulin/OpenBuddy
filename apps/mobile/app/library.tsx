/**
 * 资料库 (20261117-mobile.md D1).
 *
 * Knowledge-source folders the desktop registered. The phone lists them and
 * opens one read-only in the file browser; adding or removing a source stays
 * on the desktop that owns the library file.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useRouter } from 'expo-router'

import { ChevronRightIcon, FolderIcon } from '../src/components/icons'
import { toLibrarySources, type LibrarySource } from '../src/core/library'
import { isPreview, previewState } from '../src/core/preview'
import { canRun } from '../src/core/surface'
import { useApp } from '../src/stores/app'
import { themeFor } from '../src/theme'

export default function LibraryScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const transport = useApp(state => state.transport)
  const capabilities = useApp(state => state.capabilities)

  const [sources, setSources] = useState<LibrarySource[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canList = canRun(capabilities, 'library_list')

  const load = useCallback(async () => {
    if (isPreview()) {
      setSources(toLibrarySources(previewState().library))
      return
    }
    if (!transport) return
    setLoading(true)
    try {
      setSources(toLibrarySources(await transport.invoke<unknown>('library_list', {})))
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }, [transport])

  useEffect(() => { void load() }, [load])

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
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
        <Text style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>资料库</Text>
        {loading ? <ActivityIndicator size="small" color={theme.textWeak} /> : null}
      </View>

      {error ? (
        <View style={{ backgroundColor: theme.card, borderBottomWidth: theme.hairline, borderBottomColor: theme.cardBorder, padding: 12 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
        {!canList ? (
          <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
            <FolderIcon size={26} color={theme.textWeak} />
            <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              这台电脑没有开放资料库。{'\n'}知识源在桌面端添加。
            </Text>
          </View>
        ) : sources.length === 0 && !loading ? (
          <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
            <FolderIcon size={26} color={theme.textWeak} />
            <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              还没有知识源。{'\n'}在电脑上把文件夹加入资料库，它会出现在这里。
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ color: theme.textWeak, fontSize: 12, marginHorizontal: 16, marginTop: 14, marginBottom: 6 }}>
              只读浏览 · {sources.length} 个知识源
            </Text>
            {sources.map((source, index) => (
              <Pressable
                key={source.id}
                onPress={() => router.push(`/files?path=${encodeURIComponent(source.path)}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  backgroundColor: pressed ? theme.hover : 'transparent',
                  borderBottomWidth: index === sources.length - 1 ? 0 : theme.hairline,
                  borderBottomColor: theme.cardBorder,
                })}
              >
                <FolderIcon size={18} color={theme.textMedium} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 }}>{source.label}</Text>
                  <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 11, marginTop: 2 }}>{source.path}</Text>
                </View>
                <ChevronRightIcon size={15} color={theme.textWeak} />
              </Pressable>
            ))}
            <Text style={{ color: theme.textWeak, fontSize: 11, marginHorizontal: 16, marginTop: 14, lineHeight: 17 }}>
              添加或移除知识源在电脑上完成；手机只读。
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  )
}
