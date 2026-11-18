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
import { Modal, Pressable, Text, View, useColorScheme } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import type { TextRow, ThinkingRow as ThinkingRowData, ToolRow } from '../core/transcript'
import { themeFor } from '../theme'
import { speak } from '../native/speech'
import { CopyIcon, QuoteIcon, RefreshIcon, ShareIcon, SparkIcon, VolumeIcon } from './icons'
import { shareTextFile } from '../native/share'
import { messageFilename, messageMarkdown } from '../core/share'
import { quotePreview } from '../core/quote'
import { Caret } from './Caret'
import { Markdown } from './Markdown'
import { MessageActions } from './MessageActions'
import { ThinkingRow } from './ThinkingRow'
import { ToolCard } from './ToolCard'

function UserBubble({ row, menu }: { row: TextRow; menu: () => void }) {
  const theme = themeFor(useColorScheme())
  return (
    <View style={{ alignItems: 'flex-end', paddingHorizontal: theme.gutter, paddingVertical: 8 }}>
      <Pressable
        onPress={menu}
        onLongPress={menu}
        delayLongPress={350}
        accessibilityLabel="消息操作"
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
      </Pressable>
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

/** Long-press sheet: the actions Grok hides behind a press on a message. */
function MessageMenu({
  row, visible, onClose, onQuote, onEdit, onRegenerate,
}: {
  row: TextRow
  visible: boolean
  onClose: () => void
  onQuote?: () => void
  onEdit?: () => void
  onRegenerate?: () => void
}) {
  const theme = themeFor(useColorScheme())
  if (!visible) return null
  const items: { key: string; label: string; danger?: boolean; run: () => void }[] = [
    { key: 'copy', label: '复制', run: () => { void Clipboard.setStringAsync(row.text).catch(() => {}) } },
  ]
  if (onQuote) items.push({ key: 'quote', label: '引用回复', run: onQuote })
  if (onEdit && row.role === 'user') items.push({ key: 'edit', label: '编辑重发', run: onEdit })
  if (onRegenerate && row.role === 'assistant' && !row.streaming) items.push({ key: 'regen', label: '重新生成', run: onRegenerate })
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }}
          onPress={onClose}
        />
        <View style={{
          backgroundColor: theme.surface,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          paddingHorizontal: theme.gutter,
          paddingTop: 14,
          paddingBottom: 30,
        }}>
          <Text numberOfLines={2} style={{ color: theme.textWeak, fontSize: 12, marginBottom: 6, lineHeight: 17 }}>
            {quotePreview(row.text, 70)}
          </Text>
          {items.map(item => (
            <Pressable
              key={item.key}
              onPress={() => { onClose(); item.run() }}
              style={({ pressed }) => ({
                paddingVertical: 14,
                borderTopWidth: theme.hairline,
                borderTopColor: theme.cardBorder,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ color: item.danger ? theme.danger : theme.text, fontSize: 16 }}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => ({
              marginTop: 10,
              paddingVertical: 13,
              borderRadius: theme.radiusPill,
              backgroundColor: theme.card,
              alignItems: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: theme.textMedium, fontSize: 15, fontWeight: '600' }}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  const [menuOpen, setMenuOpen] = useState(false)
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
  return (
    <>
      {row.role === 'user' ? (
        <UserBubble row={row} menu={() => setMenuOpen(true)} />
      ) : (
        <AssistantRow
          row={row}
          onRegenerate={onRegenerate}
          onQuote={onQuote ? () => onQuote(row.text) : undefined}
        />
      )}
      <MessageMenu
        row={row}
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onQuote={onQuote ? () => onQuote(row.text) : undefined}
        onEdit={onEdit ? () => onEdit(row.text) : undefined}
        onRegenerate={onRegenerate}
      />
    </>
  )
})
