/**
 * The waiting row (20261115-mobile.md §4.3).
 *
 * Mirrors the desktop `.msg__loading`: an avatar/name header, a phase label
 * with a light sweeping across it, and a small rotating tip that arrives a few
 * seconds in. The phase advances from "准备中" to "等待模型响应" so the wait
 * says something different the second time you look at it.
 */

import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Text, View, useColorScheme } from 'react-native'

import {
  LOADING_TIPS,
  PREPARING_DURATION_MS,
  PREPARING_TEXT,
  REQUESTING_TEXT,
  TIP_INITIAL_DELAY_MS,
  TIP_ROTATION_INTERVAL_MS,
  nextTip,
} from '../core/loading'
import { themeFor } from '../theme'

/** A band of light travelling across the label. */
function useShine() {
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1600,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => loop.stop()
  }, [progress])
  return progress
}

export function LoadingRow({ compact = false }: { compact?: boolean }) {
  const theme = themeFor(useColorScheme())
  const [requesting, setRequesting] = useState(false)
  const [tip, setTip] = useState<string | null>(null)
  const previous = useRef<string | null>(null)
  const shine = useShine()

  useEffect(() => {
    const timer = setTimeout(() => setRequesting(true), PREPARING_DURATION_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const start = setTimeout(() => {
      const pick = () => {
        const value = nextTip(LOADING_TIPS, previous.current)
        previous.current = value
        setTip(value)
      }
      pick()
      const rotation = setInterval(pick, TIP_ROTATION_INTERVAL_MS)
      return () => clearInterval(rotation)
    }, TIP_INITIAL_DELAY_MS)
    return () => clearTimeout(start)
  }, [])

  const phase = requesting ? REQUESTING_TEXT : PREPARING_TEXT

  return (
    <View style={{ paddingHorizontal: theme.gutter, paddingVertical: 8 }}>
      {/* Grok-style wait: no avatar row, just the phase shimmer. The reply that
          follows carries the OpenBuddy label once there is text to label. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Animated.Text
          style={{
            color: theme.text,
            fontSize: theme.fontBody,
            fontWeight: '500',
            opacity: shine.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1, 0.55] }),
          }}
        >
          {phase}
        </Animated.Text>
        {tip ? (
          <>
            <Text style={{ color: theme.textWeak, fontSize: theme.fontMeta }}>·</Text>
            <Text numberOfLines={1} style={{ color: theme.textWeak, fontSize: theme.fontMeta, flexShrink: 1 }}>
              {tip}
            </Text>
          </>
        ) : null}
      </View>
      {compact ? null : null}
    </View>
  )
}
