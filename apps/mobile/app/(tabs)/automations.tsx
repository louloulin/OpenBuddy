/**
 * Scheduled tasks (20261115-mobile.md §1.4 gap list, §4.2 P1).
 *
 * Qwen and Kimi put "定时任务" on the home screen. The schedule itself lives
 * on the computer — the phone watches it, may trigger it now, and may pause
 * it. Editing a schedule stays on the desktop: a schedule is a promise about
 * the computer's own calendar, and the phone should not silently change it.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl,
  ScrollView, Text, TextInput, View, useColorScheme,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'

import { ClockIcon, PlayIcon } from '../../src/components/icons'
import {
  automationDraft,
  automationSavePayload,
  promptPreview,
  scheduleLabel,
  toAutomations,
  toggledStatus,
  validateAutomationDraft,
  type Automation,
  type AutomationDraft,
} from '../../src/core/automations'
import { canRun } from '../../src/core/surface'
import { isPreview, previewState } from '../../src/core/preview'
import { useApp } from '../../src/stores/app'
import { PageHeader } from '../../src/components/PageHeader'
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
  const [note, setNote] = useState<string | null>(null)
  const [draft, setDraft] = useState<AutomationDraft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSave = canRun(capabilities, 'automations_save') && canRun(capabilities, 'automations_snapshot')
  const canDelete = canRun(capabilities, 'automations_delete')

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
    // The review build has no desktop; acknowledge the tap so the flow reads.
    if (isPreview()) {
      setNote(`已开始运行「${automation.name}」`)
      setTimeout(() => setNote(null), 2600)
      return
    }
    if (!transport) return
    setBusyId(automation.id)
    try {
      await transport.invoke('automations_run', { id: automation.id })
      setNote(`已开始运行「${automation.name}」`)
      setTimeout(() => setNote(null), 2600)
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

  const openDraft = (automation?: Automation) => {
    setDraftError(null)
    setDraft(automationDraft(automation))
  }

  const saveDraft = async () => {
    if (!draft || !transport || saving) return
    const problem = validateAutomationDraft(draft)
    if (problem) {
      setDraftError(problem)
      return
    }
    setSaving(true)
    setDraftError(null)
    try {
      await transport.invoke('automations_save', { automation: automationSavePayload(draft) })
      setDraft(null)
      await load()
    } catch (failure) {
      setDraftError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (automation: Automation) => {
    if (!transport) return
    if (Platform.OS === 'web') {
      await deleteNow(automation)
      return
    }
    Alert.alert('删除这个定时任务？', `「${automation.name}」会从电脑上移除，运行记录保留。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => { void deleteNow(automation) } },
    ])
  }

  const deleteNow = async (automation: Automation) => {
    if (!transport) return
    setBusyId(automation.id)
    try {
      await transport.invoke('automations_delete', { id: automation.id })
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
      contentContainerStyle={{ paddingHorizontal: theme.gutter, paddingBottom: 24 + insets.bottom, gap: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={theme.textMedium} onRefresh={() => void refresh()} />}
    >
      <View style={{ marginHorizontal: -theme.gutter }}>
        <PageHeader title="自动化" />
      </View>
      {error ? (
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: 12 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      {note ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.ok, fontSize: 12, paddingHorizontal: 4 }}>
          {note}
        </Text>
      ) : null}

      {canSave ? (
        <Pressable
          onPress={() => openDraft()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: theme.radiusPill,
            backgroundColor: pressed ? theme.pressed : theme.card,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
          })}
        >
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>+ 新建定时任务</Text>
          <Text style={{ flex: 1, color: theme.textWeak, fontSize: 12, textAlign: 'right' }}>
            默认每天 09:00
          </Text>
        </Pressable>
      ) : null}

      {items.length === 0 && !refreshing ? (
        <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
          <ClockIcon size={26} color={theme.textWeak} />
          <Text style={{ color: theme.textWeak, fontSize: theme.fontMeta, textAlign: 'center', lineHeight: 20 }}>
            电脑上没有定时任务。{'\n'}在桌面端设置一个，它会出现在这里。
          </Text>
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
            {canSave ? (
              <Pressable onPress={() => openDraft(item)} disabled={busyId === item.id} style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
                <Text style={{ color: theme.textMedium, fontSize: 13 }}>编辑</Text>
              </Pressable>
            ) : null}
            {canDelete ? (
              <Pressable onPress={() => void remove(item)} disabled={busyId === item.id} style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
                <Text style={{ color: theme.danger, fontSize: 13 }}>删除</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}

      <Modal visible={draft !== null} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: theme.scrim }}
        >
          <View style={{
            backgroundColor: theme.card,
            borderRadius: 14,
            padding: 16,
            gap: 10,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
          }}>
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
              {draft?.id ? '编辑定时任务' : '新建定时任务'}
            </Text>
            {draftError ? <Text style={{ color: theme.danger, fontSize: 12 }}>{draftError}</Text> : null}
            <TextInput
              value={draft?.name ?? ''}
              onChangeText={name => setDraft(current => current ? { ...current, name } : current)}
              placeholder="任务名称，例如 每日晨报"
              placeholderTextColor={theme.textWeak}
              style={inputStyle(theme)}
            />
            <TextInput
              value={draft?.prompt ?? ''}
              onChangeText={prompt => setDraft(current => current ? { ...current, prompt } : current)}
              placeholder="要电脑做什么"
              placeholderTextColor={theme.textWeak}
              multiline
              style={{ ...inputStyle(theme), minHeight: 88, textAlignVertical: 'top' }}
            />
            <TextInput
              value={draft?.cwds ?? ''}
              onChangeText={cwds => setDraft(current => current ? { ...current, cwds } : current)}
              placeholder="工作目录（绝对路径，多个用逗号分隔）"
              placeholderTextColor={theme.textWeak}
              autoCapitalize="none"
              style={inputStyle(theme)}
            />
            <Text style={{ color: theme.textWeak, fontSize: 11, lineHeight: 16 }}>
              时间、技能与权限沿用桌面设置；新任务默认每天 09:00。
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 2 }}>
              <Pressable onPress={() => setDraft(null)}>
                <Text style={{ color: theme.textWeak, fontSize: 15 }}>取消</Text>
              </Pressable>
              <Pressable onPress={() => void saveDraft()} disabled={saving}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600', opacity: saving ? 0.5 : 1 }}>
                  {saving ? '保存中…' : '保存'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  )
}

function inputStyle(theme: ReturnType<typeof themeFor>) {
  return {
    color: theme.text,
    fontSize: 14,
    backgroundColor: theme.surface,
    borderRadius: 8,
    borderWidth: theme.hairline,
    borderColor: theme.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 9,
  } as const
}
