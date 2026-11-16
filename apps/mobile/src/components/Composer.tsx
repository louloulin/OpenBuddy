/**
 * The input card (20261115-mobile.md §4.3, §5.6).
 *
 * Mirrors the desktop composer: a 24px-radius card with a hairline border and a
 * soft shadow, the textarea above a footer row of small round icon buttons, and
 * an ink (not blue) send button. Focusing the field lifts the border to the
 * focus colour, exactly like `.wb-composer:focus-within`.
 *
 * Voice dictation fills the draft rather than sending: a misheard word must be
 * fixable before it becomes a turn.
 */

import { useState } from 'react'
import { Alert, Pressable, Text, TextInput, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as Speech from 'expo-speech'

import { compressOptions, checkUpload } from '../core/attachments'
import { themeFor } from '../theme'
import { CameraIcon, MicIcon, SendIcon, StopIcon } from './icons'

export type ComposerProps = {
  onSend: (text: string) => void
  onImage: (bytes: ArrayBuffer, mime: string, text: string) => void
  onStop?: () => void
  streaming?: boolean
  placeholder?: string
}

export function Composer({ onSend, onImage, onStop, streaming = false, placeholder = '给 OpenBuddy 发消息…' }: ComposerProps) {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const hasText = draft.trim().length > 0

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    onSend(text)
  }

  const pickImage = async () => {
    if (busy) return
    setBusy(true)
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('需要相机权限', '在系统设置里允许 OpenBuddy 使用相机。')
        return
      }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.9, exif: false })
      const asset = shot.assets?.[0]
      if (shot.canceled || !asset) return

      const options = compressOptions(asset.width ?? 0, asset.height ?? 0)
      const manip = ImageManipulator.ImageManipulator.manipulate(asset.uri)
      if (options.resize) manip.resize({ width: options.resize.width, height: options.resize.height })
      const rendered = await manip.renderAsync()
      const saved = await rendered.saveAsync({
        compress: options.compress,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      })

      const response = await fetch(saved.uri)
      const bytes = await response.arrayBuffer()
      const check = checkUpload('image/jpeg', bytes.byteLength, 0)
      if (!check.ok) {
        Alert.alert('图片无法发送', check.reason)
        return
      }
      const text = draft.trim()
      setDraft('')
      onImage(bytes, 'image/jpeg', text)
    } catch (error) {
      Alert.alert('拍照失败', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const speak = async () => {
    if (!hasText) {
      Alert.alert('语音输入', '语音识别需要开发版构建；这里可以先朗读你写好的草稿。')
      return
    }
    Speech.speak(draft, { language: 'zh-CN' })
  }

  const roundButton = (onPress: () => void, disabled: boolean, child: React.ReactNode) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.pressed : 'transparent',
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {child}
    </Pressable>
  )

  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingTop: 8,
        // The chat screen owns the bottom inset; a composer rendered on its own
        // still keeps clear of the home indicator.
        paddingBottom: Math.max(10, insets.bottom),
        backgroundColor: theme.canvas,
      }}
    >
      <View
        style={{
          backgroundColor: theme.card,
          borderWidth: theme.hairline,
          borderColor: focused ? theme.focus : theme.cardBorder,
          borderRadius: theme.radiusCard,
          paddingHorizontal: 12,
          paddingTop: 10,
          paddingBottom: 8,
          shadowColor: '#0f0d0a',
          shadowOpacity: theme.scheme === 'dark' ? 0.45 : 0.06,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 2,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={theme.textWeak}
          multiline
          style={{
            minHeight: 40,
            maxHeight: 132,
            paddingHorizontal: 2,
            paddingTop: 2,
            paddingBottom: 6,
            color: theme.text,
            fontSize: theme.fontBody,
            lineHeight: theme.lineBody,
          }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {roundButton(() => void pickImage(), busy, <CameraIcon size={20} color={theme.textMedium} />)}
          {roundButton(() => void speak(), false, <MicIcon size={20} color={theme.textMedium} />)}
          <View style={{ flex: 1 }} />
          {streaming && onStop ? (
            <Pressable
              onPress={onStop}
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.ink,
              }}
            >
              <StopIcon size={14} color={theme.inkFg} />
            </Pressable>
          ) : (
            <Pressable
              onPress={submit}
              disabled={!hasText}
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: hasText ? theme.ink : theme.pressed,
                transform: [{ scale: pressed && hasText ? 0.92 : 1 }],
              })}
            >
              <SendIcon size={17} color={hasText ? theme.inkFg : theme.textWeak} />
            </Pressable>
          )}
        </View>
      </View>
      <Text style={{ color: theme.textWeak, fontSize: 11, textAlign: 'center', marginTop: 6 }}>
        对话在你的电脑上进行，密钥从不离开桌面
      </Text>
    </View>
  )
}
