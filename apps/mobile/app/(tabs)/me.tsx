/**
 * "Me" (20261115-mobile.md §4.2 P1, §4.3).
 *
 * The phone's settings surface, in the desktop's grouped-card idiom: a section
 * label above a rounded card whose rows are separated by hairlines, with a
 * chevron on rows that lead somewhere. Management stays on the desktop, and
 * saying so out loud is the point of this screen.
 */

import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { SparkIcon } from '../../src/components/icons'
import { Row as SharedRow, Section as SharedSection } from '../../src/components/SettingsList'
import { PageHeader } from '../../src/components/PageHeader'
import { canRun, unavailableReason } from '../../src/core/surface'
import { useApp } from '../../src/stores/app'
import { clearPairing } from '../../src/transport'
import { pushAvailability, type PushAvailability } from '../../src/native/notifications'
import { clearCache } from '../../src/db/cache'
import { themeFor, type Theme } from '../../src/theme'

const Section = (props: { theme: Theme; label: string; children: React.ReactNode }) => (
  <SharedSection label={props.label}>{props.children}</SharedSection>
)
const Row = SharedRow

const PUSH_LABEL: Record<PushAvailability, string> = {
  ready: '已开启',
  denied: '未授权',
  simulator: '仅真机',
  unconfigured: '未配置 EAS',
  unsupported: '仅真机',
}

const PUSH_HINT: Record<PushAvailability, string> = {
  ready: '离开应用后，审批与完成会推送到这台手机。',
  denied: '系统里关闭了通知权限，可在设置中重新允许。',
  simulator: '模拟器和浏览器收不到推送；真机安装后自动登记。',
  unconfigured: '这个构建没有填 EAS 项目 id，无法生成推送 token。',
  unsupported: '当前环境不支持推送；审批仍会出现在通知页。',
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
  const pairings = useApp(state => state.pairings)
  const activePairingId = useApp(state => state.activePairingId)
  const switchPairing = useApp(state => state.switchPairing)
  const [busyPairing, setBusyPairing] = useState(false)
  const [push, setPush] = useState<PushAvailability>('unsupported')

  useEffect(() => {
    let alive = true
    void pushAvailability().then(value => { if (alive) setPush(value) })
    return () => { alive = false }
  }, [])

  const switchTo = async (id: string) => {
    setBusyPairing(true)
    try {
      await switchPairing(id)
    } finally {
      setBusyPairing(false)
    }
  }

  const toggleLock = async () => {
    const result = await setAppLock(!appLock)
    if (!result.ok && result.reason) Alert.alert('应用锁', result.reason)
  }

  const confirmUnpair = () => {
    Alert.alert('断开这台电脑？', '设备凭证会从本机删除，需要重新扫码才能连接。其他已配对的电脑不受影响。', [
      { text: '取消', style: 'cancel' },
      {
        text: '断开',
        style: 'destructive',
        onPress: async () => {
          await unpair()
          await clearCache().catch(() => {})
          const stillPaired = useApp.getState().pairing
          if (!stillPaired) {
            await clearPairing().catch(() => {})
            router.replace('/pair')
          }
        },
      },
    ])
  }

  const explain = (command: string) => Alert.alert('桌面专属', unavailableReason(command))
  const statusText = connection === 'open' ? '已连接' : connection === 'connecting' ? '连接中' : '已断开'

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{ paddingHorizontal: theme.gutter, paddingBottom: 24 + insets.bottom }}
    >
      <PageHeader title="我" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22, paddingHorizontal: 2 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.ink,
          }}
        >
          <SparkIcon size={21} color={theme.inkFg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: theme.fontHeading, fontWeight: '700' }}>OpenBuddy</Text>
          <Text style={{ color: theme.textWeak, fontSize: theme.fontMeta, marginTop: 2 }}>
            {pairing ? `${pairing.deviceName} · ${statusText}` : '未连接电脑'}
          </Text>
        </View>
      </View>

      <Section theme={theme} label="连接">
        <Row theme={theme} label="电脑" value={pairing ? pairing.gatewayUrl.replace(/^https?:\/\//, '') : '未连接'} />
        <Row theme={theme} label="设备" value={pairing?.deviceName ?? '这台手机'} />
        <Row theme={theme} label="状态" value={statusText} last />
      </Section>

      <Section theme={theme} label="已配对的电脑">
        {pairings.length === 0 ? (
          <Row theme={theme} label="还没有配对" value="扫码接入" />
        ) : (
          pairings.map(record => {
            const active = record.id === activePairingId
            return (
              <Row
                key={record.id}
                theme={theme}
                label={record.label}
                value={active ? (busyPairing ? '切换中…' : '当前') : '切换'}
                onPress={active || busyPairing ? undefined : () => void switchTo(record.id)}
                last={false}
              />
            )
          })
        )}
        <Row
          theme={theme}
          label="接入另一台电脑"
          value="扫码"
          onPress={() => router.push('/pair')}
          last
        />
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

      <Section theme={theme} label="通知">
        <Row
          theme={theme}
          label="推送通知"
          value={PUSH_LABEL[push]}
          onPress={() => Alert.alert('推送通知', PUSH_HINT[push])}
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
