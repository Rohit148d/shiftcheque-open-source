/**
 * Root layout.
 *
 * Responsibilities, in order:
 *   1. open + migrate SQLite and load state
 *   2. provide theme/i18n/safe-area
 *   3. app lock gate (free feature)
 *   4. navigation shell
 */
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AccessibilityInfo, AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppUiProvider, useAppUi } from '../ui/AppUi.tsx';
import { Button, Title } from '../ui/components.tsx';
import { authenticate, lockAvailability, shouldLock } from '../services/applock.ts';
import { initializeAds, recordFirstUse } from '../services/ads.ts';
import { installNotificationHandler } from '../services/notifications.ts';
import { useAppStore } from '../state/store.ts';
import { spacing } from '../ui/theme.ts';

export default function RootLayout() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion)
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription?.remove?.();
  }, []);

  return (
      <SafeAreaProvider>
        <AppUiProvider reducedMotion={reducedMotion}>
          <RootNavigator />
        </AppUiProvider>
      </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { theme } = useAppUi();
  const ready = useAppStore((state) => state.ready);
  const loadError = useAppStore((state) => state.loadError);
  const initialize = useAppStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
    installNotificationHandler();
    void recordFirstUse();
    void initializeAds();
  }, [initialize]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background, gap: spacing.md }}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background, padding: spacing.xl, gap: spacing.md }}>
        <Title>We could not open your data</Title>
        <Button label="Try again" onPress={() => void initialize()} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <LockGate>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="shift/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="job/[id]" />
          <Stack.Screen name="pay/breakdown" />
          <Stack.Screen name="pay/check" />
          <Stack.Screen name="pay/extra" />
          <Stack.Screen name="pay/history" />
          <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
        </Stack>
      </LockGate>
    </>
  );
}

/** App lock: a UI gate using device authentication. */
function LockGate({ children }: { children: React.ReactNode }) {
  const { theme, t } = useAppUi();
  const enabled = useAppStore((state) => state.settings.appLockEnabled);
  const timeout = useAppStore((state) => state.settings.appLockTimeout);
  const lastActiveAt = useAppStore((state) => state.settings.lastActiveAt);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const [locked, setLocked] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let mounted = true;
    void lockAvailability().then((availability) => {
      if (!mounted) return;
      setSupported(availability.supported && availability.enrolled);
      if (enabled && (availability.supported && availability.enrolled)) {
        setLocked(shouldLock({ enabled, timeout, lastActiveAt, now: Date.now() }));
      }
    });
    return () => {
      mounted = false;
    };
  }, [enabled, timeout, lastActiveAt]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        void updateSettings({ lastActiveAt: Date.now() });
      } else if (state === 'active' && enabled) {
        const should = shouldLock({ enabled, timeout, lastActiveAt: Date.now(), now: Date.now() });
        if (should) setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [enabled, timeout, lastActiveAt, updateSettings]);

  const unlock = useMemo(
    () => async () => {
      const result = await authenticate('Unlock to see your pay');
      if (result.ok) {
        setLocked(false);
        void updateSettings({ lastActiveAt: Date.now() });
      }
    },
    [updateSettings],
  );

  if (!locked) return <>{children}</>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl }}>
      <Title>Locked</Title>
      <Button label={supported ? 'Unlock' : 'Device lock is not available'} onPress={() => void unlock()} disabled={!supported} fullWidth={false} />
      <Button label={t('app.notNow')} variant="ghost" onPress={() => setLocked(false)} fullWidth={false} />
    </View>
  );
}
