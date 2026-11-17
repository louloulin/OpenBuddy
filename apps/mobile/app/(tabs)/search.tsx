/**
 * Search (20261115-mobile.md §4.2 P2, §4.3).
 *
 * `session_search` is read-only and the desktop owns the index, so this is a
 * query field plus result cards. Results keep the desktop's card idiom: title
 * in strong text, snippet in weak text, a hairline border.
 */

import { useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View, useColorScheme } from 'react-native'
import { useRouter } from 'expo-router'

import { SearchIcon } from '../../src/components/icons'
import { isPreview, previewState } from '../../src/core/preview'
import { canRun } from '../../src/core/surface'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

type Hit = { sessionId?: string; id?: string; title?: string; snippet?: string; text?: string }

export default function SearchScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const transport = useApp(state => state.transport)
  const capabilities = useApp(state => state.capabilities)

  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [hits, setHits] = useState<Hit[]>([])
  const [note, setNote] = useState<string | null>(null)

  const search = async () => {
    const text = query.trim()
    if (!text) return
    // Design review has no tunnel; answer from the same demo dataset so the
    // screen can be exercised (and screenshotted) without a desktop.
    if (isPreview()) {
      const list = previewState().sessions
        .filter(session => session.title.includes(text) || session.preview.includes(text))
        .map(session => ({ sessionId: session.id, title: session.title, snippet: session.preview }))
      setHits(list)
      setNote(list.length ? null : '没有找到匹配的会话。')
      return
    }
    if (!transport) return
    setBusy(true)
    setNote(null)
    try {
      const result = await transport.invoke<Hit[] | { hits?: Hit[] }>('session_search', { query: text })
      const list = Array.isArray(result) ? result : result?.hits ?? []
      setHits(list)
      if (list.length === 0) setNote('没有找到匹配的会话。')
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (!canRun(capabilities, 'session_search')) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ color: theme.textWeak, textAlign: 'center', lineHeight: 20 }}>
          这台电脑没有开放会话搜索。
        </Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface, padding: 12, gap: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 44,
          paddingHorizontal: 12,
          backgroundColor: theme.card,
          borderWidth: theme.hairline,
          borderColor: theme.cardBorder,
          borderRadius: 12,
        }}
      >
        <SearchIcon size={17} color={theme.textWeak} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void search()}
          placeholder="搜索会话内容"
          placeholderTextColor={theme.textWeak}
          returnKeyType="search"
          style={{ flex: 1, color: theme.text, fontSize: 14 }}
        />
        {busy ? <ActivityIndicator color={theme.textMedium} /> : null}
      </View>

      {note ? <Text style={{ color: theme.textWeak, fontSize: 13, paddingHorizontal: 4 }}>{note}</Text> : null}

      {hits.length === 0 && !note ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 80 }}>
          <SearchIcon size={28} color={theme.textWeak} />
          <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            搜索所有会话的正文。{'\n'}索引在电脑上，手机只发查询。
          </Text>
        </View>
      ) : null}

      {hits.map((hit, index) => (
        <Pressable
          key={`${hit.sessionId ?? hit.id ?? index}`}
          onPress={() => hit.sessionId && router.push(`/chat/${encodeURIComponent(hit.sessionId)}`)}
          style={({ pressed }) => ({
            backgroundColor: pressed ? theme.hover : theme.card,
            borderRadius: 12,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
            padding: 13,
            gap: 4,
          })}
        >
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
            {hit.title ?? hit.sessionId ?? '会话'}
          </Text>
          {hit.snippet ?? hit.text ? (
            <Text style={{ color: theme.textWeak, fontSize: 13, lineHeight: 19 }} numberOfLines={3}>
              {hit.snippet ?? hit.text}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  )
}
