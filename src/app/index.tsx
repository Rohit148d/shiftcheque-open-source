/**
 * Entry gate.
 *
 * Three states, decided by a tested pure function (`resolveStartRoute`):
 *   - onboarding complete  -> the real app
 *   - explore mode         -> the real app with empty states (no fake data,
 *                             no payroll calculation, no ads) and a clear
 *                             "Set up my pay" path back into onboarding
 *   - neither              -> onboarding
 */
import { Redirect } from 'expo-router';
import React from 'react';

import { resolveStartRoute } from '../core/onboarding.ts';
import { useAppStore } from '../state/store.ts';

export default function Index() {
  const ready = useAppStore((state) => state.ready);
  const onboarded = useAppStore((state) => state.settings.onboarded);
  const exploreMode = useAppStore((state) => state.settings.exploreMode);

  if (!ready) return null;

  const route = resolveStartRoute({ onboarded, exploreMode });
  if (route === '/(tabs)') return <Redirect href="/(tabs)" />;
  return <Redirect href="/onboarding" />;
}
