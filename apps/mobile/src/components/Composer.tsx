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
import { Alert, Modal, Pressable, Text, TextInput, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as Speech from 'expo-speech'

import { compressOptions, checkUpload, MAX_ATTACHMENTS } from '../core/attachments'
import { mergeTranscript, transcriptOutcome, unavailableMessage } from '../core/voice'
import { themeFor } from '../theme'
import { CameraIcon, MicIcon, SendIcon, StopIcon } from './icons'

export type ComposerProps = {
  onSend: (text: string) => void
  onImage: (bytes: ArrayBuffer, mime: string, text: string) => void
  /** Several pictures at once, the way Qwen and Kimi accept a batch. */
  onImages?: (images: { bytes: ArrayBuffer; mime: string }[], text: string) => void
  onStop?: () => void
  streaming?: boolean
  placeholder?: string
}

export function Composer({ onSend, onImage, onImages, onStop, streaming = false, placeholder = '给 OpenBuddy 发消息…' }: ComposerProps) {
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

  /**
   * Pictures, one or several.
   *
   * Qwen accepts ten documents in one go and Kimi's camera answers a photo
   * instantly; the contract allows eight attachments per turn. So the phone
   * offers "拍一张" and "从相册选" (which allows a multi-select), compresses
   * every picture, and hands them to the composer as a batch.
   */
  const [sheet, setSheet] = useState(false)
  const [pending, setPending] = useState<{ bytes: ArrayBuffer; mime: string }[]>([])

  const prepare = async (uris: string[], widths: number[], heights: number[]) => {
    const images: { bytes: ArrayBuffer; mime: string }[] = []
    for (let index = 0; index < uris.length; index += 1) {
      const uri = uris[index]!
      const options = compressOptions(widths[index] ?? 0, heights[index] ?? 0)
      const manip = ImageManipulator.ImageManipulator.manipulate(uri)
      if (options.resize) manip.resize({ width: options.resize.width, height: options.resize.height })
      const rendered = await manip.renderAsync()
      const saved = await rendered.saveAsync({
        compress: options.compress,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      })
      const response = await fetch(saved.uri)
      const bytes = await response.arrayBuffer()
      const check = checkUpload('image/jpeg', bytes.byteLength, images.length)
      if (!check.ok) {
        Alert.alert('图片无法发送', check.reason)
        continue
      }
      images.push({ bytes, mime: 'image/jpeg' })
    }
    return images
  }

  const shoot = async () => {
    if (busy) return
    setBusy(true)
    setSheet(false)
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('需要相机权限', '在系统设置里允许 OpenBuddy 使用相机。')
        return
      }
      const shot = await ImagePicker.launchCameraAsync({ quality: 0.9, exif: false })
      const asset = shot.assets?.[0]
      if (shot.canceled || !asset) return
      const images = await prepare([asset.uri], [asset.width ?? 0], [asset.height ?? 0])
      if (images.length === 0) return
      const text = draft.trim()
      setDraft('')
      if (onImages) onImages(images, text)
      else onImage(images[0]!.bytes, images[0]!.mime, text)
    } catch (error) {
      Alert.alert('拍照失败', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const pickFromLibrary = async () => {
    if (busy) return
    setBusy(true)
    setSheet(false)
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!permission.granted) {
        Alert.alert('需要相册权限', '在系统设置里允许 OpenBuddy 访问相册。')
        return
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        quality: 0.9,
        exif: false,
        allowsMultipleSelection: true,
        selectionLimit: MAX_ATTACHMENTS,
      })
      const assets = picked.assets ?? []
      if (picked.canceled || assets.length === 0) return
      const images = await prepare(
        assets.map(asset => asset.uri),
        assets.map(asset => asset.width ?? 0),
        assets.map(asset => asset.height ?? 0),
      )
      if (images.length === 0) return
      const text = draft.trim()
      setDraft('')
      if (onImages) onImages(images, text)
      else onImage(images[0]!.bytes, images[0]!.mime, text)
    } catch (error) {
      Alert.alert('选择图片失败', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Dictation.
   *
   * `expo-speech-recognition` needs a development build, so the module is
   * imported lazily and a missing module is a message, not a crash. The
   * transcript lands in the draft (never sent directly): a misheard word must
   * be fixable before it becomes a turn.
   */
  const [listening, setListening] = useState(false)

  const dictate = async () => {
    if (listening || busy) return
    setBusy(true)
    try {
      const { ExpoSpeechRecognitionModule: recognition } = await import('expo-speech-recognition')
      if (!recognition.isRecognitionAvailable?.()) {
        Alert.alert('语音输入', unavailableMessage('no_module'))
        return
      }
      const permission = await recognition.requestPermissionsAsync()
      if (permission.granted !== true) {
        Alert.alert('语音输入', unavailableMessage('no_permission'))
        return
      }

      // The transcript arrives as events; only the final one is the sentence.
      const subscription = recognition.addListener('result', (event: { isFinal: boolean; results?: { transcript?: string }[] }) => {
        if (!event.isFinal) return
        const outcome = transcriptOutcome(event.results?.[0]?.transcript)
        if (outcome.kind === 'text') setDraft(current => mergeTranscript(current, outcome.text))
        setListening(false)
      })
      const failure = recognition.addListener('error', () => {
        setListening(false)
        Alert.alert('语音输入', unavailableMessage('error'))
      })

      setListening(true)
      recognition.start({ lang: 'zh-CN', interimResults: true, continuous: false })
      // The listeners are removed once the recogniser has produced a result;
      // the error listener also settles the "listening" state.
      setTimeout(() => {
        subscription.remove()
        failure.remove()
        setListening(false)
      }, 30_000)
    } catch {
      // The module is absent in Expo Go: dictation needs a dev build.
      Alert.alert('语音输入', unavailableMessage('no_module'))
      setListening(false)
    } finally {
      setBusy(false)
    }
  }

  const speak = async () => {
    if (!hasText) {
      await dictate()
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
          {roundButton(() => setSheet(true), busy, <CameraIcon size={20} color={theme.textMedium} />)}
          {roundButton(() => void speak(), listening, <MicIcon size={20} color={listening ? theme.danger : theme.textMedium} />)}
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

      {sheet ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSheet(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setSheet(false)} />
          <View
            style={{
              backgroundColor: theme.card,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              paddingVertical: 8,
              paddingBottom: 30,
            }}
          >
            <Pressable
              onPress={() => void shoot()}
              style={({ pressed }) => ({ paddingVertical: 15, paddingHorizontal: 20, backgroundColor: pressed ? theme.hover : 'transparent' })}
            >
              <Text style={{ color: theme.text, fontSize: 15 }}>拍一张</Text>
            </Pressable>
            <Pressable
              onPress={() => void pickFromLibrary()}
              style={({ pressed }) => ({ paddingVertical: 15, paddingHorizontal: 20, backgroundColor: pressed ? theme.hover : 'transparent' })}
            >
              <Text style={{ color: theme.text, fontSize: 15 }}>从相册选择（最多 {MAX_ATTACHMENTS} 张）</Text>
            </Pressable>
            <Pressable
              onPress={() => setSheet(false)}
              style={({ pressed }) => ({
                paddingVertical: 15,
                paddingHorizontal: 20,
                backgroundColor: pressed ? theme.hover : 'transparent',
                borderTopWidth: theme.hairline,
                borderTopColor: theme.cardBorder,
                marginTop: 6,
              })}
            >
              <Text style={{ color: theme.textWeak, fontSize: 15 }}>取消</Text>
            </Pressable>
          </View>
        </Modal>
      ) : null}
    </View>
  )
}
