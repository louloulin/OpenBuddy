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

import type { TextRow, ToolRow } from '../core/transcript'
import { themeFor } from '../theme'
import { CheckIcon, CloseIcon, SparkIcon, TerminalIcon } from './icons'

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
          paddingHorizontal: 14,
          paddingVertical: 9,
        }}
      >
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
      </View>
    </View>
  )
}

function AssistantRow({ row }: { row: TextRow }) {
  const theme = themeFor(useColorScheme())
  return (
    <View style={{ paddingHorizontal: theme.gutter, paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.scheme === 'dark' ? theme.card : '#333333',
          }}
        >
          <SparkIcon size={14} color={theme.scheme === 'dark' ? theme.text : '#ffffff'} />
        </View>
        <Text style={{ color: theme.text, fontSize: theme.fontMeta, fontWeight: '500' }}>OpenBuddy</Text>
      </View>
      <Text
        selectable
        style={{
          color: row.isError ? theme.danger : theme.text,
          fontSize: theme.fontBody,
          lineHeight: theme.lineBody,
        }}
      >
        {row.text}
        {row.streaming ? <Text style={{ color: theme.accent }}>▍</Text> : null}
      </Text>
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

function ToolCard({ row }: { row: ToolRow }) {
  const theme = themeFor(useColorScheme())
  const tint = row.status === 'error' ? theme.danger : row.status === 'ok' ? theme.ok : theme.textWeak
  return (
    <View style={{ paddingHorizontal: theme.gutter, paddingVertical: 6 }}>
      <View
        style={{
          backgroundColor: theme.card,
          borderRadius: 12,
          borderWidth: theme.hairline,
          borderColor: theme.cardBorder,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TerminalIcon size={14} color={tint} />
          <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 13, fontWeight: '500' }}>
            {row.name}
          </Text>
          {row.status === 'running' ? (
            <Text style={{ color: theme.textWeak, fontSize: 11 }}>运行中</Text>
          ) : row.status === 'error' ? (
            <CloseIcon size={14} color={theme.danger} />
          ) : (
            <CheckIcon size={14} color={theme.ok} />
          )}
        </View>
        {row.hint ? (
          <Text numberOfLines={1} style={{ color: theme.textMedium, fontSize: 12, fontFamily: theme.mono }}>
            {row.hint}
          </Text>
        ) : null}
        {row.output ? (
          <Text numberOfLines={8} style={{ color: theme.textWeak, fontSize: 12, lineHeight: 18, fontFamily: theme.mono }}>
            {row.output}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

export const MessageRow = memo(function MessageRow({ row }: { row: TextRow | ToolRow }) {
  if (row.kind === 'tool') return <ToolCard row={row} />
  if (row.role === 'user') return <UserBubble row={row} />
  if (row.role === 'system') return <SystemRow row={row} />
  return <AssistantRow row={row} />
})
