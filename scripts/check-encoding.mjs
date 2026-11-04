/**
 * Encoding guard + repair for user-facing text.
 *
 * Detects and (with --fix) repairs:
 *   - UTF-8 BOMs, which break JSON parsing and are pointless in source
 *   - invalid UTF-8 byte sequences
 *   - mojibake: UTF-8 text that was decoded as Windows-1252 and re-encoded, which
 *     is what turns "•" into "â€¢", "—" into "â€"", "👋" into "ðŸ‘‹" and
 *     "é" into "Ã©"
 *
 * The repair reverses the double encoding exactly (CP1252 → bytes → UTF-8), so
 * valid French accents survive untouched and nothing is guessed per-string.
 *
 *   node scripts/check-encoding.mjs          # report only, exit 1 when found
 *   node scripts/check-encoding.mjs --fix    # repair in place
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fix = process.argv.includes('--fix');

const ROOTS = [
  'src',
  'tests',
  'scripts',
  'docs',
];
const FILES = [
  'app.json',
  'eas.json',
  'package.json',
  'tsconfig.json',
  'README.md',
];
const TEXT_EXTENSIONS = /\.(ts|tsx|js|mjs|json|md|css|html|xml|txt|yml|yaml)$/;
/** The guard itself necessarily contains the corruption patterns it looks for. */
const IGNORED_FILES = new Set(['scripts/check-encoding.mjs']);

/** Windows-1252 → byte, for the 0x80–0x9F range that is not identity-mapped. */
const CP1252_TO_BYTE = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

const MOJIBAKE_PATTERNS = [
  /â€/, /ðŸ/, /Ã[\u0080-\u00bf]/, /Â[\u00a0-\u00bf]/, /â€™/, /â€œ/, /â€“/, /â€”/, /â€¦/, /à¤/, /ãƒ/,
];

function toBytes(text) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (CP1252_TO_BYTE.has(code)) bytes.push(CP1252_TO_BYTE.get(code));
    else if (code === 0xfffd) return null; // replacement char: information already lost
    else bytes.push(code); // char outside CP1252: leave as-is, UTF-8 decode will decide
  }
  return Buffer.from(bytes);
}

function collect(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-builds' || entry === '.expo') continue;
    if (statSync(full).isDirectory()) collect(full, out);
    else if (TEXT_EXTENSIONS.test(entry)) out.push(full);
  }
  return out;
}

const files = [];
for (const rel of ROOTS) collect(join(root, rel), files);
for (const rel of FILES) {
  const full = join(root, rel);
  try {
    if (statSync(full).isFile()) files.push(full);
  } catch {
    // optional file
  }
}

const problems = [];
const repaired = [];
let scannedCount = 0;

for (const file of [...new Set(files)]) {
  const buffer = readFileSync(file);
  const label = relative(root, file);
  if (IGNORED_FILES.has(label.split('\\').join('/'))) continue;
  scannedCount += 1;
  let text;
  let hasBom = false;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    hasBom = true;
    text = buffer.subarray(3).toString('utf8');
  } else {
    text = buffer.toString('utf8');
  }

  const issues = [];
  if (hasBom) issues.push('UTF-8 BOM');
  const invalid = text.includes('\uFFFD');
  if (invalid) issues.push('replacement character(s) — invalid byte sequence');
  const mojibake = MOJIBAKE_PATTERNS.some((pattern) => pattern.test(text));
  if (mojibake) issues.push('mojibake sequence');

  if (issues.length === 0) continue;

  // Mojibake repair reverses the double encoding exactly (CP1252 → bytes → UTF-8).
  const bytes = toBytes(text);
  let candidate = null;
  if (bytes) {
    try {
      candidate = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      candidate = null;
    }
  }
  let repairedText = text;
  let repairable = false;
  if (mojibake) {
    if (candidate !== null && !candidate.includes('\uFFFD') && candidate !== text) {
      repairedText = candidate;
      repairable = true;
    } else {
      repairable = false;
    }
  } else if (hasBom) {
    // A stray BOM is always safely removable.
    repairedText = text;
    repairable = true;
  }

  if (fix && repairable) {
    writeFileSync(file, repairedText, 'utf8');
    repaired.push(`${label} (${issues.join(', ')})`);
  } else {
    problems.push(`${label}: ${issues.join(', ')}${repairable ? '' : ' — needs manual repair'}`);
  }
}

for (const entry of repaired) console.log(`✔ ${entry}`);
if (problems.length > 0) {
  console.error(`\n✖ ${problems.length} file(s) with encoding problems:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nRun: node scripts/check-encoding.mjs --fix');
  process.exit(1);
}
console.log(
  repaired.length > 0
    ? `\n✔ ${repaired.length} file(s) repaired; re-run without --fix to confirm clean.`
    : `✔ encoding check passed: ${scannedCount} text files in the repository with no BOMs, no invalid UTF-8 and no mojibake.`,
);
