/**
 * A folded reasoning block (20261115-mobile.md §4.3).
 *
 * Mirrors the desktop `.msg__thought` exactly in behaviour: a one-line quiet
 * header with a CSS triangle (not a chevron — the desktop uses a border
 * triangle that rotates), the last line of the reasoning as a live preview, and
 * the full text behind a tap, capped at 240px of height with its own scroll so
 * a long chain of reasoning never pushes the answer off the screen.
 */

import { useState } from 'react'
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'

import type { ThinkingRow as ThinkingRowData } from '../core/transcript'
import { themeFor } from '../theme'

function lastLine(text: string): string {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.at(-1) ?? ''
}

/** The desktop's triangle: a 4px-wide border triangle that rotates. */
function Triangle({ open, color }: { open: boolean; color: string }) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: 4,
        borderRightWidth: 4,
        borderTopWidth: 5,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderTopColor: color,
        opacity: 0.55,
        transform: [{ rotate: open ? '0deg' : '-90deg' }],
      }}
    />
  )
}

export function ThinkingRow({ row }: { row: ThinkingRowData }) {
  const theme = themeFor(useColorScheme())
  const [open, setOpen] = useState(false)
  const preview = lastLine(row.text)

  return (
    <View style={{ paddingHorizontal: theme.gutter, marginBottom: 10 }}>
      <Pressable
        onPress={() => setOpen(value => !value)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 2,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Triangle open={open} color={theme.textWeak} />
        <Text style={{ color: theme.textWeak, fontSize: 13 }}>{row.live ? '思考中' : '思考过程'}</Text>
        {!open && row.live && preview ? (
          <Text numberOfLines={1} style={{ flex: 1, color: theme.textWeak, fontSize: 12, opacity: 0.8, marginLeft: 2 }}>
            {preview}
          </Text>
        ) : null}
      </Pressable>

      {open ? (
        <ScrollView
          style={{ maxHeight: 240, marginTop: 6 }}
          contentContainerStyle={{ paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: theme.cardBorder }}
        >
          <Text selectable style={{ color: theme.textWeak, fontSize: 13, lineHeight: 22 }}>
            {row.text}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  )
}
