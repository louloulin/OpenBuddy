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

import { useEffect, useState } from 'react'
import { Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, View, useColorScheme } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as Speech from 'expo-speech'

import { appendAttachments, compressOptions, checkUpload, MAX_ATTACHMENTS } from '../core/attachments'
import { mergeTranscript, transcriptOutcome, unavailableMessage } from '../core/voice'
import { haptic } from '../native/haptics'
import { matchCommands, slashQuery, toSlashCommands, type SlashCommand } from '../core/slash'
import { useApp } from '../stores/app'
import { themeFor } from '../theme'
import { CameraIcon, MicIcon, SendIcon, StopIcon } from './icons'

export type ComposerProps = {
  onSend: (text: string) => void
  onImage: (bytes: ArrayBuffer, mime: string, text: string) => void
  /** Several pictures at once, the way Qwen and Kimi accept a batch. */
  onImages?: (images: { bytes: ArrayBuffer; mime: string }[], text: string) => void
  onStop?: () => void
  /** Interrupt the running turn with this text (long-press the send button). */
  onSteer?: (text: string) => void
  streaming?: boolean
  placeholder?: string
  /** Prefilled once at mount (handoff drafts); the field is the user's after. */
  initialDraft?: string
}

export function Composer({ onSend, onImage, onImages, onStop, onSteer, streaming = false, placeholder = '给 OpenBuddy 发消息…', initialDraft = '' }: ComposerProps) {
  const theme = themeFor(useColorScheme())
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState(initialDraft)
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const hasText = draft.trim().length > 0

  // Slash menu: fetched once per composer from the desktop, filtered locally.
  const transport = useApp(state => state.transport)
  const capabilities = useApp(state => state.capabilities)
  const canListCommands = Boolean(capabilities?.commands.includes('commands_list'))
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [commandsLoaded, setCommandsLoaded] = useState(false)
  const query = canListCommands ? slashQuery(draft) : null
  const commandMenu = query === null ? [] : matchCommands(commands, query)

  useEffect(() => {
    if (query === null || commandsLoaded || !transport) return
    // One attempt: an older desktop without the command should not retry on
    // every keystroke.
    setCommandsLoaded(true)
    transport.invoke<unknown>('commands_list', {})
      .then(raw => setCommands(toSlashCommands(raw)))
      .catch(() => {})
  }, [query, commandsLoaded, transport])

  /**
   * One send action for text and pictures: attachments sit in a draft tray
   * until the user is ready, the way Grok/Kimi stage them. Text alone still
   * goes through `onSend`.
   */
  const submit = () => {
    const text = draft.trim()
    if (!text && pending.length === 0) return
    void haptic('send')
    if (pending.length) {
      const images = pending.map(({ bytes, mime }) => ({ bytes, mime }))
      setPending([])
      setDraft('')
      if (onImages) onImages(images, text)
      else if (images[0]) onImage(images[0].bytes, images[0].mime, text)
      return
    }
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
  const [steerSheet, setSteerSheet] = useState(false)
  const [pending, setPending] = useState<{ bytes: ArrayBuffer; mime: string; uri: string }[]>([])

  const prepare = async (uris: string[], widths: number[], heights: number[]) => {
    const images: { bytes: ArrayBuffer; mime: string; uri: string }[] = []
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
      images.push({ bytes, mime: 'image/jpeg', uri: saved.uri })
    }
    return images
  }

  /** Adds pictures to the draft tray instead of sending them immediately. */
  const stage = (images: { bytes: ArrayBuffer; mime: string; uri: string }[]) => {
    setPending(current => {
      const { list, dropped } = appendAttachments(current, images)
      if (dropped > 0) Alert.alert('附件已达上限', `一条消息最多 ${MAX_ATTACHMENTS} 张图片。`)
      return list
    })
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
      stage(images)
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
      stage(images)
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

  const roundButton = (onPress: () => void, disabled: boolean, child: React.ReactNode, label?: string) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
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
        // Same surface as the transcript: Grok's composer is not a separate
        // tinted band, the card itself is the affordance.
        backgroundColor: theme.surface,
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
        {pending.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 8 }}
            contentContainerStyle={{ gap: 8, alignItems: 'center' }}
          >
            {pending.map((image, index) => (
              <View key={`${image.uri}-${index}`} style={{ width: 56, height: 56 }}>
                <Image
                  source={{ uri: image.uri }}
                  style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: theme.pressed }}
                />
                <Pressable
                  onPress={() => setPending(current => current.filter((_, i) => i !== index))}
                  hitSlop={8}
                  accessibilityLabel="移除附件"
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: theme.ink,
                  }}
                >
                  <Text style={{ color: theme.inkFg, fontSize: 11, lineHeight: 13 }}>×</Text>
                </Pressable>
              </View>
            ))}
            <Text style={{ color: theme.textWeak, fontSize: 11 }}>{pending.length}/{MAX_ATTACHMENTS}</Text>
          </ScrollView>
        ) : null}

        {commandMenu.length ? (
          <View style={{ borderTopWidth: theme.hairline, borderTopColor: theme.cardBorder, paddingTop: 4, marginBottom: 2 }}>
            {commandMenu.map(command => (
              <Pressable
                key={command.name}
                onPress={() => setDraft(`/${command.name} `)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingVertical: 8,
                  paddingHorizontal: 2,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>
                  /{command.name}
                </Text>
                {command.description ? (
                  <Text numberOfLines={1} style={{ flex: 1, color: theme.textWeak, fontSize: 12 }}>
                    {command.description}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

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
          {roundButton(() => setSheet(true), busy, <CameraIcon size={20} color={theme.textMedium} />, '添加图片')}
          {roundButton(() => void speak(), listening, <MicIcon size={20} color={listening ? theme.danger : theme.textMedium} />, '语音输入')}
          <View style={{ flex: 1 }} />
          {streaming && onStop ? (
            <Pressable
              onPress={onStop}
              accessibilityLabel="停止"
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.pressed,
              }}
            >
              <StopIcon size={12} color={theme.text} />
            </Pressable>
          ) : null}
          {hasText || pending.length ? (
            <Pressable
              onPress={submit}
              onLongPress={streaming && onSteer && hasText ? () => setSteerSheet(true) : undefined}
              delayLongPress={350}
              accessibilityLabel={streaming ? '发送（排队）' : '发送'}
              style={({ pressed }) => ({
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.ink,
                transform: [{ scale: pressed ? 0.92 : 1 }],
              })}
            >
              <SendIcon size={17} color={theme.inkFg} />
            </Pressable>
          ) : streaming ? null : (
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.pressed,
              }}
            >
              <SendIcon size={17} color={theme.textWeak} />
            </View>
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

      {/* Running turn: normal send queues; this sheet offers the interrupt. */}
      {steerSheet ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSteerSheet(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setSteerSheet(false)} />
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
              onPress={() => {
                const text = draft.trim()
                setSteerSheet(false)
                if (!text || !onSteer) return
                setDraft('')
                onSteer(text)
              }}
              style={({ pressed }) => ({ paddingVertical: 15, paddingHorizontal: 20, backgroundColor: pressed ? theme.hover : 'transparent' })}
            >
              <Text style={{ color: theme.text, fontSize: 15 }}>立即插话</Text>
              <Text style={{ color: theme.textWeak, fontSize: 12, marginTop: 2 }}>打断当前生成，按新指令继续</Text>
            </Pressable>
            <Pressable
              onPress={() => { setSteerSheet(false); submit() }}
              style={({ pressed }) => ({ paddingVertical: 15, paddingHorizontal: 20, backgroundColor: pressed ? theme.hover : 'transparent' })}
            >
              <Text style={{ color: theme.text, fontSize: 15 }}>排队等待</Text>
              <Text style={{ color: theme.textWeak, fontSize: 12, marginTop: 2 }}>当前回合结束后再发送</Text>
            </Pressable>
            <Pressable
              onPress={() => setSteerSheet(false)}
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
