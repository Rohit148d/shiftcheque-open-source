/**
 * Brand sync: pushes src/config/brand.ts into app.json and regenerates the
 * machine-readable source manifest. Run before every build.
 *
 *   npm run branding:sync                      -> development package id
 *   EXPO_PUBLIC_APP_ENV=preview npm run branding:sync
 *   EXPO_PUBLIC_APP_ENV=production npm run branding:sync
 *
 * Environment separation is intentional: development and preview builds keep a
 * `.dev` / `.preview` suffix so they can be installed next to production.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = (await import(new URL('../src/config/brand.ts', import.meta.url).href)).BRAND;

const requested = process.env.EXPO_PUBLIC_APP_ENV;
const environment = requested === 'production' ? 'production' : requested === 'preview' ? 'preview' : 'development';
const packageName = brand.PACKAGE_NAME_BY_ENVIRONMENT[environment];

const appJsonPath = join(root, 'app.json');
const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));

appJson.expo.name = brand.SHORT_NAME;
appJson.expo.slug = brand.EAS_PROJECT_SLUG ?? brand.SHORT_NAME.toLowerCase();
appJson.expo.scheme = brand.URL_SCHEME;
appJson.expo.icon = `./${brand.LOGO_ASSET}`;
appJson.expo.android.package = packageName;
appJson.expo.ios.bundleIdentifier = packageName;
appJson.expo.android.adaptiveIcon.backgroundColor = brand.ADAPTIVE_ICON_BACKGROUND;
appJson.expo.splash.backgroundColor = brand.ADAPTIVE_ICON_BACKGROUND;
appJson.expo.extra.packageName = packageName;
appJson.expo.extra.buildEnvironment = environment;
appJson.expo.extra.branding = {
  brand: brand.APP_NAME,
  environment,
  productionPackageId: brand.PACKAGE_NAME_PRODUCTION,
  note:
    environment === 'production'
      ? `${brand.APP_NAME} production identifiers are in use. Do not change them after the first Play upload.`
      : `${brand.APP_NAME} ${environment} build uses a suffixed package id (${packageName}). The production id (${brand.PACKAGE_NAME_PRODUCTION}) is written when EXPO_PUBLIC_APP_ENV=production.`,
};
// Notification channel names are brand-derived: keep the native config in sync
// so Android channels, the JS prefix and the docs never disagree.
appJson.expo.plugins = appJson.expo.plugins.map((plugin) => {
  const [name, options] = Array.isArray(plugin) ? plugin : [plugin, undefined];
  if (name === 'expo-notifications') {
    return [name, { ...(options ?? {}), defaultChannel: `${brand.NOTIFICATION_CHANNEL_PREFIX}-default`, color: '#D52B1E' }];
  }
  return plugin;
});

writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
console.log(`app.json synced: name=${brand.SHORT_NAME} env=${environment} package=${packageName}`);

// Machine-readable rule source manifest (docs/rules/sources.json)
const sources = (await import(new URL('../src/rules/sources.ts', import.meta.url).href)).RULE_SOURCES;
const bundle = (await import(new URL('../src/rules/bundle.ts', import.meta.url).href)).BUNDLED_RULE_BUNDLE;
mkdirSync(join(root, 'docs', 'rules'), { recursive: true });
writeFileSync(
  join(root, 'docs', 'rules', 'sources.json'),
  `${JSON.stringify({ bundleVersion: bundle.bundleVersion, generatedAt: bundle.generatedAt, sources }, null, 2)}\n`,
);
writeFileSync(join(root, 'docs', 'rules', 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`rule manifest written: ${sources.length} sources, bundle ${bundle.bundleVersion}`);
