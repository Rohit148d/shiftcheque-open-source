/** Notification permissions and channel explanation (spec 58). */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { permissionStatus, requestPermission } from '../../services/notifications.ts';
import { useAppStore } from '../../state/store.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Banner, Body, Button, Caption, Card, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function NotificationSettings() {
  const { t } = useAppUi();
  const state = useAppStore();
  const [status, setStatus] = useState<'granted' | 'denied' | 'undetermined' | 'unsupported'>('undetermined');

  useEffect(() => {
    void permissionStatus().then(setStatus);
  }, []);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('settings.notifications')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>Permission</SectionTitle>
        <Body>
          {status === 'granted'
            ? 'Notifications are allowed on this device.'
            : status === 'denied'
              ? 'Notifications are turned off for the app in your device settings.'
              : status === 'unsupported'
                ? 'This device or build cannot show notifications.'
                : 'We have not asked yet.'}
        </Body>
        {status !== 'granted' && status !== 'unsupported' ? (
          <Button label="Allow notifications" onPress={() => void requestPermission().then((granted) => setStatus(granted ? 'granted' : 'denied'))} />
        ) : null}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>What we send</SectionTitle>
        <Caption>Shift reminders, payday reminders, overtime warnings and an optional weekly summary. No marketing, ever.</Caption>
        <Caption>Categories are switched on and off in Settings.</Caption>
      </Card>

      <Banner tone="info" body="Reminders are scheduled on your phone. Nothing about your pay is sent anywhere." />
      <Caption>Last updated {state.settings.lastActiveAt ? new Date(state.settings.lastActiveAt).toLocaleString() : '—'}</Caption>
    </Screen>
  );
}
