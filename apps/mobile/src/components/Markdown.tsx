/**
 * Markdown blocks as React Native text (20261115-mobile.md §5.5).
 *
 * The parsing lives in `core/markdown.ts`; this file only maps blocks to views.
 * Code blocks are horizontally scrollable with the theme's monospace font — the
 * phone equivalent of the desktop's `<pre>` with a copy button.
 */

import { useMemo } from 'react'
import { Linking, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'

import { parseBlocks, type Block, type Inline } from '../core/markdown'
import { themeFor, type Theme } from '../theme'
import { CopyIcon } from './icons'
import { CopyableText } from './CopyableText'

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
  return (
    <View
      style={{
        marginVertical: 8,
        backgroundColor: theme.card,
        borderRadius: 12,
        borderWidth: theme.hairline,
        borderColor: theme.cardBorder,
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
        <Text style={{ color: theme.textWeak, fontSize: 11 }}>{block.language ?? 'code'}</Text>
        <CopyableText text={block.text}>
          <Pressable hitSlop={8} style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.6 : 1 })}>
            <CopyIcon size={13} color={theme.textWeak} />
          </Pressable>
        </CopyableText>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12 }}>
        <Text
          selectable
          style={{ fontFamily: theme.mono, fontSize: 12.5, lineHeight: 19, color: theme.text }}
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
            const size = block.level === 1 ? 19 : block.level === 2 ? 17 : 16
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
