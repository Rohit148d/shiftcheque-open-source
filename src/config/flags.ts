/**
 * Environment + feature configuration.
 *
 * Everything that depends on an external account (AdMob, RevenueCat, remote
 * rule hosting, analytics) is DISABLED by default and switches on only when
 * the corresponding key is supplied through EXPO_PUBLIC_* environment
 * variables. The application is fully functional offline and unmonetized with
 * no keys at all: this is how it runs in development, in CI and in Expo Go.
 */

export type AppEnvironment = 'development' | 'preview' | 'production';

function readEnv(name: string): string | undefined {
  // Expo inlines EXPO_PUBLIC_* variables at bundle time.
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.startsWith('REPLACE_ME') ? trimmed : undefined;
}

const envName = readEnv('EXPO_PUBLIC_APP_ENV');

export const ENVIRONMENT: AppEnvironment =
  envName === 'production' ? 'production' : envName === 'preview' ? 'preview' : 'development';

export const IS_DEVELOPMENT = ENVIRONMENT === 'development';

/** Google's official test ad unit ids. NEVER ship live ids in development. */
export const TEST_AD_UNIT_IDS = {
  android: {
    banner: 'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
  },
} as const;

/** AdMob application id (test id by default). */
export const ADMOB_APP_ID =
  readEnv('EXPO_PUBLIC_ADMOB_ANDROID_APP_ID') ?? 'ca-app-pub-3940256099942544~3347511713';

export const AD_UNIT_IDS = {
  banner: readEnv('EXPO_PUBLIC_ADMOB_BANNER_ID') ?? TEST_AD_UNIT_IDS.android.banner,
  interstitial:
    readEnv('EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID') ?? TEST_AD_UNIT_IDS.android.interstitial,
  rewarded: readEnv('EXPO_PUBLIC_ADMOB_REWARDED_ID') ?? TEST_AD_UNIT_IDS.android.rewarded,
};

/** True when real AdMob credentials are configured (test ids = false). */
export const HAS_LIVE_AD_IDS =
  AD_UNIT_IDS.banner !== TEST_AD_UNIT_IDS.android.banner ||
  AD_UNIT_IDS.interstitial !== TEST_AD_UNIT_IDS.android.interstitial;

export const REVENUECAT_ANDROID_API_KEY = readEnv('EXPO_PUBLIC_REVENUECAT_ANDROID_KEY');
export const REVENUECAT_IOS_API_KEY = readEnv('EXPO_PUBLIC_REVENUECAT_IOS_KEY');

/**
 * Ads are only ever *considered* when the native SDK is present and an app id
 * exists. Even then, every user-facing gate in adsPolicy.ts must pass.
 */
export const ADS_SDK_CONFIGURED = true; // SDK is bundled; runtime gates decide visibility.
export const BILLING_SDK_CONFIGURED =
  REVENUECAT_ANDROID_API_KEY !== undefined || REVENUECAT_IOS_API_KEY !== undefined;

/** Optional remote JSON endpoints. Empty by default -> fully offline. */
export const REMOTE_RULE_PACK_URL = readEnv('EXPO_PUBLIC_RULE_PACK_URL');
export const REMOTE_MONETIZATION_CONFIG_URL = readEnv('EXPO_PUBLIC_MONETIZATION_CONFIG_URL');

/** Privacy-conscious analytics: disabled unless a DSN/endpoint is configured. */
export const ANALYTICS_ENDPOINT = readEnv('EXPO_PUBLIC_ANALYTICS_ENDPOINT');
export const CRASH_REPORTING_ENDPOINT = readEnv('EXPO_PUBLIC_CRASH_ENDPOINT');

/** https://play.google.com/store/apps/details?id=<package> listing. */
export function playStoreListingUrl(packageName: string): string {
  return `https://play.google.com/store/apps/details?id=${packageName}`;
}
