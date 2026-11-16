/**
 * Pairing (20261115-mobile.md §4.4, §4.3).
 *
 * Two routes to the same claim: scan the desktop's QR, or type the address and
 * the eight-digit code. The form uses the same card/border/ink-button language
 * as the rest of the app, and explains the privacy model up front — the phone
 * is a remote control, the model keys stay on the computer.
 */

import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View, useColorScheme } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'

import { isPairCode, normalizeGatewayUrl, parsePairQr, type PairPayload } from '../src/core/pairing'
import { GlobeIcon, SparkIcon } from '../src/components/icons'
import { useApp } from '../src/stores/app'
import { themeFor } from '../src/theme'

export default function PairScreen() {
  const theme = themeFor(useColorScheme())
  const router = useRouter()
  const pair = useApp(state => state.pair)

  const [permission, requestPermission] = useCameraPermissions()
  const [scanning, setScanning] = useState(false)
  const [gateway, setGateway] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = useCallback(async (payload: PairPayload) => {
    setBusy(true)
    setError(null)
    try {
      await pair(payload, '我的手机')
      router.replace('/')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      setScanning(false)
    }
  }, [pair, router])

  const submitManual = async () => {
    const normalized = normalizeGatewayUrl(gateway)
    if (!normalized) {
      setError('网关地址看起来不对，例如 gw.example.com 或 https://gw.example.com。')
      return
    }
    if (!isPairCode(code)) {
      setError('配对码是 8 位数字。')
      return
    }
    await finish({ gatewayUrl: normalized, code: code.trim() })
  }

  const inputStyle = {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: theme.hairline,
    borderColor: theme.cardBorder,
    backgroundColor: theme.card,
    color: theme.text,
    fontSize: 14,
  } as const

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.surface }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.scheme === 'dark' ? theme.card : '#333333',
          }}
        >
          <SparkIcon size={18} color={theme.scheme === 'dark' ? theme.text : '#ffffff'} />
        </View>
        <Text style={{ color: theme.text, fontSize: 21, fontWeight: '700' }}>连接你的电脑</Text>
      </View>
      <Text style={{ color: theme.textWeak, fontSize: 13, lineHeight: 20, marginBottom: 20 }}>
        在桌面端 OpenBuddy 打开「手机接入」，扫码或输入 8 位配对码。{'\n'}
        对话在你的电脑上执行，模型密钥从不离开桌面。
      </Text>

      {scanning ? (
        <View
          style={{
            height: 300,
            borderRadius: 20,
            overflow: 'hidden',
            backgroundColor: theme.card,
            borderWidth: theme.hairline,
            borderColor: theme.cardBorder,
            marginBottom: 16,
          }}
        >
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              const payload = parsePairQr(data)
              if (payload) void finish(payload)
              else Alert.alert('无法识别', '这个二维码不是 OpenBuddy 的配对码。')
            }}
          />
        </View>
      ) : (
        <Pressable
          onPress={async () => {
            if (!permission?.granted) {
              const next = await requestPermission()
              if (!next.granted) {
                Alert.alert('需要相机权限', '也可以手动输入网关地址和配对码。')
                return
              }
            }
            setScanning(true)
          }}
          style={({ pressed }) => ({
            height: 48,
            borderRadius: theme.radiusPill,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            backgroundColor: theme.ink,
            opacity: pressed ? 0.88 : 1,
            marginBottom: 16,
          })}
        >
          <Text style={{ color: theme.inkFg, fontSize: 15, fontWeight: '600' }}>扫描二维码</Text>
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 14 }}>
        <View style={{ flex: 1, height: theme.hairline, backgroundColor: theme.cardBorder }} />
        <Text style={{ color: theme.textWeak, fontSize: 12 }}>或手动输入</Text>
        <View style={{ flex: 1, height: theme.hairline, backgroundColor: theme.cardBorder }} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <GlobeIcon size={16} color={theme.textWeak} />
        <Text style={{ color: theme.textMedium, fontSize: 12 }}>网关地址</Text>
      </View>
      <TextInput
        value={gateway}
        onChangeText={setGateway}
        placeholder="gw.example.com"
        placeholderTextColor={theme.textWeak}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={{ ...inputStyle, marginBottom: 14 }}
      />

      <Text style={{ color: theme.textMedium, fontSize: 12, marginBottom: 8 }}>8 位配对码</Text>
      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="••••••••"
        placeholderTextColor={theme.textWeak}
        keyboardType="number-pad"
        maxLength={8}
        style={{ ...inputStyle, letterSpacing: 6, fontFamily: theme.mono, marginBottom: 16 }}
      />

      {error ? (
        <View style={{ backgroundColor: theme.card, borderRadius: 12, borderWidth: theme.hairline, borderColor: theme.cardBorder, padding: 12, marginBottom: 14 }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => void submitManual()}
        disabled={busy}
        style={({ pressed }) => ({
          height: 48,
          borderRadius: theme.radiusPill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: busy ? theme.pressed : theme.ink,
          opacity: pressed ? 0.88 : 1,
        })}
      >
        {busy ? <ActivityIndicator color={theme.inkFg} /> : <Text style={{ color: theme.inkFg, fontSize: 15, fontWeight: '600' }}>连接</Text>}
      </Pressable>
    </ScrollView>
  )
}
