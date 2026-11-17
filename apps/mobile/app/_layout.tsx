/**
 * Root layout: theme, safe area, and the one-time boot that reads the pairing.
 *
 * Chrome is deliberately quiet: a surface-coloured header with no shadow, and
 * no header at all on the tab shell or the chat screen (the chat has its own
 * title row). This mirrors the desktop's in-flow top bar rather than the
 * default iOS large-title stack.
 */

import { useEffect } from 'react'
import { ActivityIndicator, AppState, View, useColorScheme } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'

import { useApp } from '../src/stores/app'
import { registerForPush, routeForNotification } from '../src/native/notifications'
import { themeFor } from '../src/theme'

export default function RootLayout() {
  const scheme = useColorScheme()
  const theme = themeFor(scheme)
  const booted = useApp(state => state.booted)
  const pairing = useApp(state => state.pairing)
  const bootstrap = useApp(state => state.bootstrap)
  const resume = useApp(state => state.resume)
  const router = useRouter()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    if (booted && !pairing) router.replace('/pair')
  }, [booted, pairing, router])

  // Backgrounding the app turns the radio off, so the tunnel is gone when the
  // user comes back. Reconnecting on the spot is the difference between
  // "one tap and it works" and "wait a minute for the backoff".
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') resume()
    })
    return () => subscription.remove()
  }, [resume])

  // Ask for push permission only after pairing: a prompt on first launch, with
  // nothing to be notified about yet, is noise.
  useEffect(() => {
    if (!booted || !pairing) return
    void registerForPush()
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const route = routeForNotification(response.notification.request.content.data as Record<string, unknown>)
      if (route) router.push(route as never)
    })
    return () => subscription.remove()
  }, [booted, pairing, router])

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.surface }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          {!booted ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface }}>
              <ActivityIndicator color={theme.textMedium} />
            </View>
          ) : (
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: theme.surface },
                headerShadowVisible: false,
                headerTintColor: theme.text,
                headerTitleStyle: { fontSize: 16, fontWeight: '600' },
                headerBackTitle: '返回',
                contentStyle: { backgroundColor: theme.surface },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="chat/[sessionId]" options={{ headerShown: false }} />
              <Stack.Screen name="session/[sessionId]" options={{ headerShown: false }} />
              <Stack.Screen name="files" options={{ headerShown: false }} />
              <Stack.Screen name="memory" options={{ title: '记忆' }} />
              <Stack.Screen name="memory/[path]" options={{ title: '记忆' }} />
              <Stack.Screen name="pair" options={{ title: '配对电脑', headerShown: false }} />
              <Stack.Screen name="approval/[requestId]" options={{ title: '等待批准' }} />
            </Stack>
          )}
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
