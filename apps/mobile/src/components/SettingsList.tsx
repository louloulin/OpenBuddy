/**
 * The grouped settings list every detail screen uses (20261117-mobile.md §9.26).
 *
 * 「我」 and the session panel had two copies of `Section` + `Row` that had
 * already drifted (only one bolded the destructive row). One copy now, with the
 * decisions fixed in place: 48pt rows, hairline separators, chevron only when a
 * row actually leads somewhere, and a pressed state on every tappable row — the
 * old version gave no feedback at all.
 */

import { Pressable, Text, View, useColorScheme } from 'react-native'

import { ChevronRightIcon } from './icons'
import { themeFor, type Theme } from '../theme'

export function Section({
  label,
  footer,
  theme: themeProp,
  children,
}: {
  label: string
  /** Quiet explanation under the card (rare; only when a row needs context). */
  footer?: string
  /** Kept for call sites that already hold a theme object. */
  theme?: Theme
  children: React.ReactNode
}) {
  const theme = themeProp ?? themeFor(useColorScheme())
  return (
    <View style={{ marginBottom: 22 }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.textWeak, fontSize: theme.fontMeta, fontWeight: '600', marginBottom: 8, marginLeft: 4 }}
      >
        {label}
      </Text>
      <View
        style={{
          backgroundColor: theme.card,
          borderRadius: theme.radiusTile,
          borderWidth: theme.hairline,
          borderColor: theme.cardBorder,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
      {footer ? (
        <Text style={{ color: theme.textWeak, fontSize: theme.fontMicro, lineHeight: 17, marginTop: 6, marginLeft: 4 }}>
          {footer}
        </Text>
      ) : null}
    </View>
  )
}

export function Row({
  label,
  value,
  onPress,
  last = false,
  danger = false,
  theme: themeProp,
}: {
  label: string
  value?: string
  onPress?: () => void
  last?: boolean
  danger?: boolean
  /** Kept for call sites that already hold a theme object. */
  theme?: Theme
}) {
  const themed = themeFor(useColorScheme())
  const theme = themeProp ?? themed
  const body = (
    <>
      <Text style={{ flex: 1, color: danger ? theme.danger : theme.text, fontSize: theme.fontBody, fontWeight: danger ? '600' : '400' }}>
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={2} style={{ maxWidth: '58%', textAlign: 'right', color: theme.textWeak, fontSize: theme.fontMeta }}>
          {value}
        </Text>
      ) : null}
      {onPress && !danger ? <ChevronRightIcon size={15} color={theme.textWeak} /> : null}
    </>
  )
  const style = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: theme.pad,
    minHeight: 48,
    borderBottomWidth: last ? 0 : theme.hairline,
    borderBottomColor: theme.cardBorder,
  }
  if (!onPress) return <View style={style}>{body}</View>
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}，${value}` : label}
      style={({ pressed }) => ({ ...style, backgroundColor: pressed ? theme.hover : 'transparent' })}
    >
      {body}
    </Pressable>
  )
}
