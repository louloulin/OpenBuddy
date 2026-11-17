/**
 * An approval inside the conversation (20261115-mobile.md §4.2 P0).
 *
 * The desktop puts a permission prompt in the turn it belongs to; pinning it
 * above the transcript on a phone pushes the conversation off-screen and reads
 * as a modal even though it is not one. So this is a normal row: it scrolls with
 * the messages, and the newest request sits at the bottom where the user is
 * already looking.
 */

import { Pressable, Text, View, useColorScheme } from 'react-native'

import type { Approval } from '../core/models'
import { themeFor } from '../theme'
import { CheckIcon, CloseIcon, SparkIcon } from './icons'

export function ApprovalCard({ approval, onResolve }: { approval: Approval; onResolve: (approved: boolean) => void }) {
  const theme = themeFor(useColorScheme())

  return (
    <View style={{ paddingHorizontal: theme.gutter, paddingVertical: 8 }}>
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
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={() => onResolve(false)}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              height: 38,
              borderRadius: theme.radiusPill,
              backgroundColor: pressed ? theme.pressed : theme.card,
              borderWidth: theme.hairline,
              borderColor: theme.cardBorder,
            })}
          >
            <CloseIcon size={14} color={theme.danger} />
            <Text style={{ color: theme.danger, fontSize: 13, fontWeight: '600' }}>拒绝</Text>
          </Pressable>
          <Pressable
            onPress={() => onResolve(true)}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              height: 38,
              borderRadius: theme.radiusPill,
              backgroundColor: theme.ink,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <CheckIcon size={14} color={theme.inkFg} />
            <Text style={{ color: theme.inkFg, fontSize: 13, fontWeight: '600' }}>允许</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}
