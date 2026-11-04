/**
 * Verify a produced Android App Bundle without any Android tooling.
 *
 * An .aab is a zip. This reads the zip central directory directly (Node built-ins
 * only) and checks that the shipped bundle really contains what the Play Console
 * needs to see before enabling subscription products:
 *
 *   - base/dex/*.dex contains com.android.billingclient (Google Play Billing)
 *   - base/dex/*.dex contains com.revenuecat.purchases (RevenueCat SDK)
 *   - base/manifest/AndroidManifest.xml declares the expected package id
 *   - the bundle is signed (META-INF signature files present)
 *
 *   node scripts/verify-aab.mjs <path-to.aab> [expected.package.id]
 */
import { readFileSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const filePath = process.argv[2];
const expectedPackage = process.argv[3] ?? 'ca.shiftcheque.app';

if (!filePath) {
  console.error('Usage: node scripts/verify-aab.mjs <path-to.aab> [expected.package.id]');
  process.exit(1);
}

const buffer = readFileSync(filePath);

/** Reads the zip central directory and returns entry metadata. */
function readCentralDirectory(zip) {
  const EOCD_SIGNATURE = 0x06054b50;
  const MAX_COMMENT = 0xffff;
  let eocd = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 22 - MAX_COMMENT); offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive: end-of-central-directory not found');

  const entryCount = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Corrupt central directory at entry ${index}`);
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localHeaderOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    entries.push({ name, method, compressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Decompresses one entry. */
function readEntry(zip, entry) {
  const headerOffset = entry.localHeaderOffset;
  if (zip.readUInt32LE(headerOffset) !== 0x04034b50) throw new Error(`Corrupt local header for ${entry.name}`);
  const nameLength = zip.readUInt16LE(headerOffset + 26);
  const extraLength = zip.readUInt16LE(headerOffset + 28);
  const dataStart = headerOffset + 30 + nameLength + extraLength;
  const data = zip.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}`);
}

const entries = readCentralDirectory(buffer);
const byName = new Map(entries.map((entry) => [entry.name, entry]));
// Works for both an Android App Bundle (base/…) and an APK (flat layout).
const isApk = entries.some((entry) => /^classes\d*\.dex$/.test(entry.name));
const dexEntries = isApk
  ? entries.filter((entry) => /^classes\d*\.dex$/.test(entry.name))
  : entries.filter((entry) => /^base\/dex\/.*\.dex$/.test(entry.name));
const manifestEntry = isApk ? byName.get('AndroidManifest.xml') : byName.get('base/manifest/AndroidManifest.xml');
const signatureEntries = entries.filter((entry) => entry.name.startsWith('META-INF/') && /\.(RSA|DSA|EC|SF)$/.test(entry.name));
const hasSigningBlock = buffer.includes(Buffer.from('APK Sig Block 42', 'latin1'));

const results = [];
const fail = (message) => results.push({ ok: false, message });
const pass = (message) => results.push({ ok: true, message });

if (dexEntries.length === 0) fail(`no dex payload found (${isApk ? 'APK' : 'AAB'} layout)`);

const dexHaystack = dexEntries.map((entry) => readEntry(buffer, entry).toString('latin1')).join('\n');

/** Collects a short sample around the first matches, as evidence. */
function samples(needle, count = 3) {
  const found = [];
  let from = 0;
  while (found.length < count) {
    const at = dexHaystack.indexOf(needle, from);
    if (at < 0) break;
    const snippet = dexHaystack.slice(Math.max(0, at - 30), at + needle.length + 30).replace(/[^\x20-\x7e]/g, '.');
    if (!found.includes(snippet)) found.push(snippet);
    from = at + needle.length;
  }
  return found;
}

for (const [needle, label, showSamples] of [
  // DEX stores class names as descriptors with slashes.
  ['Lcom/android/billingclient/api/BillingClient;', 'Google Play Billing BillingClient class', true],
  ['Lcom/android/billingclient/api/', 'Google Play Billing api package (class descriptors)', true],
  ['com.android.billingclient', 'Google Play Billing package string', false],
  ['Lcom/revenuecat/purchases/', 'RevenueCat SDK classes (descriptors)', true],
  ['com.revenuecat.purchases', 'RevenueCat package string', false],
]) {
  if (dexHaystack.includes(needle)) {
    pass(`${label} present in dex payload`);
    if (showSamples) for (const snippet of samples(needle)) console.log(`    …${snippet}…`);
  } else {
    fail(`${label} NOT found in dex payload`);
  }
}

if (!manifestEntry) {
  fail('no base/manifest/AndroidManifest.xml in the bundle');
} else {
  // Android binary XML stores strings as UTF-16, so search both encodings.
  const manifestBytes = readEntry(buffer, manifestEntry);
  const manifestLatin = manifestBytes.toString('latin1');
  const manifestUtf16 = manifestBytes.toString('utf16le');
  if (manifestLatin.includes(expectedPackage) || manifestUtf16.includes(expectedPackage)) {
    pass(`manifest declares package id ${expectedPackage}`);
  } else {
    fail(`manifest does not contain the expected package id ${expectedPackage}`);
  }
}

if (signatureEntries.length > 0) pass(`signed (${signatureEntries.map((e) => e.name.split('/').pop()).join(', ')})`);
else if (hasSigningBlock) pass('signed (APK Signing Block v2/v3)');
else fail('no signature found — an unsigned artifact cannot be installed or uploaded');

pass(
  `${isApk ? 'APK' : 'AAB'}: ${(statSync(filePath).size / (1024 * 1024)).toFixed(1)} MB, ${entries.length} entries, ${dexEntries.length} dex file(s)`,
);

// Optional: print the Maven coordinates recorded in the bundle's dependency
// metadata (BUNDLE-METADATA/com.android.tools.build.libraries/dependencies.pb).
if (process.argv.includes('--deps')) {
  const depEntry = byName.get('BUNDLE-METADATA/com.android.tools.build.libraries/dependencies.pb');
  if (!depEntry) {
    results.push({ ok: false, message: 'dependency metadata not found in the bundle' });
  } else {
    const metadata = readEntry(buffer, depEntry).toString('latin1');
    const strings = [...metadata.matchAll(/[\x20-\x7e]{4,}/g)].map((match) => match[0]);
    const interesting = strings
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => /^(com\.android\.billingclient|com\.revenuecat)/.test(value));
    const versionLike = /^\d+(\.\d+){1,3}(-[A-Za-z0-9.]+)?$/;
    console.log('\n=== dependency coordinates recorded in the bundle ===');
    const seen = new Set();
    for (const { value, index } of interesting.slice(0, 40)) {
      const nearby = strings
        .slice(index, index + 4)
        .find((candidate) => versionLike.test(candidate));
      const line = `${value}${nearby ? `:${nearby}` : ''}`;
      if (seen.has(line)) continue;
      seen.add(line);
      console.log(`  ${line}`);
    }
  }
}

for (const result of results) console.log(`${result.ok ? '✔' : '✖'} ${result.message}`);
const failures = results.filter((result) => !result.ok);
if (failures.length > 0) {
  console.error(`\n✖ AAB verification failed with ${failures.length} problem(s).`);
  process.exit(1);
}
console.log(`\n✔ ${isApk ? 'APK' : 'AAB'} verified: Play Billing + RevenueCat present, package id correct, signed.`);
