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
import * as Clipboard from 'expo-clipboard'

import { themeFor } from '../theme'

export type MessageAction = 'copy' | 'copy_markdown' | 'speak' | 'regenerate'

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
  children: React.ReactNode
}

export function MessageActions({ text, markdown, canRegenerate, onRegenerate, onSpeak, children }: MessageActionsProps) {
  const theme = themeFor(useColorScheme())
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const copy = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value)
      setNote(label)
      setTimeout(() => setNote(null), 1400)
    } catch {
      setNote('复制失败')
      setTimeout(() => setNote(null), 1400)
    }
    setOpen(false)
  }

  const items: { key: MessageAction; label: string; run: () => void }[] = [
    { key: 'copy', label: '复制文本', run: () => void copy(text, '已复制文本') },
  ]
  if (markdown && markdown !== text) {
    items.push({ key: 'copy_markdown', label: '复制 Markdown', run: () => void copy(markdown, '已复制 Markdown') })
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
      {note ? (
        <View style={{ alignItems: 'flex-end', paddingTop: 4, paddingHorizontal: theme.gutter }}>
          <Text style={{ color: theme.textWeak, fontSize: 11 }}>{note}</Text>
        </View>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setOpen(false)} />
        <View
          style={{
            backgroundColor: theme.card,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingVertical: 8,
            paddingBottom: 30,
          }}
        >
          {items.map(item => (
            <Pressable
              key={item.key}
              onPress={item.run}
              style={({ pressed }) => ({ paddingVertical: 15, paddingHorizontal: 20, backgroundColor: pressed ? theme.hover : 'transparent' })}
            >
              <Text style={{ color: theme.text, fontSize: 15 }}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setOpen(false)}
            style={({ pressed }) => ({ paddingVertical: 15, paddingHorizontal: 20, backgroundColor: pressed ? theme.hover : 'transparent', borderTopWidth: theme.hairline, borderTopColor: theme.cardBorder, marginTop: 6 })}
          >
            <Text style={{ color: theme.textWeak, fontSize: 15 }}>取消</Text>
          </Pressable>
        </View>
      </Modal>
    </>
  )
}
