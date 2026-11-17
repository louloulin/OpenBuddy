/**
 * Read-only file browser (20261115-mobile.md §1.4 gap list, §4.2 P1).
 *
 * Qwen reads documents on the phone; Kimi lets the phone carry work across
 * devices. Here the desktop owns the disk and the phone reads it: browse the
 * session's workspace, preview a text file, and — for the agent to use — hand
 * the file back to the conversation as an attachment.
 *
 * Nothing here writes. The desktop's file-write commands are not on the mobile
 * surface at all.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useColorScheme } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { ChevronRightIcon, CloseIcon, FileIcon, FolderIcon, SearchIcon } from '../src/components/icons'
import { Markdown } from '../src/components/Markdown'
import {
  basename,
  formatSize,
  isTextPreview,
  parentPath,
  previewContent,
  toDirEntries,
  toSearchHits,
  type DirEntry,
} from '../src/core/files'
import { isPreview, previewState } from '../src/core/preview'
import { useApp } from '../src/stores/app'
import { themeFor } from '../src/theme'

export default function FilesScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const params = useLocalSearchParams<{ sessionId?: string; path?: string }>()
  const sessionId = params.sessionId ? decodeURIComponent(params.sessionId) : ''
  const initialPath = params.path ? decodeURIComponent(params.path) : undefined

  const transport = useApp(state => state.transport)
  const send = useApp(state => state.send)
  const capabilities = useApp(state => state.capabilities)

  const [path, setPath] = useState<string | undefined>(initialPath)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [preview, setPreview] = useState<{ path: string; text: string; truncated: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DirEntry[] | null>(null)

  const canSearch = Boolean(sessionId && capabilities?.commands.includes('files_search'))

  const open = useCallback(async (target?: string) => {
    // The design-review build has no desktop to ask; it renders the same
    // browser from the fixed dataset.
    if (isPreview()) {
      const demo = previewState().files
      setPath(target ?? demo.path)
      setEntries(target ? [] : demo.entries)
      return
    }
    if (!transport) return
    setLoading(true)
    setError(null)
    try {
      let dir = target
      if (!dir) {
        // Without a session, start at the desktop's home; with one, start at
        // the workspace the session works in.
        const info: { cwd?: string } = sessionId
          ? await transport.invoke<{ cwd?: string }>('agent_session_info', { sessionId })
            .catch(() => ({}) as { cwd?: string })
          : {}
        dir = info?.cwd ?? '/'
      }
      const list = await transport.invoke<unknown>('list_dir', { path: dir, maxEntries: 500 })
      setPath(dir)
      setEntries(toDirEntries(list))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }, [transport, sessionId])

  useEffect(() => { void open(initialPath) }, [open, initialPath])

  // `files_search` only accepts an authorized workspace root, so keep the
  // session's cwd around even when the user browses elsewhere.
  useEffect(() => {
    if (isPreview() || !transport || !sessionId) return
    transport.invoke<{ cwd?: string }>('agent_session_info', { sessionId })
      .then(info => { if (typeof info?.cwd === 'string') setWorkspace(info.cwd) })
      .catch(() => {})
  }, [transport, sessionId])

  const search = async () => {
    const text = query.trim()
    if (!text) {
      setHits(null)
      return
    }
    if (isPreview()) {
      const demo = previewState().files
      setHits(demo.entries.filter(entry => entry.name.includes(text)))
      return
    }
    if (!transport || !workspace) {
      setError('先打开一个会话，才能搜索它的工作区。')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await transport.invoke<unknown>('files_search', { cwd: workspace, query: text, limit: 50 })
      setHits(toSearchHits(result, workspace))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const openFile = async (entry: DirEntry) => {
    if (isPreview()) {
      const demo = previewState().files
      setPreview(demo.preview ? { ...demo.preview, truncated: false } : { path: entry.path, text: '', truncated: false })
      return
    }
    if (!transport) return
    if (!isTextPreview(entry.path)) {
      // Not text: the phone shows the name and size only, and can still hand
      // the path to the agent.
      setPreview({ path: entry.path, text: '', truncated: false })
      return
    }
    setLoading(true)
    try {
      const content = await transport.invoke<string>('read_text_file', { path: entry.path })
      const trimmed = previewContent(typeof content === 'string' ? content : String(content ?? ''))
      setPreview({ path: entry.path, ...trimmed })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const attach = async (file: { path: string }) => {
    if (!sessionId) {
      setError('先打开一个会话，才能把文件交给它。')
      return
    }
    await send(sessionId, '', [{ path: file.path }])
    router.back()
  }

  const parent = path ? parentPath(path) : null

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      {/* In-flow header, like the chat screen and the desktop topbar. */}
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
        <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
          {path ? basename(path) : '电脑上的文件'}
        </Text>
        {loading ? <ActivityIndicator size="small" color={theme.textWeak} /> : null}
      </View>

      {error ? (
        <View style={{ backgroundColor: theme.card, borderBottomWidth: theme.hairline, borderBottomColor: theme.cardBorder, padding: 12 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      {canSearch && !preview ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
            paddingVertical: 6,
            borderBottomWidth: theme.hairline,
            borderBottomColor: theme.cardBorder,
          }}
        >
          <SearchIcon size={16} color={theme.textWeak} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void search()}
            returnKeyType="search"
            placeholder="搜索这个工作区的文件"
            placeholderTextColor={theme.textWeak}
            style={{ flex: 1, color: theme.text, fontSize: 14, paddingVertical: 7 }}
          />
          {query ? (
            <Pressable
              onPress={() => { setQuery(''); setHits(null) }}
              hitSlop={8}
              accessibilityLabel="清除搜索"
            >
              <CloseIcon size={14} color={theme.textWeak} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {preview ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 12, marginBottom: 10 }}>
            {preview.path}
          </Text>
          {preview.text ? (
            <View style={{ backgroundColor: theme.card, borderRadius: 14, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: 14 }}>
              {preview.truncated ? (
                <Text style={{ color: theme.warning, fontSize: 12, marginBottom: 8 }}>文件较长，已截断显示</Text>
              ) : null}
              {isTextPreview(preview.path) ? (
                <Markdown source={preview.text} />
              ) : (
                <Text style={{ color: theme.textMedium, fontSize: 13 }}>
                  这个文件不能在手机上预览，但可以交给电脑上的会话处理。
                </Text>
              )}
            </View>
          ) : null}
          <Pressable
            onPress={() => void attach(preview)}
            style={({ pressed }) => ({
              marginTop: 16,
              height: 46,
              borderRadius: theme.radiusPill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.ink,
              opacity: pressed ? 0.88 : 1,
            })}
          >
            <Text style={{ color: theme.inkFg, fontSize: 15, fontWeight: '600' }}>交给会话处理</Text>
          </Pressable>
          <Pressable
            onPress={() => setPreview(null)}
            style={{ marginTop: 12, alignItems: 'center', paddingVertical: 10 }}
          >
            <Text style={{ color: theme.textWeak, fontSize: 13 }}>返回目录</Text>
          </Pressable>
        </ScrollView>
      ) : hits !== null ? (
        <ScrollView style={{ flex: 1 }}>
          {hits.length === 0 ? (
            <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
              <FileIcon size={26} color={theme.textWeak} />
              <Text style={{ color: theme.textWeak, fontSize: 13 }}>没有匹配的文件。</Text>
            </View>
          ) : null}
          {hits.map(entry => (
            <Pressable
              key={entry.path}
              onPress={() => void openFile(entry)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 11,
                backgroundColor: pressed ? theme.hover : 'transparent',
                borderBottomWidth: theme.hairline,
                borderBottomColor: theme.cardBorder,
              })}
            >
              <FileIcon size={17} color={theme.textWeak} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 }}>{entry.name}</Text>
                <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: 11, marginTop: 2 }}>
                  {entry.path}
                </Text>
              </View>
              {formatSize(entry.size) ? (
                <Text style={{ color: theme.textWeak, fontSize: 12 }}>{formatSize(entry.size)}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          {parent ? (
            <Pressable
              onPress={() => void open(parent)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 13,
                backgroundColor: pressed ? theme.hover : 'transparent',
                borderBottomWidth: theme.hairline,
                borderBottomColor: theme.cardBorder,
              })}
            >
              <FolderIcon size={17} color={theme.textMedium} />
              <Text style={{ flex: 1, color: theme.text, fontSize: 15 }}>..</Text>
              <ChevronRightIcon size={15} color={theme.textWeak} />
            </Pressable>
          ) : null}

          {entries.length === 0 && !loading ? (
            <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
              <FileIcon size={26} color={theme.textWeak} />
              <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
                这个目录是空的。{'\n'}手机只读浏览电脑上的文件。
              </Text>
            </View>
          ) : null}

          {entries.map(entry => (
            <Pressable
              key={entry.path}
              onPress={() => (entry.kind === 'directory' ? void open(entry.path) : void openFile(entry))}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 13,
                backgroundColor: pressed ? theme.hover : 'transparent',
                borderBottomWidth: theme.hairline,
                borderBottomColor: theme.cardBorder,
              })}
            >
              {entry.kind === 'directory'
                ? <FolderIcon size={17} color={theme.textMedium} />
                : <FileIcon size={17} color={theme.textWeak} />}
              <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15 }}>
                {entry.name}
              </Text>
              {entry.kind === 'file' && formatSize(entry.size) ? (
                <Text style={{ color: theme.textWeak, fontSize: 12 }}>{formatSize(entry.size)}</Text>
              ) : null}
              {entry.kind === 'directory' ? <ChevronRightIcon size={15} color={theme.textWeak} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  )
}
