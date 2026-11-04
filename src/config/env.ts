import Constants from 'expo-constants';

import { BRAND } from './brand.ts';
import { ENVIRONMENT } from './flags.ts';

/**
 * Small, safe runtime/environment descriptor. Never contains secrets: only
 * values that are safe to live in a client bundle (Expo public env vars and
 * app config metadata).
 */

type Extra = {
  packageName?: string;
  [key: string]: unknown;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const RUNTIME = {
  environment: ENVIRONMENT,
  appName: BRAND.APP_NAME,
  appVersion: Constants.expoConfig?.version ?? '1.0.0',
  nativeBuildVersion: Constants.nativeBuildVersion ?? undefined,
  /** Android package / iOS bundle id actually installed. */
  packageName: extra.packageName ?? Constants.expoConfig?.android?.package ?? 'unknown',
  executionEnvironment: Constants.executionEnvironment ?? 'unknown',
  /** True inside Expo Go, which cannot host native ad / billing SDKs. */
  isExpoGo: String(Constants.executionEnvironment) === 'storeClient',
  deviceName: undefined as string | undefined,
} as const;
