/** Connection banner: one quiet line, only when there is something to say. */

import { Pressable, Text, View, useColorScheme } from 'react-native'
import { useRouter } from 'expo-router'

import { bannerFor } from '../core/connection'
import { useApp } from '../stores/app'
import { themeFor } from '../theme'
import { CloseIcon } from './icons'

export function Banner() {
  const theme = themeFor(useColorScheme())
  const connection = useApp(state => state.connection)
  const pairing = useApp(state => state.pairing)
  const error = useApp(state => state.error)
  const dismiss = useApp(state => state.dismissError)
  const router = useRouter()

  if (error) {
    return (
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={`错误：${error}，点按关闭`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: theme.touch,
          backgroundColor: theme.card,
          borderBottomWidth: theme.hairline,
          borderBottomColor: theme.cardBorder,
          paddingHorizontal: theme.gutter,
          paddingVertical: 8,
        }}
      >
        <Text style={{ flex: 1, color: theme.danger, fontSize: theme.fontMeta, lineHeight: 19 }}>{error}</Text>
        <CloseIcon size={14} color={theme.textWeak} />
      </Pressable>
    )
  }

  const banner = bannerFor(connection, Boolean(pairing))
  if (!banner) return null

  return (
    <Pressable
      onPress={() => router.push('/pair')}
      style={{
        backgroundColor: theme.card,
        borderBottomWidth: theme.hairline,
        borderBottomColor: theme.cardBorder,
        paddingHorizontal: theme.gutter,
        paddingVertical: 9,
      }}
    >
      <Text style={{ color: banner.tone === 'warn' ? theme.warning : theme.textMedium, fontSize: theme.fontMicro, textAlign: 'center' }}>
        {banner.text}
      </Text>
    </Pressable>
  )
}
