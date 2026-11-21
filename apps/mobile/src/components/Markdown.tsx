/**
 * Markdown blocks as React Native text (20261115-mobile.md §5.5).
 *
 * The parsing lives in `core/markdown.ts`; this file only maps blocks to views.
 * Code blocks are horizontally scrollable with the theme's monospace font — the
 * phone equivalent of the desktop's `<pre>` with a copy button.
 */

import { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import { parseBlocks, type Block, type Inline } from '../core/markdown'
import { themeFor, type Theme } from '../theme'
import { CheckIcon, CopyIcon } from './icons'

function InlineText({ inlines, theme, base }: { inlines: Inline[]; theme: Theme; base: object }) {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.kind === 'strong') {
          return (
            <Text key={index} style={[base, { fontWeight: '600' }]}>
              {inline.text}
            </Text>
          )
        }
        if (inline.kind === 'code') {
          return (
            <Text
              key={index}
              style={{
                fontFamily: theme.mono,
                fontSize: 13,
                color: theme.text,
                backgroundColor: theme.inlineCode,
                borderRadius: 3,
                paddingHorizontal: 4,
              }}
            >
              {inline.text}
            </Text>
          )
        }
        if (inline.kind === 'link') {
          return (
            <Text
              key={index}
              accessibilityRole="link"
              style={[base, { color: theme.accent }]}
              onPress={() => { void Linking.openURL(inline.href).catch(() => {}) }}
            >
              {inline.text}
            </Text>
          )
        }
        return <Text key={index} style={base}>{inline.text}</Text>
      })}
    </>
  )
}

function CodeBlock({ block, theme }: { block: Extract<Block, { kind: 'code' }>; theme: Theme }) {
  // The copy icon is the only affordance in the header, so it must respond to a
  // tap. It used to sit inside `CopyableText`, which only listens for a long
  // press — the button looked live and did nothing.
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(block.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // No clipboard (rare on web): the code is still selectable.
    }
  }
  return (
    <View
      style={{
        marginVertical: 8,
        backgroundColor: theme.scheme === 'dark' ? '#1c1c1c' : theme.card,
        borderRadius: theme.radiusSmall,
        borderWidth: theme.hairline,
        borderColor: theme.scheme === 'dark' ? 'rgba(255, 255, 255, 0.14)' : theme.cardBorder,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 12,
          paddingRight: 6,
          paddingTop: 6,
        }}
      >
        <Text style={{ color: theme.textWeak, fontSize: theme.fontMicro }}>{block.language ?? 'code'}</Text>
        <Pressable
          onPress={() => void copy()}
          hitSlop={10}
          accessibilityRole="button"
          // The label stays constant: swapping it after a press changes the
          // accessible name mid-interaction, which breaks hit-testing (and is
          // announced twice). The state rides in `accessibilityState`.
          accessibilityLabel="复制代码"
          accessibilityState={{ selected: copied }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6, opacity: pressed ? 0.6 : 1 })}
        >
          {copied ? <CheckIcon size={13} color={theme.ok} /> : <CopyIcon size={13} color={theme.textMedium} />}
          {copied ? <Text style={{ color: theme.textWeak, fontSize: theme.fontMicro }}>已复制</Text> : null}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
        <Text
          selectable
          style={{ fontFamily: theme.mono, fontSize: theme.fontMeta, lineHeight: 19, color: theme.text }}
        >
          {block.text}
        </Text>
      </ScrollView>
    </View>
  )
}

export function Markdown({ source }: { source: string }) {
  const theme = themeFor(useColorScheme())
  const blocks = useMemo(() => parseBlocks(source), [source])
  const body = { color: theme.text, fontSize: theme.fontBody, lineHeight: theme.lineBody }

  return (
    <View>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const size = block.level === 1 ? theme.fontHeading + 2 : block.level === 2 ? theme.fontHeading : theme.fontBody + 1
            return (
              <Text
                key={index}
                selectable
                style={{ color: theme.text, fontSize: size, lineHeight: size + 7, fontWeight: '700', marginTop: index === 0 ? 0 : 10, marginBottom: 4 }}
              >
                <InlineText inlines={block.inlines} theme={theme} base={{}} />
              </Text>
            )
          }
          case 'code':
            return <CodeBlock key={index} block={block} theme={theme} />
          case 'rule':
            return <View key={index} style={{ height: theme.hairline, backgroundColor: theme.cardBorder, marginVertical: 10 }} />
          case 'bullet':
            return (
              <View key={index} style={{ marginVertical: 4, gap: 4 }}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={[body, { color: theme.textWeak }]}>·</Text>
                    <Text selectable style={[body, { flex: 1 }]}>
                      <InlineText inlines={item} theme={theme} base={body} />
                    </Text>
                  </View>
                ))}
              </View>
            )
          case 'ordered':
            return (
              <View key={index} style={{ marginVertical: 4, gap: 4 }}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={[body, { color: theme.textWeak, minWidth: 18 }]}>{block.start + itemIndex}.</Text>
                    <Text selectable style={[body, { flex: 1 }]}>
                      <InlineText inlines={item} theme={theme} base={body} />
                    </Text>
                  </View>
                ))}
              </View>
            )
          case 'quote':
            return (
              <View
                key={index}
                style={{ borderLeftWidth: 2, borderLeftColor: theme.cardBorder, paddingLeft: 10, marginVertical: 6 }}
              >
                <Text selectable style={[body, { color: theme.textMedium }]}>
                  <InlineText inlines={block.inlines} theme={theme} base={{ color: theme.textMedium }} />
                </Text>
              </View>
            )
          default:
            return (
              <Text key={index} selectable style={[body, { marginVertical: 3 }]}>
                <InlineText inlines={block.inlines} theme={theme} base={body} />
              </Text>
            )
        }
      })}
    </View>
  )
}
