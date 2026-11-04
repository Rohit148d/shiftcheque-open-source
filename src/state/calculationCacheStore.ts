/**
 * The shared calculation cache instance.
 *
 * It lives in its own module so both the selectors (which read it) and the store
 * (which clears it when a job is deleted) can use it without an import cycle.
 *
 * Note: correctness does not depend on explicit clearing — the cache key includes
 * the job revision and a fingerprint of the shift data, so an edit is a miss by
 * construction. Clearing is memory hygiene.
 */
import type { PayPeriodCalculation } from '../core/calculate.ts';
import { createCalculationCache, type CalculationCache } from './calculationCache.ts';

export const calculationCache: CalculationCache<PayPeriodCalculation> = createCalculationCache<PayPeriodCalculation>();

export function clearCalculationCache(): void {
  calculationCache.clear();
}
