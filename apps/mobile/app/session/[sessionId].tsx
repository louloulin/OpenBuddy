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
import { permissionModeLabel } from '../../src/core/approvals'
import { permissionRuleLabel, permissionRuleSummary, permissionRules, type PermissionRule } from '../../src/core/permissions'
import {
  formatUsage,
  resolveArtifactPath,
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
import { canRun } from '../../src/core/surface'
import { transcriptFilename, transcriptMarkdown } from '../../src/core/share'
import { shareTextFile } from '../../src/native/share'
import { useApp } from '../../src/stores/app'
import { Row, Section } from '../../src/components/SettingsList'
import { problemText } from '../../src/core/problem'
import { ArrowLeftIcon } from '../../src/components/icons'
import { themeFor } from '../../src/theme'

export default function SessionPanelScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const params = useLocalSearchParams<{ sessionId: string }>()
  const sessionId = decodeURIComponent(params.sessionId ?? '')

  const transport = useApp(state => state.transport)
  const openSession = useApp(state => state.openSession)
  const exportSession = useApp(state => state.exportSession)
  const session = useApp(state => state.sessions.find(item => item.id === sessionId))
  const transcript = useApp(state => state.transcripts[sessionId])
  const capabilities = useApp(state => state.capabilities)
  const permissionMode = useApp(state => state.permissionMode)
  const currentCwd = useApp(state => state.currentCwd)
  // Experts and skills are workspace-scoped; the panel must ask about the
  // session's workspace, not whatever session the desktop happens to focus.
  const sessionCwd = session?.cwd ?? currentCwd ?? undefined

  const [experts, setExperts] = useState<ExpertOption[]>([])
  const [expertId, setExpertId] = useState<string | undefined>()
  const [thinking, setThinking] = useState<ThinkingLevel | undefined>()
  const [model, setModel] = useState<string | undefined>()
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([])
  const [rules, setRules] = useState<PermissionRule[]>([])
  const [cwd, setCwd] = useState<string | undefined>()
  const [usage, setUsage] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // The design-review build has no desktop to ask; it renders the same panel
    // from the fixed dataset.
    if (isPreview()) {
      const demo = previewState().panel
      setExperts(toExpertOptions(demo?.experts ?? []))
      setExpertId(demo?.experts?.[0]?.id)
      setThinking(demo?.thinkingLevel as ThinkingLevel | undefined)
      setModel(demo?.model)
      setArtifacts(toArtifacts(demo?.artifacts ?? []))
      setRules(permissionRules(demo?.rules ?? []))
      setCwd(previewState().sessions.find(item => item.id === sessionId)?.cwd)
      setUsage(formatUsage(demo?.usage))
      return
    }
    if (!transport) return
    setBusy(true)
    setError(null)
    try {
      const [list, modelState, artifactList, sessionInfo, ruleList] = await Promise.all([
        transport.invoke<unknown>('agents_list', sessionCwd ? { cwd: sessionCwd } : {}).catch(() => []),
        transport.invoke<{ thinkingLevel?: string; modelId?: string; expert?: { id?: string; expertId?: string } | null }>('agent_get_model_state', { sessionId }).catch(() => ({}) as { thinkingLevel?: string; modelId?: string; expert?: { id?: string; expertId?: string } | null }),
        transport.invoke<unknown>('artifacts_list', { sessionId }).catch(() => []),
        transport.invoke<{ usage?: { used?: number; total?: number }; cwd?: string }>('agent_session_info', { sessionId }).catch(() => ({}) as { usage?: { used?: number; total?: number }; cwd?: string }),
        // Read-only: the desktop owns rule editing (设置·安全中心).
        canRun(capabilities, 'permission_list')
          ? transport.invoke<unknown>('permission_list', {}).catch(() => [])
          : Promise.resolve([]),
      ])
      setExperts(toExpertOptions(list))
      const level = modelState?.thinkingLevel
      setThinking(typeof level === 'string' && (THINKING_LEVELS as readonly string[]).includes(level) ? level as ThinkingLevel : undefined)
      setModel(typeof modelState?.modelId === 'string' ? modelState.modelId : undefined)
      // The bound expert lives on the branch, so it must be read rather than
      // remembered; otherwise every remount forgets the "当前" marker.
      setExpertId(modelState?.expert?.id ?? modelState?.expert?.expertId)
      setArtifacts(toArtifacts(artifactList))
      setRules(permissionRules(ruleList))
      setCwd(typeof sessionInfo?.cwd === 'string' ? sessionInfo.cwd : undefined)
      setUsage(formatUsage(sessionInfo?.usage))
    } catch (failure) {
      // The desktop answers in its own idiom (`EACCES: permission denied`);
      // `problemText` turns that into something a user can act on.
      setError(problemText(failure))
    } finally {
      setBusy(false)
    }
  }, [transport, sessionId, capabilities, sessionCwd])

  useEffect(() => { void load() }, [load])

  // The panel can be opened without visiting the chat first; loading the
  // transcript here is what makes "导出 Markdown" available.
  useEffect(() => {
    if (sessionId) void openSession(sessionId)
  }, [sessionId, openSession])

  const pickExpert = async (id: string) => {
    if (!transport) return
    setBusy(true)
    try {
      await transport.invoke('agent_set_session_expert', { sessionId, expertId: id })
      setExpertId(id)
    } catch (failure) {
      // The desktop answers in its own idiom (`EACCES: permission denied`);
      // `problemText` turns that into something a user can act on.
      setError(problemText(failure))
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
      // The desktop answers in its own idiom (`EACCES: permission denied`);
      // `problemText` turns that into something a user can act on.
      setError(problemText(failure))
    } finally {
      setBusy(false)
    }
  }

  // The desktop writes the JSONL, the phone fetches it back as text and hands
  // it to the OS share sheet. A truncated read would produce a broken export,
  // so an over-16MB session is refused with a pointer to the desktop.
  const runExport = async () => {
    if (isPreview()) {
      setExportNote('演示：桌面写入 JSONL 后交给系统分享')
      return
    }
    if (exporting) return
    setExporting(true)
    setError(null)
    setExportNote(null)
    try {
      const { filename, content, entries } = await exportSession(sessionId)
      const result = await shareTextFile(filename, content)
      setExportNote(
        result === 'downloaded' ? `已下载 ${entries} 条记录`
          : result === 'shared' ? '已打开分享面板'
            : '这台设备不支持文件分享',
      )
    } catch (failure) {
      // The desktop answers in its own idiom (`EACCES: permission denied`);
      // `problemText` turns that into something a user can act on.
      setError(problemText(failure))
    } finally {
      setExporting(false)
    }
  }

  // The transcript is already on the phone, so E2 shares it without asking the
  // desktop for a save grant (which needs a native dialog the phone cannot show).
  const shareMarkdown = async () => {
    if (isPreview()) {
      setExportNote('演示：整段会话导出为 Markdown')
      return
    }
    if (!transcript?.rows.length) return
    setExportNote(null)
    try {
      const title = session?.title ?? ''
      const result = await shareTextFile(
        transcriptFilename(title, sessionId),
        transcriptMarkdown(transcript, title),
      )
      setExportNote(result === 'downloaded' ? '已下载整段会话' : result === 'shared' ? '已打开分享面板' : '这台设备不支持文件分享')
    } catch (failure) {
      // The desktop answers in its own idiom (`EACCES: permission denied`);
      // `problemText` turns that into something a user can act on.
      setError(problemText(failure))
    }
  }

  const canSetExpert = Boolean(capabilities?.commands.includes('agent_set_session_expert'))
  const canSetThinking = Boolean(capabilities?.commands.includes('agent_set_thinking_level'))
  const canExport = Boolean(capabilities?.commands.includes('agent_export_jsonl'))
  const canShareMarkdown = Boolean(transcript?.rows.length)

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
          accessibilityLabel="返回"
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
        contentContainerStyle={{ paddingHorizontal: theme.gutter, paddingBottom: 40 }}
      >
      <Text style={{ color: theme.textWeak, fontSize: theme.fontMeta, marginTop: 4, marginBottom: 18, lineHeight: 19 }}>
        会话设置改动会立刻作用在电脑上的这一轮对话。
      </Text>

      {error ? (
        <View style={{ backgroundColor: theme.card, borderRadius: theme.radiusTile, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: theme.pad, marginBottom: 16 }}>
          <Text style={{ color: theme.danger, fontSize: theme.fontMeta }}>{error}</Text>
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
        {/* One swipeable row: wrapping left "最高" stranded on a second line. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row', gap: 6, padding: 10 }}
        >
          {THINKING_LEVELS.map(level => {
            const active = thinking === level
            return (
              <Pressable
                key={level}
                onPress={() => void setLevel(level)}
                disabled={!canSetThinking || busy}
                style={({ pressed }) => ({
                  paddingHorizontal: 9,
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
        </ScrollView>
      </Section>

      <Section theme={theme} label="模型">
        {/* Read-only: switching the model needs provider auth, which is desktop-only. */}
        <Row theme={theme} label="当前模型" value={model ?? '跟随桌面'} last />
      </Section>

      <Section theme={theme} label="本轮产物">
        {artifacts.length === 0 ? (
          <Row theme={theme} label="还没有产物" last />
        ) : (
          artifacts.map((artifact, index) => {
            // Tap opens the read-only preview; the desktop still owns writes.
            const full = resolveArtifactPath(artifact.path, cwd)
            return (
              <Row
                key={artifact.path}
                theme={theme}
                label={artifact.path.split('/').pop() ?? artifact.path}
                value={artifact.kind ?? undefined}
                onPress={full && canRun(capabilities, 'read_text_file')
                  ? () => router.push(`/files?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(full)}`)
                  : undefined}
                last={index === artifacts.length - 1}
              />
            )
          })
        )}
      </Section>

      <Section theme={theme} label="用量">
        <Row theme={theme} label="上下文" value={usage ?? '桌面未提供'} last />
      </Section>

      <Section theme={theme} label="权限" footer={canRun(capabilities, 'permission_list') ? permissionRuleSummary(rules) : undefined}>
        <Row theme={theme} label="审批模式" value={permissionModeLabel(permissionMode)} last={!canRun(capabilities, 'permission_list') || rules.length === 0} />
        {canRun(capabilities, 'permission_list') && rules.length > 0
          ? rules.slice(0, 8).map((rule, index) => (
            <Row
              key={`${rule.action}:${rule.tool}:${rule.pattern ?? ''}:${index}`}
              theme={theme}
              label={permissionRuleLabel(rule)}
              last={index === Math.min(rules.length, 8) - 1}
            />
          ))
          : null}
        {canRun(capabilities, 'permission_list') && rules.length > 8
          ? <Row theme={theme} label="还有更多规则" value={`${rules.length - 8} 条`} last />
          : null}
      </Section>

      <Section theme={theme} label="资料">
        {canShareMarkdown ? (
          <Row
            theme={theme}
            label="导出 Markdown"
            value="整段分享"
            onPress={() => void shareMarkdown()}
          />
        ) : null}
        {canExport ? (
          <Row
            theme={theme}
            label="导出会话"
            value={exporting ? '导出中…' : 'JSONL'}
            onPress={exporting ? undefined : () => void runExport()}
          />
        ) : null}
        <Row
          theme={theme}
          label="电脑上的文件"
          value="只读"
          onPress={() => router.push(`/files?sessionId=${encodeURIComponent(sessionId)}`)}
        />
        <Row
          theme={theme}
          label="分支与检查点"
          value="切换 / 恢复"
          onPress={() => router.push(`/branches/${encodeURIComponent(sessionId)}`)}
          last
        />
        {exportNote ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
            <Text style={{ color: theme.textWeak, fontSize: 12 }}>{exportNote}</Text>
          </View>
        ) : null}
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
