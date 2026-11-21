/**
 * 技能与指令 (20261117-mobile.md §4「技能/命令/提示词」P2).
 *
 * Read-only: the desktop installs, enables and edits skills and prompt
 * templates. The phone shows what exists so the user knows what the agent can
 * do and what `/` will offer.
 */

import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native'
import { useRouter } from 'expo-router'

import { ChevronRightIcon } from '../src/components/icons'
import { promptScopeLabel, skillScopeLabel, toPrompts, toSkills, type PromptEntry, type SkillEntry } from '../src/core/skills'
import { isPreview, previewState } from '../src/core/preview'
import { canRun } from '../src/core/surface'
import { useApp } from '../src/stores/app'
import { problemText } from '../src/core/problem'
import { themeFor } from '../src/theme'

export default function SkillsScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const transport = useApp(state => state.transport)
  const capabilities = useApp(state => state.capabilities)
  const currentCwd = useApp(state => state.currentCwd)

  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [prompts, setPrompts] = useState<PromptEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSkills = canRun(capabilities, 'skills_list')
  const canPrompts = canRun(capabilities, 'prompts_list')

  const load = useCallback(async () => {
    if (isPreview()) {
      setSkills(toSkills(previewState().skills))
      setPrompts(toPrompts(previewState().prompts))
      return
    }
    if (!transport) return
    setLoading(true)
    const cwd = currentCwd ?? undefined
    try {
      const [skillList, promptList] = await Promise.all([
        canSkills ? transport.invoke<unknown>('skills_list', cwd ? { cwd } : {}).catch(() => []) : Promise.resolve([]),
        canPrompts ? transport.invoke<unknown>('prompts_list', cwd ? { cwd } : {}).catch(() => []) : Promise.resolve([]),
      ])
      setSkills(toSkills(skillList))
      setPrompts(toPrompts(promptList))
      setError(null)
    } catch (failure) {
      setError(problemText(failure))
    } finally {
      setLoading(false)
    }
  }, [transport, canSkills, canPrompts, currentCwd])

  useEffect(() => { void load() }, [load])

  const back = (
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
  )

  const item = (title: string, detail: string, scope: string, muted: boolean, last: boolean) => (
    <View
      key={`${title}:${scope}`}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : theme.hairline,
        borderBottomColor: theme.cardBorder,
        opacity: muted ? 0.55 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 15 }}>{title}</Text>
        <Text style={{ color: theme.textWeak, fontSize: 11 }}>{scope}</Text>
      </View>
      {detail ? (
        <Text numberOfLines={2} style={{ color: theme.textWeak, fontSize: 12, marginTop: 3, lineHeight: 17 }}>{detail}</Text>
      ) : null}
    </View>
  )

  return (
    <View style={{ flex: 1, backgroundColor: theme.surface }}>
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
        {back}
        <Text style={{ flex: 1, color: theme.text, fontSize: 15, fontWeight: '600' }}>技能与指令</Text>
        {loading ? <ActivityIndicator size="small" color={theme.textWeak} /> : null}
      </View>

      {error ? (
        <View style={{ backgroundColor: theme.card, borderBottomWidth: theme.hairline, borderBottomColor: theme.cardBorder, padding: 12 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>
        {!canSkills && !canPrompts ? (
          <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
            <Text style={{ color: theme.textWeak, fontSize: 13, textAlign: 'center', lineHeight: 20 }}>
              这台电脑没有开放技能与指令。{'\n'}在桌面端管理后会自动出现在这里。
            </Text>
          </View>
        ) : (
          <>
            {canSkills ? (
              <View style={{ marginTop: 8 }}>
                <Text style={{ color: theme.textWeak, fontSize: 12, marginHorizontal: 16, marginTop: 8, marginBottom: 6 }}>
                  技能 · {skills.length}
                </Text>
                <View style={{ backgroundColor: theme.card, borderTopWidth: theme.hairline, borderBottomWidth: theme.hairline, borderColor: theme.cardBorder }}>
                  {skills.length === 0 ? (
                    <View style={{ padding: 16 }}>
                      <Text style={{ color: theme.textWeak, fontSize: 13 }}>还没有技能。</Text>
                    </View>
                  ) : skills.map((skill, index) => item(
                    skill.displayName ?? skill.name,
                    [skill.description, skill.version ? `v${skill.version}` : ''].filter(Boolean).join(' · '),
                    `${skillScopeLabel(skill.scope)}${skill.enabled ? '' : ' · 已停用'}${skill.market ? ' · 市场' : ''}`,
                    !skill.enabled,
                    index === skills.length - 1,
                  ))}
                </View>
              </View>
            ) : null}

            {canPrompts ? (
              <View style={{ marginTop: 18 }}>
                <Text style={{ color: theme.textWeak, fontSize: 12, marginHorizontal: 16, marginTop: 8, marginBottom: 6 }}>
                  我的指令 · {prompts.length}
                </Text>
                <View style={{ backgroundColor: theme.card, borderTopWidth: theme.hairline, borderBottomWidth: theme.hairline, borderColor: theme.cardBorder }}>
                  {prompts.length === 0 ? (
                    <View style={{ padding: 16 }}>
                      <Text style={{ color: theme.textWeak, fontSize: 13 }}>还没有指令模板。在输入框用 / 也能看到可用的命令。</Text>
                    </View>
                  ) : prompts.map((prompt, index) => item(
                    `/${prompt.name}`,
                    [prompt.description, prompt.argumentHint].filter(Boolean).join(' · '),
                    promptScopeLabel(prompt.scope),
                    false,
                    index === prompts.length - 1,
                  ))}
                </View>
              </View>
            ) : null}

            <Text style={{ color: theme.textWeak, fontSize: 11, marginHorizontal: 16, marginTop: 16, lineHeight: 17 }}>
              只读；安装、启停与编辑在电脑上完成。输入 / 会看到当前可用的命令。
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  )
}
