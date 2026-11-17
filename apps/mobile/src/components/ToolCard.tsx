/**
 * A tool call, the way the desktop draws one (20261115-mobile.md §4.3).
 *
 * The desktop's `.toolcall` is a single 32px row: a small code-font category
 * tag, the tool name, and a status mark on the right. Tapping it opens the
 * result. The phone follows that shape — a phone card with three paragraphs of
 * output reads like an error report, not a tool call.
 */

import { useState } from 'react'
import { Pressable, Text, View, useColorScheme } from 'react-native'

import { toolCategory, type ToolRow } from '../core/transcript'
import { themeFor } from '../theme'
import { CheckIcon, CloseIcon, TerminalIcon } from './icons'

export function ToolCard({ row }: { row: ToolRow }) {
  const theme = themeFor(useColorScheme())
  const [open, setOpen] = useState(false)

  // The tag repeats the name when the tool has no category of its own
  // (`grep` → `grep`), which is noise rather than information.
  const category = row.category ?? toolCategory(row.name)
  const running = row.status === 'running'
  const tint = row.status === 'error' ? theme.danger : row.status === 'ok' ? theme.ok : theme.textWeak

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
              color: theme.accent,
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
        </View>
      ) : null}
    </View>
  )
}
