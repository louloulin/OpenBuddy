/**
 * One pending decision (20261117-mobile.md 阶段 B).
 *
 * Permission, extension UI questions and folder trust all stop the same turn,
 * so they share one card family. The card renders exactly the answers the
 * desktop accepts: permission options by id, question value/cancelled, trust
 * boolean.
 */

import { useState } from 'react'
import { Pressable, Text, TextInput, View, useColorScheme } from 'react-native'

import type { Approval } from '../core/models'
import type { ApprovalAction } from '../core/approvals'
import { themeFor } from '../theme'
import { CheckIcon, CloseIcon, SparkIcon } from './icons'

function Pill({
  theme, label, primary, danger, onPress, disabled,
}: {
  theme: ReturnType<typeof themeFor>
  label: string
  primary?: boolean
  danger?: boolean
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 38,
        paddingHorizontal: 10,
        borderRadius: theme.radiusPill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: primary ? theme.ink : theme.card,
        borderWidth: primary ? 0 : theme.hairline,
        borderColor: theme.cardBorder,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {danger ? <CloseIcon size={14} color={theme.danger} /> : primary ? <CheckIcon size={14} color={theme.inkFg} /> : null}
      <Text style={{
        color: danger ? theme.danger : primary ? theme.inkFg : theme.text,
        fontSize: 13,
        fontWeight: '600',
      }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function RequestCard({
  approval, onAction, busy = false, compact = false,
}: {
  approval: Approval
  onAction: (action: ApprovalAction) => void
  busy?: boolean
  compact?: boolean
}) {
  const theme = themeFor(useColorScheme())
  const [value, setValue] = useState(approval.initialValue ?? '')

  return (
    <View style={{ paddingHorizontal: compact ? theme.gutter : 0, paddingVertical: compact ? 8 : 0 }}>
      <View
        style={{
          backgroundColor: theme.card,
          borderRadius: 16,
          borderWidth: theme.hairline,
          borderColor: theme.cardBorder,
          padding: 14,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SparkIcon size={16} color={theme.warning} />
          <Text style={{ flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' }}>{approval.title}</Text>
        </View>
        {approval.detail ? (
          <Text selectable style={{ color: theme.textMedium, fontSize: 13, lineHeight: 20 }}>
            {approval.detail}
          </Text>
        ) : null}

        {approval.kind === 'permission' ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(approval.permissionOptions ?? []).some(option => option.kind === 'deny') ? (
              <Pill
                theme={theme}
                label={(approval.permissionOptions ?? []).find(option => option.kind === 'deny')?.title ?? '拒绝'}
                danger
                disabled={busy}
                onPress={() => onAction({ type: 'permission', approved: false })}
              />
            ) : (
              <Pill theme={theme} label="拒绝" danger disabled={busy} onPress={() => onAction({ type: 'permission', approved: false })} />
            )}
            <Pill
              theme={theme}
              primary
              label={(approval.permissionOptions ?? []).find(option => option.kind !== 'deny')?.title ?? '允许'}
              disabled={busy}
              onPress={() => onAction({ type: 'permission', approved: true })}
            />
          </View>
        ) : null}

        {approval.kind === 'trust' ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pill theme={theme} label="不信任" disabled={busy} onPress={() => onAction({ type: 'trust', trusted: false })} />
            <Pill theme={theme} label="信任此文件夹" primary disabled={busy} onPress={() => onAction({ type: 'trust', trusted: true })} />
          </View>
        ) : null}

        {approval.kind === 'question' && approval.questionKind === 'select' ? (
          <View style={{ gap: 8 }}>
            {(approval.options ?? []).map(option => (
              <Pill
                key={option}
                theme={theme}
                label={option}
                disabled={busy}
                onPress={() => onAction({ type: 'question', value: option })}
              />
            ))}
            <Pressable onPress={() => onAction({ type: 'question', cancelled: true })} disabled={busy}>
              <Text style={{ color: theme.textWeak, fontSize: 12, textAlign: 'center', paddingVertical: 4 }}>取消</Text>
            </Pressable>
          </View>
        ) : null}

        {approval.kind === 'question' && approval.questionKind === 'confirm' ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pill theme={theme} label="拒绝" danger disabled={busy} onPress={() => onAction({ type: 'question', value: false })} />
            <Pill theme={theme} label="确认" primary disabled={busy} onPress={() => onAction({ type: 'question', value: true })} />
          </View>
        ) : null}

        {approval.kind === 'question' && (approval.questionKind === 'input' || approval.questionKind === 'editor') ? (
          <View style={{ gap: 8 }}>
            <TextInput
              value={value}
              onChangeText={setValue}
              multiline={approval.questionKind === 'editor'}
              secureTextEntry={approval.secret === true}
              autoCapitalize="none"
              placeholder={approval.placeholder}
              placeholderTextColor={theme.textWeak}
              style={{
                minHeight: 38,
                maxHeight: 120,
                color: theme.text,
                fontSize: 14,
                backgroundColor: theme.surface,
                borderRadius: 8,
                borderWidth: theme.hairline,
                borderColor: theme.cardBorder,
                paddingHorizontal: 10,
                paddingVertical: 8,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pill theme={theme} label="取消" disabled={busy} onPress={() => onAction({ type: 'question', cancelled: true })} />
              <Pill
                theme={theme}
                label="提交"
                primary
                disabled={busy || (value.trim().length === 0 && approval.questionKind === 'input')}
                onPress={() => onAction({ type: 'question', value })}
              />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  )
}
