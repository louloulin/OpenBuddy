/**
 * The message action sheet (20261115-mobile.md §4.3).
 *
 * The desktop reveals a row of small buttons on hover (复制 / 编辑 / 复制 MD).
 * A phone has no hover, so the same actions come from a long press, in a
 * bottom sheet — the shape iOS and Android both use for "what do you want to
 * do with this".
 */

import { useState } from 'react'
import { Modal, Pressable, Text, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'

import { themeFor } from '../theme'

export type MessageAction = 'copy' | 'copy_markdown' | 'speak' | 'regenerate' | 'quote' | 'edit'

export type MessageActionsProps = {
  /** Plain text of the message. */
  text: string
  /** The message as Markdown, when it differs from the rendered text. */
  markdown?: string
  /** Whether a "regenerate" action makes sense (assistant turns only). */
  canRegenerate?: boolean
  onRegenerate?: () => void
  /** Assistant messages can be read out loud (语音播报). */
  onSpeak?: () => void
  /** Quote-reply: the composer shows the message above the input. */
  onQuote?: () => void
  /** Edit-resend: put a user message back in the composer. */
  onEdit?: () => void
  /**
   * Copy feedback is reported upward instead of rendered here: the sheet wraps
   * the bubble content, so a note in this tree would grow the bubble itself.
   */
  onNote?: (note: string | null) => void
  children: React.ReactNode
}

export function MessageActions({
  text, markdown, canRegenerate, onRegenerate, onSpeak, onQuote, onEdit, onNote, children,
}: MessageActionsProps) {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)

  const copy = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value)
      onNote?.(label)
    } catch {
      onNote?.('复制失败')
    }
    setTimeout(() => onNote?.(null), 1400)
    setOpen(false)
  }

  const items: { key: MessageAction; label: string; run: () => void }[] = [
    { key: 'copy', label: '复制文本', run: () => void copy(text, '已复制文本') },
  ]
  if (markdown && markdown !== text) {
    items.push({ key: 'copy_markdown', label: '复制 Markdown', run: () => void copy(markdown, '已复制 Markdown') })
  }
  if (onQuote) {
    items.push({ key: 'quote', label: '引用回复', run: () => { setOpen(false); onQuote() } })
  }
  if (onEdit) {
    items.push({ key: 'edit', label: '编辑重发', run: () => { setOpen(false); onEdit() } })
  }
  if (onSpeak) {
    items.push({ key: 'speak', label: '朗读', run: () => { setOpen(false); onSpeak() } })
  }
  if (canRegenerate && onRegenerate) {
    items.push({ key: 'regenerate', label: '重新生成', run: () => { setOpen(false); onRegenerate() } })
  }

  return (
    <>
      <Pressable onLongPress={() => setOpen(true)} delayLongPress={350}>
        {children}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: theme.scrim }} onPress={() => setOpen(false)} />
        <View
          style={{
            backgroundColor: theme.card,
            borderTopLeftRadius: theme.radiusSheet,
            borderTopRightRadius: theme.radiusSheet,
            paddingVertical: 8,
            paddingBottom: 16 + insets.bottom,
          }}
        >
          {items.map(item => (
            <Pressable
              key={item.key}
              onPress={item.run}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: theme.touch,
                justifyContent: 'center',
                paddingVertical: 12,
                paddingHorizontal: 20,
                backgroundColor: pressed ? theme.hover : 'transparent',
              })}
            >
              <Text style={{ color: theme.text, fontSize: theme.fontBody }}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: theme.touch,
              justifyContent: 'center',
              paddingVertical: 12,
              paddingHorizontal: 20,
              backgroundColor: pressed ? theme.hover : 'transparent',
              borderTopWidth: theme.hairline,
              borderTopColor: theme.cardBorder,
              marginTop: 6,
            })}
          >
            <Text style={{ color: theme.textMedium, fontSize: theme.fontBody }}>取消</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  )
}
