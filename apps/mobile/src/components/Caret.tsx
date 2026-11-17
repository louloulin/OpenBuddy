/**
 * The streaming caret (20261115-mobile.md §4.3).
 *
 * The desktop blinks its caret (`.msg__caret`, 1s steps) in the brand colour.
 * A static block reads as a typo on a phone; a blinking one reads as "still
 * typing", so the phone gets the same blink.
 */

import { useEffect, useRef } from 'react'
import { Animated, Easing, Text } from 'react-native'

export function Caret({ color, fontSize, lineHeight }: { color: string; fontSize: number; lineHeight: number }) {
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 500, easing: Easing.step0, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, easing: Easing.step0, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])

  return (
    <Animated.Text style={{ opacity, color, fontSize, lineHeight }}>▍</Animated.Text>
  )
}
