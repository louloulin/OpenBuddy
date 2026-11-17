/**
 * Session panel (20261115-mobile.md §1.4 gap list, §4.2 P1).
 *
 * Everything here belongs to the *session*, not to the chat: which persona
 * answers, how hard the model thinks, what the turn produced, and where the
 * desktop is working. Kimi and Qwen both put this one tap away from the
 * conversation; a phone that drives a desktop agent needs it just as much,
 * because these are the knobs a person actually reaches for mid-task.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'

import { ChevronRightIcon } from '../../src/components/icons'
import {
  thinkingLevelLabel,
  thinkingLevelPayload,
  toArtifacts,
  toExpertOptions,
  THINKING_LEVELS,
  type ArtifactEntry,
  type ExpertOption,
  type ThinkingLevel,
} from '../../src/core/session-panel'
import { isPreview, previewState } from '../../src/core/preview'
import { useApp } from '../../src/stores/app'
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
      <Text style={{ flex: 1, color: danger ? theme.danger : theme.text, fontSize: 14 }}>{label}</Text>
      {value ? (
        <Text numberOfLines={1} style={{ maxWidth: '55%', color: theme.textWeak, fontSize: 13 }}>{value}</Text>
      ) : null}
      {onPress && !danger ? <ChevronRightIcon size={15} color={theme.textWeak} /> : null}
    </View>
  )
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content
}

export default function SessionPanelScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const params = useLocalSearchParams<{ sessionId: string }>()
  const sessionId = decodeURIComponent(params.sessionId ?? '')

  const transport = useApp(state => state.transport)
  const session = useApp(state => state.sessions.find(item => item.id === sessionId))
  const capabilities = useApp(state => state.capabilities)

  const [experts, setExperts] = useState<ExpertOption[]>([])
  const [expertId, setExpertId] = useState<string | undefined>()
  const [thinking, setThinking] = useState<ThinkingLevel | undefined>()
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([])
  const [usage, setUsage] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // The design-review build has no desktop to ask; it renders the same panel
    // from the fixed dataset.
    if (isPreview()) {
      const demo = previewState().panel
      setExperts(toExpertOptions(demo?.experts ?? []))
      setThinking(demo?.thinkingLevel as ThinkingLevel | undefined)
      setArtifacts(toArtifacts(demo?.artifacts ?? []))
      setUsage(demo?.usage ? `${demo.usage.used} / ${demo.usage.total}` : undefined)
      return
    }
    if (!transport) return
    setBusy(true)
    setError(null)
    try {
      const [list, modelState, artifactList, sessionInfo] = await Promise.all([
        transport.invoke<unknown>('agents_list', {}).catch(() => []),
        transport.invoke<{ thinkingLevel?: string }>('agent_get_model_state', { sessionId }).catch(() => ({}) as { thinkingLevel?: string }),
        transport.invoke<unknown>('artifacts_list', { sessionId }).catch(() => []),
        transport.invoke<{ usage?: { used?: number; total?: number }; cwd?: string }>('agent_session_info', { sessionId }).catch(() => ({}) as { usage?: { used?: number; total?: number }; cwd?: string }),
      ])
      setExperts(toExpertOptions(list))
      const level = modelState?.thinkingLevel
      setThinking(typeof level === 'string' && (THINKING_LEVELS as readonly string[]).includes(level) ? level as ThinkingLevel : undefined)
      setArtifacts(toArtifacts(artifactList))
      const used = sessionInfo?.usage?.used
      const total = sessionInfo?.usage?.total
      setUsage(typeof used === 'number' && typeof total === 'number' ? `${used} / ${total}` : undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }, [transport, sessionId])

  useEffect(() => { void load() }, [load])

  const pickExpert = async (id: string) => {
    if (!transport) return
    setBusy(true)
    try {
      await transport.invoke('agent_set_session_expert', { sessionId, expertId: id })
      setExpertId(id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const setLevel = async (level: string) => {
    const payload = thinkingLevelPayload(level)
    if (!payload || !transport) return
    setBusy(true)
    try {
      await transport.invoke('agent_set_thinking_level', { sessionId, ...payload })
      setThinking(payload.level)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const canSetExpert = Boolean(capabilities?.commands.includes('agent_set_session_expert'))
  const canSetThinking = Boolean(capabilities?.commands.includes('agent_set_thinking_level'))

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
      {/* In-flow header, like the desktop's `.main-topbar`: one line, no shadow. */}
      <View
        style={{
          height: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          borderBottomWidth: theme.hairline,
          borderBottomColor: theme.cardBorder,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? theme.pressed : 'transparent',
          })}
        >
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <ChevronRightIcon size={18} color={theme.text} />
          </View>
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>
          {session?.title ?? '会话'}
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingTop: 12, paddingBottom: 40 }}
      >
      <Text style={{ color: theme.textWeak, fontSize: 12, marginBottom: 18 }}>
        会话设置改动会立刻作用在电脑上的这一轮对话。
      </Text>

      {error ? (
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: 12, marginBottom: 16 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <Section theme={theme} label="人格">
        {experts.length === 0 ? (
          <Row theme={theme} label="这台电脑没有可用的专家" value={canSetExpert ? '跟随桌面默认' : '未开放'} last />
        ) : (
          experts.map((expert, index) => (
            <Row
              key={expert.id}
              theme={theme}
              label={expert.name}
              value={expert.id === expertId ? '当前' : undefined}
              onPress={canSetExpert ? () => void pickExpert(expert.id) : undefined}
              last={index === experts.length - 1}
            />
          ))
        )}
      </Section>

      <Section theme={theme} label="思考深度">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12 }}>
          {THINKING_LEVELS.map(level => {
            const active = thinking === level
            return (
              <Pressable
                key={level}
                onPress={() => void setLevel(level)}
                disabled={!canSetThinking || busy}
                style={({ pressed }) => ({
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 999,
                  borderWidth: theme.hairline,
                  borderColor: active ? theme.ink : theme.cardBorder,
                  backgroundColor: active ? theme.ink : pressed ? theme.hover : 'transparent',
                  opacity: canSetThinking ? 1 : 0.45,
                })}
              >
                <Text style={{ color: active ? theme.inkFg : theme.textMedium, fontSize: 13 }}>
                  {thinkingLevelLabel(level)}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </Section>

      <Section theme={theme} label="本轮产物">
        {artifacts.length === 0 ? (
          <Row theme={theme} label="还没有产物" last />
        ) : (
          artifacts.map((artifact, index) => (
            <Row
              key={artifact.path}
              theme={theme}
              label={artifact.path.split('/').pop() ?? artifact.path}
              value={artifact.kind ?? undefined}
              last={index === artifacts.length - 1}
            />
          ))
        )}
      </Section>

      <Section theme={theme} label="用量">
        <Row theme={theme} label="上下文" value={usage ?? '桌面未提供'} last />
      </Section>

      <Section theme={theme} label="资料">
        <Row
          theme={theme}
          label="电脑上的文件"
          value="只读"
          onPress={() => router.push(`/files?sessionId=${encodeURIComponent(sessionId)}`)}
          last
        />
      </Section>

      {busy ? (
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <ActivityIndicator color={theme.textWeak} />
        </View>
      ) : null}

      </ScrollView>
    </View>
  )
}
