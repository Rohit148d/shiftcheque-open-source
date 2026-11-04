/**
 * Memo cache for pay-period calculations.
 *
 * BUG THIS EXISTS TO PREVENT: the cache used to be keyed on job + period + date
 * + job.updatedAt only. Adding or editing a shift did not change the key, so the
 * Home card kept showing the estimate computed before those shifts existed
 * (the reported "60 h / $1,860" instead of "75 h / $2,325").
 *
 * The key therefore includes a monotonic `revision` that the store bumps on every
 * data mutation, and this module is pure so the invalidation rule is unit-tested.
 */

export type CacheKeyInput = {
  jobId: string;
  periodStart: string;
  periodEnd: string;
  /** Local "today", so the projection dates its own output. */
  today: string;
  /** Extra earnings identity (labels + amounts are part of the computation). */
  extrasKey?: string;
  /** Monotonic revision of the underlying data (optional belt-and-braces). */
  revision?: number;
  /**
   * Fingerprint of the shift data the calculation consumes. This is what makes
   * adding or editing a shift invalidate the cached estimate.
   */
  shiftsFingerprint?: string;
  /**
   * The job's own revision. Editing the rate, schedule, work week, premiums or
   * vacation must invalidate the estimate too.
   */
  jobUpdatedAt?: string;
};

export function calculationCacheKey(input: CacheKeyInput): string {
  return [
    input.jobId,
    input.periodStart,
    input.periodEnd,
    input.today,
    input.extrasKey ?? '',
    `r${input.revision ?? 0}`,
    input.shiftsFingerprint ?? '',
    input.jobUpdatedAt ?? '',
  ].join('|');
}

/**
 * Cheap, order-independent fingerprint of the shifts a calculation depends on.
 * Any add, edit, delete, status change, confirmation, live-shift tick or
 * paid-hours override produces a different fingerprint.
 */
export function shiftsFingerprint(
  shifts: { id: string; updatedAt: string; status: string; confirmed: boolean; paidMinutesOverride?: number; actualStart?: string; actualEnd?: string }[],
): string {
  let hash = 2166136261;
  for (const shift of shifts) {
    const material = [
      shift.id,
      shift.updatedAt,
      shift.status,
      shift.confirmed ? '1' : '0',
      shift.paidMinutesOverride ?? '',
      shift.actualStart ?? '',
      shift.actualEnd ?? '',
    ].join(':');
    for (let index = 0; index < material.length; index += 1) {
      hash ^= material.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${shifts.length}.${(hash >>> 0).toString(36)}`;
}

export type CalculationCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
  size(): number;
};

export function createCalculationCache<T>(limit = 24): CalculationCache<T> {
  const entries = new Map<string, T>();
  return {
    get(key) {
      return entries.get(key);
    },
    set(key, value) {
      entries.set(key, value);
      // Oldest-first eviction: Map preserves insertion order.
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

/** Stable identity for extra earnings, so two different lists never share a cache entry. */
export function extrasKeyFor(extras: { id?: string; label: string; amount: bigint }[]): string {
  if (extras.length === 0) return '';
  return extras.map((extra) => `${extra.id ?? extra.label}:${extra.amount}`).join(',');
}
