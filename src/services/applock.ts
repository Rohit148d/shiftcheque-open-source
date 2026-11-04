/**
 * App lock (spec 76 — free feature).
 *
 * Uses the device's own authentication (biometric or device credential) through
 * expo-local-authentication. When unavailable, the app says so instead of
 * faking security. The lock is a UI gate only: data is not re-encrypted here.
 */
import { Platform } from 'react-native';

export type LockTimeout = 'off' | 'immediately' | '1_minute' | '5_minutes';

export const LOCK_TIMEOUTS: { id: LockTimeout; label: string; graceMs: number }[] = [
  { id: 'off', label: 'Off', graceMs: Number.POSITIVE_INFINITY },
  { id: 'immediately', label: 'Immediately', graceMs: 0 },
  { id: '1_minute', label: 'After 1 minute', graceMs: 60_000 },
  { id: '5_minutes', label: 'After 5 minutes', graceMs: 300_000 },
];

type LocalAuthModule = typeof import('expo-local-authentication');

let module: LocalAuthModule | null = null;

function load(): LocalAuthModule | null {
  if (module) return module;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    module = require('expo-local-authentication') as LocalAuthModule;
    return module;
  } catch {
    return null;
  }
}

export async function lockAvailability(): Promise<{ supported: boolean; biometrics: boolean; enrolled: boolean }> {
  const auth = load();
  if (!auth) return { supported: false, biometrics: false, enrolled: false };
  try {
    const supported = await auth.hasHardwareAsync();
    const enrolled = await auth.isEnrolledAsync();
    const types = await auth.supportedAuthenticationTypesAsync();
    const biometrics = types.length > 0;
    return { supported, biometrics, enrolled };
  } catch {
    return { supported: false, biometrics: false, enrolled: false };
  }
}

export async function authenticate(reason: string): Promise<{ ok: boolean; reason?: string }> {
  const auth = load();
  if (!auth) return { ok: false, reason: 'unsupported' };
  try {
    const result = await auth.authenticateAsync({
      promptMessage: reason,
      cancelLabel: Platform.OS === 'ios' ? 'Cancel' : undefined,
      disableDeviceFallback: false,
    });
    return result.success ? { ok: true } : { ok: false, reason: 'cancelled' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function graceMsFor(timeout: LockTimeout): number {
  return LOCK_TIMEOUTS.find((entry) => entry.id === timeout)?.graceMs ?? Number.POSITIVE_INFINITY;
}

export function shouldLock(input: { timeout: LockTimeout; lastActiveAt: number; now: number; enabled: boolean }): boolean {
  if (!input.enabled) return false;
  if (input.timeout === 'off') return false;
  if (input.timeout === 'immediately') return true;
  return input.now - input.lastActiveAt >= graceMsFor(input.timeout);
}
