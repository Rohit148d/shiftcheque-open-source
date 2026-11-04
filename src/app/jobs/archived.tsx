/**
 * Archived jobs — history that stays, without cluttering normal work.
 *
 * Archiving keeps every shift, rate and paycheque record, but removes the job
 * from shift creation and from the active-job slot (so a free user can add a new
 * employer). Restoring puts it back.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { archivedJobs } from '../../core/jobChanges.ts';
import { useAppStore } from '../../state/store.ts';
import { useAppUi } from '../../ui/AppUi.tsx';
import { Body, Button, Caption, Card, EmptyState, Numeral, Screen, SectionTitle, Title } from '../../ui/components.tsx';
import { spacing } from '../../ui/theme.ts';

export default function ArchivedJobsScreen() {
  const { theme, t, money, day } = useAppUi();
  const state = useAppStore();
  const archived = archivedJobs(state.jobs);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>{t('jobs.archived')}</Title>
        <Button label={t('app.close')} variant="ghost" fullWidth={false} onPress={() => router.back()} />
      </View>

      <Body muted>{t('jobs.archivedBody')}</Body>

      {archived.length === 0 ? (
        <EmptyState
          icon="archive-outline"
          title={t('jobs.archivedEmptyTitle')}
          body={t('jobs.archivedEmptyBody')}
        />
      ) : (
        archived.map((job) => {
          const rates = state.rates[job.id] ?? [];
          const shifts = state.shifts.filter((shift) => shift.jobId === job.id);
          return (
            <Card key={job.id} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexShrink: 1, gap: 2 }}>
                  <SectionTitle>{t('jobs.archivedLabel')}</SectionTitle>
                  <Title style={{ fontSize: 17 }}>{job.name}</Title>
                </View>
                <Ionicons name="archive-outline" size={20} color={theme.colors.textMuted} />
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.lg }}>
                <Numeral size="small" tone="muted">
                  {money(job.hourlyRate)}/h
                </Numeral>
                <Caption>{shifts.length} shifts</Caption>
                <Caption>{rates.length} rate changes</Caption>
              </View>
              <Caption>{t('jobs.lastShift', { date: shifts[0] ? day(shifts[0].date, 'long') : day(job.createdAt.slice(0, 10), 'long') })}</Caption>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t('jobs.restore')}
                    icon="refresh-outline"
                    onPress={() => void state.restoreArchivedJob(job.id)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={t('app.edit')}
                    variant="secondary"
                    onPress={() => router.push(`/job/${job.id}`)}
                  />
                </View>
              </View>
            </Card>
          );
        })
      )}

      <Card style={{ gap: spacing.sm }}>
        <SectionTitle>{t('jobs.keepHistory')}</SectionTitle>
        <Caption>
          Archived jobs keep their shifts, rate history, pay estimates and paycheque comparisons. They just stop appearing when you add new
          shifts, and a free account can add a new employer while they stay archived.
        </Caption>
      </Card>
    </Screen>
  );
}
