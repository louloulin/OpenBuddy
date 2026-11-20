/**
 * The one page header for tab screens (20261117-mobile.md §9.26).
 *
 * Before this file every tab had its own idea of a title: a 28pt wordmark on the
 * session list, the navigator's 17pt native title on 搜索 / 通知 / 自动化, and a
 * bespoke 19pt block on 「我」. Moving between tabs made the title jump three
 * sizes and two baselines. Grok keeps one large title per tab, always at the same
 * height, with the screen's primary action on the same baseline at the right.
 */

import { Text, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { themeFor } from '../theme'

export function PageHeader({
  title,
  trailing,
  subtitle,
}: {
  title: string
  /** Right-hand action on the title baseline (「全部标为已读」, 「选择」…). */
  trailing?: React.ReactNode
  /** One quiet line under the title, when the screen needs to explain itself. */
  subtitle?: string
}) {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        paddingTop: insets.top + 12,
        paddingHorizontal: theme.gutter,
        paddingBottom: subtitle ? 6 : 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text
          accessibilityRole="header"
          style={{ flex: 1, color: theme.text, fontSize: theme.fontTitle, fontWeight: '700', letterSpacing: -0.6 }}
        >
          {title}
        </Text>
        {trailing}
      </View>
      {subtitle ? (
        <Text style={{ color: theme.textWeak, fontSize: theme.fontMeta, marginTop: 4, lineHeight: 19 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  )
}
