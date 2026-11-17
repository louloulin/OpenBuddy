/**
 * One transcript row (20261115-mobile.md §4.3, §5.4).
 *
 * Geometry and colour come from the desktop conversation view, not from a
 * generic chat template:
 *   - the user message is a warm-grey bubble (web `.msg__bubble`, #ebebeb,
 *     radius 16/16/0/16, max 75% width)
 *   - the assistant message has **no** bubble: it is full-width body text with
 *     a 24px avatar row above it (web `.msg--assistant`)
 *   - a tool call is a quiet card, not a bubble, and its result is monospace.
 *
 * Only the streaming row changes on each token, so `memo` keeps the rest still.
 */

import { memo } from 'react'
import { Text, View, useColorScheme } from 'react-native'

import type { TextRow, ThinkingRow as ThinkingRowData, ToolRow } from '../core/transcript'
import { themeFor } from '../theme'
import { speak } from '../native/speech'
import { SparkIcon } from './icons'
import { Caret } from './Caret'
import { Markdown } from './Markdown'
import { MessageActions } from './MessageActions'
import { ThinkingRow } from './ThinkingRow'
import { ToolCard } from './ToolCard'

function UserBubble({ row }: { row: TextRow }) {
  const theme = themeFor(useColorScheme())
  return (
    <View style={{ alignItems: 'flex-end', paddingHorizontal: theme.gutter, paddingVertical: 8 }}>
      <View
        style={{
          maxWidth: '78%',
          backgroundColor: theme.bubble,
          borderTopLeftRadius: theme.radiusBubble,
          borderTopRightRadius: theme.radiusBubble,
          borderBottomLeftRadius: theme.radiusBubble,
          // The squared corner is the desktop's `16px 16px 0 16px` tail.
          borderBottomRightRadius: 4,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <MessageActions text={row.text}>
          <Text
            selectable
            style={{
              color: row.isError ? theme.danger : theme.bubbleText,
              fontSize: theme.fontBody,
              lineHeight: theme.lineBody,
            }}
          >
            {row.text}
          </Text>
        </MessageActions>
      </View>
    </View>
  )
}

function AssistantRow({ row, onRegenerate }: { row: TextRow; onRegenerate?: () => void }) {
  const theme = themeFor(useColorScheme())
  return (
    <View style={{ paddingHorizontal: theme.gutter, paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.ink,
          }}
        >
          <SparkIcon size={14} color={theme.inkFg} />
        </View>
        <Text style={{ color: theme.text, fontSize: theme.fontMeta, fontWeight: '500' }}>OpenBuddy</Text>
      </View>
      <MessageActions
        text={row.text}
        markdown={row.text}
        canRegenerate={!row.streaming}
        onRegenerate={onRegenerate}
        onSpeak={row.streaming ? undefined : () => speak(row.text)}
      >
        {row.isError ? (
          <Text selectable style={{ color: theme.danger, fontSize: theme.fontBody, lineHeight: theme.lineBody }}>
            {row.text}
          </Text>
        ) : (
          <Markdown source={row.text} />
        )}
        {row.streaming ? (
          <Caret color={theme.accent} fontSize={theme.fontBody} lineHeight={theme.lineBody} />
        ) : null}
      </MessageActions>
    </View>
  )
}

function SystemRow({ row }: { row: TextRow }) {
  const theme = themeFor(useColorScheme())
  return (
    <View style={{ paddingHorizontal: theme.gutter, paddingVertical: 6, alignItems: 'center' }}>
      <Text style={{ color: theme.textWeak, fontSize: 12, lineHeight: 18, textAlign: 'center' }}>{row.text}</Text>
    </View>
  )
}

export const MessageRow = memo(function MessageRow({
  row,
  onRegenerate,
}: {
  row: TextRow | ToolRow | ThinkingRowData
  onRegenerate?: () => void
}) {
  if (row.kind === 'thinking') return <ThinkingRow row={row} />
  if (row.kind === 'tool') return <ToolCard row={row} />
  if (row.role === 'user') return <UserBubble row={row} />
  if (row.role === 'system') return <SystemRow row={row} />
  return <AssistantRow row={row} onRegenerate={onRegenerate} />
})
