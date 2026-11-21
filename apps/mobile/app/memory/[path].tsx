/**
 * One memory note (20261115-mobile.md §4.2 P1).
 *
 * Reading is the default; editing is explicit because the file lives on the
 * computer and is injected into future sessions. Saving writes the file and
 * returns to the list, which reloads from the desktop.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View, useColorScheme } from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CloseIcon, SparkIcon } from '../../src/components/icons'
import { memoryTitle, validateMemoryDraft, type MemoryEntry } from '../../src/core/memory'
import { isPreview, previewState } from '../../src/core/preview'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

export default function MemoryNoteScreen() {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ path: string; scope?: string; create?: string }>()
  const path = decodeURIComponent(params.path ?? '')
  const scope = params.scope === 'workspace' ? 'workspace' : 'global'
  const creating = params.create === '1'

  const transport = useApp(state => state.transport)
  const currentCwd = useApp(state => state.currentCwd)
  const [draftPath, setDraftPath] = useState(path)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(!creating)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = creating || content !== original

  const load = useCallback(async () => {
    if (isPreview()) {
      const found = previewState().memories.find(item => item.path === path)
      setContent(found?.content ?? '')
      setOriginal(found?.content ?? '')
      setLoading(false)
      return
    }
    if (!transport) { setLoading(false); return }
    try {
      const text = await transport.invoke<string>('memory_get', { scope, path, ...(currentCwd ? { cwd: currentCwd } : {}) })
      setContent(text)
      setOriginal(text)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }, [path, scope, transport, currentCwd])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    const check = validateMemoryDraft(draftPath, content)
    if (!check.ok) { setError(check.reason); return }
    if (isPreview()) { router.back(); return }
    if (!transport) return
    setBusy(true)
    setError(null)
    try {
      await transport.invoke<MemoryEntry>('memory_save', { scope, path: draftPath.trim(), content, ...(currentCwd ? { cwd: currentCwd } : {}) })
      router.back()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = () => {
    Alert.alert('删除这条记忆？', '文件会从电脑上删除，无法撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          if (isPreview() || !transport) { router.back(); return }
          try {
            await transport.invoke('memory_delete', { scope, path, ...(currentCwd ? { cwd: currentCwd } : {}) })
            router.back()
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          }
        },
      },
    ])
  }

  useEffect(() => {
    navigation.setOptions({ title: creating ? '新建记忆' : memoryTitle(path) })
  }, [navigation, creating, path])

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom, gap: 14 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: theme.textWeak, fontSize: 12, fontWeight: '600' }}>文件名</Text>
        <TextInput
          value={draftPath}
          onChangeText={setDraftPath}
          editable={creating}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="daily/notes.md"
          placeholderTextColor={theme.textWeak}
          style={{
            height: 44,
            paddingHorizontal: 12,
            borderRadius: 11,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
            backgroundColor: creating ? theme.card : theme.pressed,
            color: theme.text,
            fontSize: 14,
            fontFamily: theme.mono,
          }}
        />
        <Text style={{ color: theme.textWeak, fontSize: 11 }}>相对路径，以 .md 结尾；只能使用字母、数字、点、下划线、连字符。</Text>
      </View>

      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={theme.textMedium} />
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.textWeak, fontSize: 12, fontWeight: '600' }}>内容（Markdown）</Text>
          <TextInput
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            placeholder={'# 偏好\n\n- 回答用中文'}
            placeholderTextColor={theme.textWeak}
            style={{
              minHeight: 280,
              paddingHorizontal: 12,
              paddingVertical: 12,
              borderRadius: 12,
              borderWidth: theme.hairline,
              borderColor: theme.cardBorder,
              backgroundColor: theme.card,
              color: theme.text,
              fontSize: 14,
              lineHeight: 21,
            }}
          />
        </View>
      )}

      {error ? (
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: 12 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 12 }}>
        {!creating ? (
          <Pressable
            onPress={remove}
            style={({ pressed }) => ({
              height: 46,
              paddingHorizontal: 16,
              borderRadius: theme.radiusPill,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: pressed ? theme.pressed : theme.card,
              borderWidth: theme.hairline,
              borderColor: theme.cardBorder,
            })}
          >
            <CloseIcon size={15} color={theme.danger} />
            <Text style={{ color: theme.danger, fontSize: 14, fontWeight: '600' }}>删除</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => void save()}
          disabled={busy || loading}
          style={({ pressed }) => ({
            flex: 1,
            height: 46,
            borderRadius: theme.radiusPill,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            backgroundColor: busy ? theme.pressed : theme.ink,
            opacity: pressed ? 0.88 : 1,
          })}
        >
          {busy ? <ActivityIndicator color={theme.inkFg} /> : (
            <>
              <SparkIcon size={16} color={theme.inkFg} />
              <Text style={{ color: theme.inkFg, fontSize: 15, fontWeight: '600' }}>
                {creating ? '创建' : editing ? '保存' : '保存'}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </ScrollView>
  )
}
