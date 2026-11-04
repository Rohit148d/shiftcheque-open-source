/**
 * Banner slot. Renders nothing unless every advertising gate passes, so it is
 * always safe to include on a screen (spec 66/67).
 */
import React, { useEffect, useState } from 'react';

import { useAppStore } from '../state/store.ts';
import { BannerAdComponent, adUnitIdFor, eligibilityFor, type AdContext } from '../services/ads.ts';
import { track } from '../services/analytics.ts';

export function BannerAdSlot({ route }: { route: string }) {
  const onboarded = useAppStore((state) => state.settings.onboarded);
  const isPro = useAppStore((state) => state.entitlement.isPro);
  const shifts = useAppStore((state) => state.shifts.length);
  const payViewed = useAppStore((state) => state.jobs.length > 0);
  const monetization = useAppStore((state) => state.monetization);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;
    const context: AdContext = {
      onboarded,
      shiftsRecorded: shifts,
      payEstimateViewed: payViewed,
      isPro,
      meaningfulSessions: 0,
      route,
    };
    void eligibilityFor(context, monetization).then((eligibility) => {
      if (mounted) setAllowed(eligibility.banner);
    });
    return () => {
      mounted = false;
    };
  }, [onboarded, shifts, payViewed, isPro, monetization, route]);

  useEffect(() => {
    if (allowed) track('banner_impression_state');
  }, [allowed]);

  const Banner = BannerAdComponent();
  if (!allowed || !Banner) return null;
  return (
    <Banner
      unitId={adUnitIdFor('banner')}
      size={'ANCHORED_ADAPTIVE_BANNER' satisfies string}
      requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      onAdFailedToLoad={() => setAllowed(false)}
    />
  );
}
