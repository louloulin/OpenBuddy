/**
 * "Me" (20261115-mobile.md §4.2 P1, §4.3).
 *
 * The phone's settings surface, in the desktop's grouped-card idiom: a section
 * label above a rounded card whose rows are separated by hairlines, with a
 * chevron on rows that lead somewhere. Management stays on the desktop, and
 * saying so out loud is the point of this screen.
 */

import { Alert, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { ChevronRightIcon, SparkIcon } from '../../src/components/icons'
import { canRun, unavailableReason } from '../../src/core/surface'
import { useApp } from '../../src/stores/app'
import { clearPairing } from '../../src/transport'
import { clearCache } from '../../src/db/cache'
import { themeFor, type Theme } from '../../src/theme'

function Section({ theme, label, children }: { theme: Theme; label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={{ color: theme.textWeak, fontSize: 12, fontWeight: '600', marginBottom: 8, marginLeft: 4 }}>
        {label}
      </Text>
      <View
        style={{
          backgroundColor: theme.card,
          borderRadius: 14,
          borderWidth: theme.hairline,
          borderColor: theme.cardBorder,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  )
}

function Row({
  theme, label, value, onPress, last = false, danger = false,
}: {
  theme: Theme
  label: string
  value?: string
  onPress?: () => void
  last?: boolean
  danger?: boolean
}) {
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        minHeight: 48,
        borderBottomWidth: last ? 0 : theme.hairline,
        borderBottomColor: theme.cardBorder,
      }}
    >
      <Text style={{ flex: 1, color: danger ? theme.danger : theme.text, fontSize: 14, fontWeight: danger ? '600' : '400' }}>
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={1} style={{ maxWidth: '55%', color: theme.textWeak, fontSize: 13 }}>{value}</Text>
      ) : null}
      {onPress && !danger ? <ChevronRightIcon size={15} color={theme.textWeak} /> : null}
    </View>
  )
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content
}

export default function MeScreen() {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pairing = useApp(state => state.pairing)
  const connection = useApp(state => state.connection)
  const capabilities = useApp(state => state.capabilities)
  const appLock = useApp(state => state.appLock)
  const setAppLock = useApp(state => state.setAppLock)
  const autoSpeak = useApp(state => state.autoSpeak)
  const setAutoSpeak = useApp(state => state.setAutoSpeak)
  const unpair = useApp(state => state.unpair)

  const toggleLock = async () => {
    const result = await setAppLock(!appLock)
    if (!result.ok && result.reason) Alert.alert('应用锁', result.reason)
  }

  const confirmUnpair = () => {
    Alert.alert('断开这台电脑？', '设备凭证会从本机删除，需要重新扫码才能连接。', [
      { text: '取消', style: 'cancel' },
      {
        text: '断开',
        style: 'destructive',
        onPress: async () => {
          await unpair()
          await clearPairing().catch(() => {})
          await clearCache().catch(() => {})
          router.replace('/pair')
        },
      },
    ])
  }

  const explain = (command: string) => Alert.alert('桌面专属', unavailableReason(command))
  const statusText = connection === 'open' ? '已连接' : connection === 'connecting' ? '连接中' : '已断开'

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{ padding: 16, paddingTop: 12, paddingBottom: 24 + insets.bottom }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24, paddingHorizontal: 2 }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.ink,
          }}
        >
          <SparkIcon size={22} color={theme.inkFg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>OpenBuddy</Text>
          <Text style={{ color: theme.textWeak, fontSize: 12, marginTop: 2 }}>
            {pairing ? `${pairing.gatewayUrl.replace(/^https?:\/\//, '')} · ${statusText}` : '未连接电脑'}
          </Text>
        </View>
      </View>

      <Section theme={theme} label="连接">
        <Row theme={theme} label="电脑" value={pairing?.gatewayUrl ?? '未连接'} />
        <Row theme={theme} label="设备" value={pairing?.deviceName ?? '这台手机'} />
        <Row theme={theme} label="状态" value={statusText} last />
      </Section>

      <Section theme={theme} label="桌面功能">
        <Row
          theme={theme}
          label="专家 · 人格"
          value={canRun(capabilities, 'experts_load') ? '跟随桌面' : '未开放'}
          onPress={() => (canRun(capabilities, 'experts_load')
            ? Alert.alert('专家', '在桌面端选择专家，手机端会跟随当前会话。')
            : explain('experts_load'))}
        />
        <Row
          theme={theme}
          label="文件"
          value={canRun(capabilities, 'list_dir') ? '只读浏览' : '未开放'}
          onPress={() => (canRun(capabilities, 'list_dir')
            ? router.push('/files')
            : explain('list_dir'))}
        />
        <Row
          theme={theme}
          label="记忆"
          value={canRun(capabilities, 'memory_list') ? '浏览与编辑' : '未开放'}
          onPress={() => (canRun(capabilities, 'memory_list')
            ? router.push('/memory')
            : explain('memory_list'))}
        />
        <Row
          theme={theme}
          label="资料库"
          value={canRun(capabilities, 'library_list') ? '只读浏览' : '未开放'}
          onPress={() => (canRun(capabilities, 'library_list')
            ? router.push('/library')
            : explain('library_list'))}
        />
        <Row theme={theme} label="模型与密钥" value="仅在电脑上" onPress={() => explain('providers_save_provider')} />
        <Row theme={theme} label="文件写入" value="仅在电脑上" onPress={() => explain('write_text_file')} last />
      </Section>

      <Section theme={theme} label="语音">
        <Row
          theme={theme}
          label="回复自动播报"
          value={autoSpeak ? '已开启' : '关闭'}
          onPress={() => void setAutoSpeak(!autoSpeak)}
          last
        />
      </Section>

      <Section theme={theme} label="安全">
        <Row theme={theme} label="应用锁" value={appLock ? '已开启' : '关闭'} onPress={() => void toggleLock()} />
        <Row theme={theme} label="凭证存储" value="系统钥匙串" />
        <Row theme={theme} label="模型密钥" value="从不离开电脑" />
        <Row theme={theme} label="传输" value="HTTPS / 端到端配对" last />
      </Section>

      <Section theme={theme} label="设备">
        <Row theme={theme} label="断开这台电脑" onPress={confirmUnpair} danger last />
      </Section>

      <Text style={{ color: theme.textWeak, fontSize: 11, textAlign: 'center', marginBottom: 8 }}>
        OpenBuddy Mobile 0.1.0
      </Text>
    </ScrollView>
  )
}
