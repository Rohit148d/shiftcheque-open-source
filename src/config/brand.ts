/**
 * CENTRAL BRAND CONFIGURATION
 * ---------------------------------------------------------------------------
 * Public brand: **ShiftCheque**.
 *
 * The product was developed under the working name "PayMate"; that name is
 * retired and must never appear in user-facing code again (see
 * `npm run branding:check`).
 *
 * Rules:
 *  - Never hard-code the product name, URLs, e-mails, package ids, product
 *    names, share text or file extensions anywhere else in the codebase.
 *  - `npm run branding:check` fails the build if a brand string is found outside
 *    this file.
 *  - `npm run branding:sync` pushes these values into app.json. Set
 *    `EXPO_PUBLIC_APP_ENV=production` to write the production package id.
 *
 * See docs/BRAND_RENAME_CHECKLIST.md for the rename procedure and status.
 */

export const BRAND = {
  /** Public display name. */
  APP_NAME: 'ShiftCheque',
  /** Launcher / short label (<= 12 chars recommended). */
  SHORT_NAME: 'ShiftCheque',
  /** Primary tagline. */
  TAGLINE: 'Know your pay before payday.',
  /** Alternative marketing phrase (store copy, share sheets). */
  ALT_TAGLINE: 'Your payday sidekick.',

  SUPPORT_EMAIL: 'support@example.com',
  /** Live public site (Cloudflare Pages). */
  WEBSITE_URL: 'https://shiftcheque.pages.dev',
  PRIVACY_URL: 'https://shiftcheque.pages.dev/privacy',
  TERMS_URL: 'https://shiftcheque.pages.dev/terms',
  SUPPORT_URL: 'https://shiftcheque.pages.dev/support',
  /**
   * TARGET urls that are not published yet. Empty: the privacy, terms and
   * support pages are live at the URLs above.
   */
  PLACEHOLDER_URLS: [] as readonly string[],

  PLAY_STORE_TITLE: 'ShiftCheque: Shift & Pay',
  PLAY_STORE_SHORT_DESCRIPTION:
    'Track shifts, overtime and your estimated Canadian take-home pay.',

  /**
   * Package / bundle identifiers per environment.
   *
   * `ca.shiftcheque.app` is the intended PRODUCTION id and is only written to
   * app.json when EXPO_PUBLIC_APP_ENV=production. Development and preview builds
   * keep a suffix so they can coexist with a production install on one device.
   *
   * Do not change the production id after the first production upload.
   */
  PACKAGE_NAME_BY_ENVIRONMENT: {
    development: 'ca.shiftcheque.app.dev',
    preview: 'ca.shiftcheque.app.preview',
    production: 'ca.shiftcheque.app',
  },
  /** What local/dev builds currently use. */
  PACKAGE_NAME_REFERENCE: 'ca.shiftcheque.app.dev',
  BUNDLE_ID_REFERENCE: 'ca.shiftcheque.app.dev',
  /** The intended production identifier, for checklists and tooling. */
  PACKAGE_NAME_PRODUCTION: 'ca.shiftcheque.app',

  /** In-app subscription product name (display). */
  PRO_PRODUCT_NAME: 'ShiftCheque Pro',
  /** RevenueCat entitlement identifier (isolated so it can be renamed). */
  PRO_ENTITLEMENT_ID: 'shiftcheque_pro',
  /** Store product identifiers (configure the same ids in Play Console). */
  PRO_PRODUCT_IDS: {
    monthly: 'shiftcheque_pro_monthly',
  },
  /** Working target price, display fallback only. Real price comes from the store. */
  PRO_TARGET_PRICE_CA: 0.99,

  SHARE_FOOTER_TEXT: 'Track shifts and estimate your take-home pay with ShiftCheque.',
  /**
   * Expo/EAS project slug. Normally derived from SHORT_NAME by `branding:sync`.
   * Set explicitly when the Expo project was created under a different name —
   * EAS refuses to build when the slug does not match the linked project.
   * Rename the project on expo.dev to SHORT_NAME and delete this override to go
   * back to the derived value.
   */
  EAS_PROJECT_SLUG: 'shiftcheque',
  /** Deep link scheme. */
  URL_SCHEME: 'shiftcheque',
  /** Backup file extension (brand-derived, easy to rename). */
  BACKUP_FILE_EXTENSION: '.shiftchequebackup',
  /** Backup file format identifier written by new backups. */
  BACKUP_FORMAT: 'shiftcheque-backup',
  /**
   * Backup formats written by earlier development builds. Imports still accept
   * these so a rename never strands a file the user already created.
   */
  LEGACY_BACKUP_FORMATS: ['paymate-backup'],
  /** Notification channel prefix. */
  NOTIFICATION_CHANNEL_PREFIX: 'shiftcheque',
  /** Anonymous analytics metadata tag. */
  ANALYTICS_APP_TAG: 'shiftcheque',
  /** Assets. */
  LOGO_ASSET: 'assets/icon.png',
  ADAPTIVE_ICON_BACKGROUND: '#0E1B2A',
  /** Default accent theme id (see src/ui/themes.ts). */
  ACCENT_THEME: 'maple',
  /** Legal disclaimer. {app} is replaced with APP_NAME at render time. */
  DISCLAIMER_TEXT:
    '{app} provides estimates for personal planning and paycheque checking. Payroll, tax treatment, employment standards, workplace agreements and individual circumstances can vary. {app} is not payroll, tax, accounting or legal advice.',
  /** Recorded for documentation/history only; never rendered in the UI. */
  FORMER_DEVELOPMENT_NAME: 'PayMate',
} as const;

export const APP_NAME = BRAND.APP_NAME;
export const PRO_ENTITLEMENT_ID = BRAND.PRO_ENTITLEMENT_ID;
export const BACKUP_FILE_EXTENSION = BRAND.BACKUP_FILE_EXTENSION;
export const ANALYTICS_APP_TAG = BRAND.ANALYTICS_APP_TAG;
export const NOTIFICATION_CHANNEL_PREFIX = BRAND.NOTIFICATION_CHANNEL_PREFIX;

export type BrandEnvironment = keyof typeof BRAND.PACKAGE_NAME_BY_ENVIRONMENT;

/** Package/bundle id for an environment (defaults to development). */
export function packageNameFor(environment: string): string {
  const map = BRAND.PACKAGE_NAME_BY_ENVIRONMENT as Record<string, string>;
  return map[environment] ?? BRAND.PACKAGE_NAME_BY_ENVIRONMENT.development;
}

/** True when a URL is a documented target that is not published yet. */
export function isPlaceholderUrl(url: string): boolean {
  return (BRAND.PLACEHOLDER_URLS as readonly string[]).includes(url);
}

/** Replaces {app} tokens in brand copy. */
export function brandCopy(template: string): string {
  return template.replace(/\{app\}/g, BRAND.APP_NAME);
}

/** Display name for the Pro product, always brand-aware. */
export function proProductName(): string {
  return BRAND.PRO_PRODUCT_NAME;
}
