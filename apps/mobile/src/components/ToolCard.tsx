/**
 * A tool call, the way the desktop draws one (20261115-mobile.md §4.3).
 *
 * The desktop's `.toolcall` is a single 32px row: a small code-font category
 * tag, the tool name, and a status mark on the right. Tapping it opens the
 * result. The phone follows that shape — a phone card with three paragraphs of
 * output reads like an error report, not a tool call.
 */

import { useState } from 'react'
import { ActivityIndicator, Linking, Pressable, Text, View, useColorScheme } from 'react-native'

import { toolCategory, type ToolRow } from '../core/transcript'
import { canRevertTool } from '../core/revert'
import { extractSources, isSourceTool } from '../core/sources'
import { themeFor } from '../theme'
import { CheckIcon, CloseIcon, TerminalIcon } from './icons'

export function ToolCard({
  row, onRevert, reverting = false, revertNote,
}: {
  row: ToolRow
  /** Undo the files this call changed (D5); absent when the host cannot. */
  onRevert?: () => void
  reverting?: boolean
  revertNote?: string
}) {
  const theme = themeFor(useColorScheme())
  const [open, setOpen] = useState(false)

  // The tag repeats the name when the tool has no category of its own
  // (`grep` → `grep`), which is noise rather than information.
  const category = row.category ?? toolCategory(row.name)
  const running = row.status === 'running'
  const tint = row.status === 'error' ? theme.danger : row.status === 'ok' ? theme.ok : theme.textWeak
  // F4: only web tools carry sources; an empty list renders nothing.
  const sources = isSourceTool(row.name) ? extractSources(row.output ?? '') : []

  return (
    <View style={{ paddingHorizontal: theme.gutter, marginVertical: 3 }}>
      <Pressable
        onPress={() => setOpen(value => !value)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 32,
          paddingHorizontal: 10,
          borderRadius: 8,
          borderWidth: theme.hairline,
          borderColor: running ? theme.focus : row.status === 'error' ? theme.danger : theme.cardBorder,
          backgroundColor: pressed ? theme.hover : theme.card,
        })}
      >
        {category !== row.name ? (
          <Text
            style={{
              fontFamily: theme.mono,
              fontSize: 11,
              color: theme.textMedium,
              backgroundColor: theme.surface,
              borderWidth: theme.hairline,
              borderColor: theme.cardBorder,
              borderRadius: 4,
              paddingHorizontal: 6,
              lineHeight: 18,
              overflow: 'hidden',
            }}
          >
            {category}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: theme.text, fontSize: 12 }}>
          {row.name}
        </Text>
        {running ? (
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.focus }} />
        ) : row.status === 'error' ? (
          <CloseIcon size={14} color={tint} />
        ) : (
          <CheckIcon size={14} color={tint} />
        )}
      </Pressable>

      {open ? (
        <View
          style={{
            marginTop: 4,
            padding: 10,
            borderRadius: 8,
            backgroundColor: theme.surface,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
          }}
        >
          {row.hint ? (
            <Text selectable style={{ color: theme.textMedium, fontSize: 11, fontFamily: theme.mono, marginBottom: 6 }}>
              {row.hint}
            </Text>
          ) : null}
          {row.output ? (
            <Text selectable style={{ color: theme.textWeak, fontSize: 11, lineHeight: 17, fontFamily: theme.mono }}>
              {row.output}
            </Text>
          ) : (
            <Text style={{ color: theme.textWeak, fontSize: 11 }}>这个工具没有返回内容。</Text>
          )}
          {sources.length ? (
            <View style={{ marginTop: 10, gap: 6 }}>
              <Text style={{ color: theme.textWeak, fontSize: 11, fontWeight: '600' }}>来源</Text>
              {sources.map(source => (
                <Pressable
                  key={source.url}
                  onPress={() => void Linking.openURL(source.url).catch(() => {})}
                  accessibilityLabel={`打开来源 ${source.title}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 5,
                    paddingHorizontal: 8,
                    borderRadius: 8,
                    backgroundColor: pressed ? theme.pressed : 'transparent',
                    borderWidth: theme.hairline,
                    borderColor: theme.cardBorder,
                  })}
                >
                  <Text numberOfLines={1} style={{ flex: 1, color: theme.textMedium, fontSize: 11 }}>
                    {source.title}
                  </Text>
                  <Text numberOfLines={1} style={{ maxWidth: '45%', color: theme.textWeak, fontSize: 10 }}>
                    {source.url.replace(/^https?:\/\//, '')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {onRevert && !running && canRevertTool(row.name) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <Pressable
                onPress={onRevert}
                disabled={reverting}
                accessibilityLabel="撤销这一步的改动"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: theme.radiusPill,
                  borderWidth: theme.hairline,
                  borderColor: theme.cardBorder,
                  backgroundColor: pressed ? theme.pressed : 'transparent',
                  opacity: reverting ? 0.5 : 1,
                })}
              >
                {reverting ? <ActivityIndicator size="small" color={theme.textWeak} /> : null}
                <Text style={{ color: theme.textMedium, fontSize: 12 }}>撤销这一步</Text>
              </Pressable>
              {revertNote ? (
                <Text style={{ flex: 1, color: theme.textWeak, fontSize: 11 }}>{revertNote}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
