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

import { memo, useState } from 'react'
import { Pressable, Text, View, useColorScheme } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import type { TextRow, ThinkingRow as ThinkingRowData, ToolRow } from '../core/transcript'
import { themeFor } from '../theme'
import { speak } from '../native/speech'
import { CopyIcon, QuoteIcon, RefreshIcon, ShareIcon, SparkIcon, VolumeIcon } from './icons'
import { shareTextFile } from '../native/share'
import { messageFilename, messageMarkdown } from '../core/share'
import { Caret } from './Caret'
import { Markdown } from './Markdown'
import { MessageActions } from './MessageActions'
import { ThinkingRow } from './ThinkingRow'
import { ToolCard } from './ToolCard'

function UserBubble({ row, onQuote, onEdit }: { row: TextRow; onQuote?: () => void; onEdit?: () => void }) {
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
        <MessageActions text={row.text} onQuote={onQuote} onEdit={onEdit}>
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

/**
 * A small icon row under a finished reply, the way Grok bot keeps copy / speak
 * / retry one tap away instead of hidden behind a long press. The long-press
 * sheet still exists for discoverability and for the Markdown variant.
 */
function InlineActions({ row, onRegenerate, onQuote }: { row: TextRow; onRegenerate?: () => void; onQuote?: () => void }) {
  const theme = themeFor(useColorScheme())
  const [note, setNote] = useState<string | null>(null)

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(row.text)
      setNote('已复制')
    } catch {
      setNote('复制失败')
    }
    setTimeout(() => setNote(null), 1400)
  }

  const share = async () => {
    try {
      const result = await shareTextFile(messageFilename(row.role), messageMarkdown(row.role, row.text))
      setNote(result === 'downloaded' ? '已下载' : result === 'shared' ? '已分享' : '不支持分享')
    } catch {
      setNote('分享失败')
    }
    setTimeout(() => setNote(null), 1600)
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 8 }}>
      <Pressable hitSlop={10} onPress={() => void copy()} accessibilityLabel="复制">
        <CopyIcon size={15} color={theme.textWeak} />
      </Pressable>
      <Pressable hitSlop={10} onPress={() => void share()} accessibilityLabel="分享">
        <ShareIcon size={15} color={theme.textWeak} />
      </Pressable>
      <Pressable hitSlop={10} onPress={() => speak(row.text)} accessibilityLabel="朗读">
        <VolumeIcon size={15} color={theme.textWeak} />
      </Pressable>
      {onQuote ? (
        <Pressable hitSlop={10} onPress={onQuote} accessibilityLabel="引用回复">
          <QuoteIcon size={15} color={theme.textWeak} />
        </Pressable>
      ) : null}
      {onRegenerate ? (
        <Pressable hitSlop={10} onPress={onRegenerate} accessibilityLabel="重新生成">
          <RefreshIcon size={15} color={theme.textWeak} />
        </Pressable>
      ) : null}
      {note ? <Text style={{ color: theme.textWeak, fontSize: 11 }}>{note}</Text> : null}
    </View>
  )
}

function AssistantRow({ row, onRegenerate, onQuote }: { row: TextRow; onRegenerate?: () => void; onQuote?: () => void }) {
  const theme = themeFor(useColorScheme())
  return (
    <View style={{ paddingHorizontal: theme.gutter, paddingVertical: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <SparkIcon size={14} color={theme.textWeak} />
        <Text style={{ color: theme.textWeak, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 }}>OpenBuddy</Text>
      </View>
      <MessageActions
        text={row.text}
        markdown={row.text}
        canRegenerate={!row.streaming}
        onRegenerate={onRegenerate}
        onSpeak={row.streaming ? undefined : () => speak(row.text)}
        onQuote={onQuote}
      >
        {row.isError ? (
          <Text selectable style={{ color: theme.danger, fontSize: theme.fontBody, lineHeight: theme.lineBody }}>
            {row.text}
          </Text>
        ) : (
          <Markdown source={row.text} />
        )}
        {row.streaming ? (
          <Caret color={theme.text} fontSize={theme.fontBody} lineHeight={theme.lineBody} />
        ) : null}
      </MessageActions>
      {!row.streaming && !row.isError && row.text ? (
        <InlineActions row={row} onRegenerate={onRegenerate} onQuote={onQuote} />
      ) : null}
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
  toolActions,
  onQuote,
  onEdit,
}: {
  row: TextRow | ToolRow | ThinkingRowData
  onRegenerate?: () => void
  /** Undo affordance for tool cards (D5). */
  toolActions?: {
    onRevert: (row: ToolRow) => void
    revertingId?: string
    noteFor?: (row: ToolRow) => string | undefined
  }
  /** Quote-reply from the long-press menu. */
  onQuote?: (text: string) => void
  /** Edit-resend: put a user message back in the composer. */
  onEdit?: (text: string) => void
}) {
  if (row.kind === 'thinking') return <ThinkingRow row={row} />
  if (row.kind === 'tool') {
    return (
      <ToolCard
        row={row}
        onRevert={toolActions ? () => toolActions.onRevert(row) : undefined}
        reverting={toolActions?.revertingId === row.id}
        revertNote={toolActions?.noteFor?.(row)}
      />
    )
  }
  if (row.role === 'system') return <SystemRow row={row} />
  if (row.role === 'user') {
    return (
      <UserBubble
        row={row}
        onQuote={onQuote ? () => onQuote(row.text) : undefined}
        onEdit={onEdit ? () => onEdit(row.text) : undefined}
      />
    )
  }
  return (
    <AssistantRow
      row={row}
      onRegenerate={onRegenerate}
      onQuote={onQuote ? () => onQuote(row.text) : undefined}
    />
  )
})
