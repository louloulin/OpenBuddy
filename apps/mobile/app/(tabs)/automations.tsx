/**
 * Scheduled tasks (20261115-mobile.md §1.4 gap list, §4.2 P1).
 *
 * Qwen and Kimi put "定时任务" on the home screen. The schedule itself lives
 * on the computer — the phone watches it, may trigger it now, and may pause
 * it. Editing a schedule stays on the desktop: a schedule is a promise about
 * the computer's own calendar, and the phone should not silently change it.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { ClockIcon, PlayIcon } from '../../src/components/icons'
import {
  promptPreview,
  scheduleLabel,
  toAutomations,
  toggledStatus,
  type Automation,
} from '../../src/core/automations'
import { canRun } from '../../src/core/surface'
import { isPreview, previewState } from '../../src/core/preview'
import { useApp } from '../../src/stores/app'
import { themeFor } from '../../src/theme'

export default function AutomationsScreen() {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const transport = useApp(state => state.transport)
  const capabilities = useApp(state => state.capabilities)

  const [items, setItems] = useState<Automation[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // The design-review build has no desktop to ask; it renders the same list
    // from the fixed dataset.
    if (isPreview()) {
      setItems(previewState().automations)
      return
    }
    if (!transport) return
    try {
      const snapshot = await transport.invoke<unknown>('automations_snapshot', {})
      setItems(toAutomations(snapshot))
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [transport])

  useEffect(() => { void load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const runNow = async (automation: Automation) => {
    if (!transport) return
    setBusyId(automation.id)
    try {
      await transport.invoke('automations_run', { id: automation.id })
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusyId(null)
    }
  }

  const toggle = async (automation: Automation) => {
    if (!transport) return
    setBusyId(automation.id)
    try {
      await transport.invoke('automations_set_status', { id: automation.id, status: toggledStatus(automation) })
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusyId(null)
    }
  }

  if (!canRun(capabilities, 'automations_snapshot')) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }}>
        <ClockIcon size={26} color={theme.textWeak} />
        <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
          这台电脑没有开放定时任务。{'\n'}任务本身在电脑上设置。
        </Text>
      </View>
    )
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom, gap: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.textMedium} onRefresh={() => void refresh()} />}
    >
      {error ? (
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: 12 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      {items.length === 0 && !refreshing ? (
        <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
          <ClockIcon size={26} color={theme.textWeak} />
          <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
            电脑上没有定时任务。{'\n'}在桌面端设置一个，它会出现在这里。
          </Text>
          <Pressable onPress={() => router.back()} style={{ padding: 8 }}>
            <Text style={{ color: theme.text, fontSize: 13 }}>返回</Text>
          </Pressable>
        </View>
      ) : null}

      {items.map(item => (
        <View
          key={item.id}
          style={{
            backgroundColor: theme.card,
            borderRadius: 14,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
            padding: 14,
            gap: 8,
            opacity: item.status === 'PAUSED' ? 0.62 : 1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
              {item.name}
            </Text>
            {item.status === 'PAUSED' ? (
              <View style={{ backgroundColor: theme.pressed, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: theme.textMedium, fontSize: 10 }}>已暂停</Text>
              </View>
            ) : null}
          </View>
          {promptPreview(item) ? (
            <Text numberOfLines={2} style={{ color: theme.textWeak, fontSize: 13, lineHeight: 19 }}>
              {promptPreview(item)}
            </Text>
          ) : null}
          {scheduleLabel(item) ? (
            <Text style={{ color: theme.textWeak, fontSize: 12 }}>{scheduleLabel(item)}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
            <Pressable
              onPress={() => void runNow(item)}
              disabled={busyId === item.id}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: theme.radiusPill,
                backgroundColor: pressed ? theme.pressed : theme.card,
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                opacity: busyId === item.id ? 0.5 : 1,
              })}
            >
              {busyId === item.id
                ? <ActivityIndicator size="small" color={theme.textMedium} />
                : <PlayIcon size={13} color={theme.textMedium} />}
              <Text style={{ color: theme.textMedium, fontSize: 13 }}>立即运行</Text>
            </Pressable>
            <Pressable
              onPress={() => void toggle(item)}
              disabled={busyId === item.id}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: theme.radiusPill,
                backgroundColor: pressed ? theme.pressed : 'transparent',
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                opacity: busyId === item.id ? 0.5 : 1,
              })}
            >
              <Text style={{ color: theme.textMedium, fontSize: 13 }}>
                {item.status === 'ACTIVE' ? '暂停' : '启用'}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  )
}
