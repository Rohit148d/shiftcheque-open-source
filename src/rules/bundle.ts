/**
 * The bundled rule bundle: the verified rules that ship inside the app, so it
 * works completely offline out of the box.
 *
 * A remote bundle (when configured) is validated with the same schema and, if
 * it is newer and valid, is layered on top. If anything about the remote bundle
 * is wrong, the app keeps using either the last verified cached bundle or these
 * bundled rules (see services/ruleUpdates.ts).
 */
import { HOLIDAY_DEFINITIONS } from '../core/holiday.ts';
import { OVERTIME_PACKS, VACATION_PACKS } from './packs/employment.ts';
import { PAYROLL_PACKS } from './packs/payroll.ts';
import { RULE_SOURCES } from './sources.ts';
import { RuleBundleSchema, type RuleBundle, type StatutoryHolidayRule } from './types.ts';

const VERIFIED_AT = '2026-10-05';

function holidayRules(): StatutoryHolidayRule[] {
  return HOLIDAY_DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    jurisdictions: definition.jurisdictions,
    kind: definition.kind === 'monday_before' ? ('nth_weekday' as const) : definition.kind,
    month: definition.month ?? null,
    day: definition.day ?? null,
    nth: definition.nth ?? null,
    weekday: definition.weekday ?? null,
    easterOffset: definition.easterOffset ?? null,
    observedRule: definition.observedRule,
    sourceIds: definition.jurisdictions
      .filter((jurisdiction) => jurisdiction !== 'FED')
      .slice(0, 1)
      .map((jurisdiction) => `${jurisdiction.toLowerCase()}-esa-overtime`),
  }));
}

export const BUNDLED_RULE_BUNDLE: RuleBundle = RuleBundleSchema.parse({
  bundleVersion: '2026.10.1',
  generatedAt: VERIFIED_AT,
  sources: RULE_SOURCES,
  overtime: OVERTIME_PACKS,
  vacation: VACATION_PACKS,
  holidays: holidayRules(),
  payroll: PAYROLL_PACKS,
});

export type BundleValidationResult =
  | { ok: true; bundle: RuleBundle }
  | { ok: false; errors: string[] };

/** Validates any external bundle (remote download, cached file, import). */
export function validateRuleBundle(input: unknown): BundleValidationResult {
  const parsed = RuleBundleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
  }
  return { ok: true, bundle: parsed.data };
}
