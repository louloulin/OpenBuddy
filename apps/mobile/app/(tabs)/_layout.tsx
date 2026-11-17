/**
 * Bottom tabs (20261115-mobile.md §4.1, §4.3).
 *
 * The desktop has a 260px sidebar; a phone turns it into a bottom bar. Icons are
 * the same line-art language as the desktop (lucide), the bar sits on the card
 * colour with a hairline top border, and a tab is only present when the paired
 * desktop advertises the command behind it.
 */

import { Tabs } from 'expo-router'
import { useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { visibleTabs } from '../../src/core/surface'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'
import { BellIcon, ChatIcon, ClockIcon, PersonIcon, SearchIcon } from '../../src/components/icons'

export default function TabsLayout() {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const capabilities = useApp(state => state.capabilities)
  const unread = useApp(state => state.notifications.filter(item => !item.read).length)
  const tabs = visibleTabs(capabilities)

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerShadowVisible: false,
        headerTintColor: theme.text,
        headerTitleStyle: { fontSize: 17, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopWidth: theme.hairline,
          borderTopColor: theme.cardBorder,
          // 72 = 28 icon band + 16 label band + padding; the inset clears the
          // home indicator. The label is given a fixed height and no shrink so
          // the item cannot squeeze it to a sliver (which clips text).
          height: 72 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8 + insets.bottom,
        },
        tabBarItemStyle: { paddingVertical: 0, justifyContent: 'flex-start' },
        tabBarIconStyle: { marginBottom: 4 },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '500', flexShrink: 0 },
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: theme.textWeak,
        sceneStyle: { backgroundColor: theme.surface },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '会话',
          href: tabs.sessions === false ? null : undefined,
          tabBarIcon: ({ color }) => <ChatIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: '搜索',
          href: tabs.search === false ? null : undefined,
          tabBarIcon: ({ color }) => <SearchIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: '通知',
          href: tabs.notifications === false ? null : undefined,
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.ink, color: theme.inkFg, fontSize: 10 },
          tabBarIcon: ({ color }) => <BellIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="automations"
        options={{
          title: '自动化',
          href: tabs.automations === false ? null : undefined,
          tabBarIcon: ({ color }) => <ClockIcon size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: '我',
          tabBarIcon: ({ color }) => <PersonIcon size={22} color={color} />,
        }}
      />
    </Tabs>
  )
}
