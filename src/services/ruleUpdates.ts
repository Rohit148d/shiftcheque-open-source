/**
 * Remote rule + monetization configuration (spec 46/73).
 *
 * Rules of engagement:
 *   1. everything is validated with Zod before it can affect a calculation
 *   2. remote data is JSON only; no code is ever executed
 *   3. a failed download keeps the last verified cached bundle
 *   4. a failed cache keeps the bundled rules that ship with the app
 *   5. the core app works with no network at all
 */
import { REMOTE_MONETIZATION_CONFIG_URL, REMOTE_RULE_PACK_URL } from '../config/flags.ts';
import { DEFAULT_MONETIZATION_CONFIG, type MonetizationConfig } from '../config/monetization.ts';
import { RulePackRepository } from '../db/repositories.ts';
import { RuleBundleSchema, RemoteMonetizationSchema, type RuleBundle } from '../rules/types.ts';
import { BUNDLED_RULE_BUNDLE, validateRuleBundle } from '../rules/bundle.ts';

export type RuleUpdateOutcome =
  | { status: 'updated'; bundle: RuleBundle; source: 'remote' }
  | { status: 'cached'; bundle: RuleBundle; source: 'cache' }
  | { status: 'bundled'; bundle: RuleBundle; source: 'bundled'; reason: string };

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves the rule bundle to use, in priority order:
 * remote (valid) -> cached (valid) -> bundled.
 */
export async function loadRuleBundle(): Promise<RuleUpdateOutcome> {
  // 1. Cached bundle from a previous successful update.
  let cached: RuleBundle | null = null;
  try {
    const stored = await RulePackRepository.active();
    if (stored) {
      const parsed = validateRuleBundle(JSON.parse(stored.payloadJson));
      if (parsed.ok) cached = parsed.bundle;
    }
  } catch {
    cached = null;
  }

  // 2. Try a remote update when configured.
  if (REMOTE_RULE_PACK_URL) {
    try {
      const payload = await fetchJson(REMOTE_RULE_PACK_URL);
      const parsed = RuleBundleSchema.safeParse(payload);
      if (parsed.success) {
        const newer =
          !cached ||
          parsed.data.bundleVersion !== cached.bundleVersion ||
          parsed.data.generatedAt > cached.generatedAt;
        if (newer) {
          const validated = parsed.data as RuleBundle;
          await RulePackRepository.saveRemote(validated.bundleVersion, JSON.stringify(validated), validated.checksum ?? null);
          return { status: 'updated', bundle: validated, source: 'remote' };
        }
        return { status: 'cached', bundle: cached as RuleBundle, source: 'cache' };
      }
      // Invalid remote payload: never partially apply it.
      return cached
        ? { status: 'cached', bundle: cached as RuleBundle, source: 'cache' }
        : { status: 'bundled', bundle: BUNDLED_RULE_BUNDLE, source: 'bundled', reason: 'invalid_remote_payload' };
    } catch {
      return cached
        ? { status: 'cached', bundle: cached as RuleBundle, source: 'cache' }
        : { status: 'bundled', bundle: BUNDLED_RULE_BUNDLE, source: 'bundled', reason: 'offline' };
    }
  }

  if (cached) return { status: 'cached', bundle: cached as RuleBundle, source: 'cache' };
  return { status: 'bundled', bundle: BUNDLED_RULE_BUNDLE, source: 'bundled', reason: 'no_remote_configured' };
}

/** Monetization config: bundled defaults, optionally relaxed by remote JSON. */
export async function loadMonetizationConfig(): Promise<{ config: MonetizationConfig; source: 'remote' | 'default' }> {
  if (!REMOTE_MONETIZATION_CONFIG_URL) return { config: DEFAULT_MONETIZATION_CONFIG, source: 'default' };
  try {
    const payload = await fetchJson(REMOTE_MONETIZATION_CONFIG_URL);
    const parsed = RemoteMonetizationSchema.safeParse(payload);
    if (!parsed.success) return { config: DEFAULT_MONETIZATION_CONFIG, source: 'default' };
    const remote = parsed.data;
    // Remote config can never be MORE aggressive than the bundled safety caps.
    const config: MonetizationConfig = {
      ...DEFAULT_MONETIZATION_CONFIG,
      adsEnabled: remote.adsEnabled && DEFAULT_MONETIZATION_CONFIG.adsEnabled,
      bannerEnabled: remote.bannerEnabled && DEFAULT_MONETIZATION_CONFIG.bannerEnabled,
      interstitialEnabled: remote.interstitialEnabled && DEFAULT_MONETIZATION_CONFIG.interstitialEnabled,
      rewardedEnabled: remote.rewardedEnabled && DEFAULT_MONETIZATION_CONFIG.rewardedEnabled,
      homeBannerEnabled: remote.homeBannerEnabled && DEFAULT_MONETIZATION_CONFIG.homeBannerEnabled,
      minShiftsForAds: Math.max(remote.minShiftsForAds, DEFAULT_MONETIZATION_CONFIG.minShiftsForAds),
      minDaysSinceInstallForAds: Math.max(remote.minDaysSinceInstallForAds, DEFAULT_MONETIZATION_CONFIG.minDaysSinceInstallForAds),
      interstitialMinHours: Math.max(remote.interstitialMinHours, DEFAULT_MONETIZATION_CONFIG.interstitialMinHours),
      interstitialMax7d: Math.min(remote.interstitialMax7d, DEFAULT_MONETIZATION_CONFIG.interstitialMax7d),
      minimumSessionsBeforeInterstitial: Math.max(
        remote.minimumSessionsBeforeInterstitial,
        DEFAULT_MONETIZATION_CONFIG.minimumSessionsBeforeInterstitial,
      ),
      rewardedDailyCap: Math.min(remote.rewardedDailyCap, DEFAULT_MONETIZATION_CONFIG.rewardedDailyCap),
      chartHistoryFreeDays: remote.chartHistoryFreeDays,
      advancedChequeChecksFreePerMonth: remote.advancedChequeChecksFreePerMonth,
    };
    return { config, source: 'remote' };
  } catch {
    return { config: DEFAULT_MONETIZATION_CONFIG, source: 'default' };
  }
}
