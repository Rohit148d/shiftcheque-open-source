/**
 * Brand guard: fails when a brand string is hard-coded outside the brand
 * configuration, or when the retired development name reappears.
 *
 *   npm run branding:check
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanned = [join(root, 'src')];
const allowedFiles = new Set([join(root, 'src', 'config', 'brand.ts')]);

/**
 * Strings that must only ever live in src/config/brand.ts:
 *  - the retired working name, so it cannot creep back in
 *  - every brand-derived identifier that a rename would otherwise miss
 */
const forbidden = [
  'PayMate',
  'paymate',
  'shiftcheque_pro',
  'shiftchequebackup',
  'ca.shiftcheque.app',
  'shiftcheque',
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

const violations = [];
for (const dir of scanned) {
  for (const file of walk(dir)) {
    if (allowedFiles.has(file)) continue;
    const contents = readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      // `shiftcheque.db` is derived from BRAND.SHORT_NAME and is legitimate.
      const matches = contents
        .split('\n')
        .map((line, index) => ({ line, index: index + 1 }))
        .filter(({ line }) => line.toLowerCase().includes(needle.toLowerCase()));
      for (const match of matches) {
        if (/SHORT_NAME|APP_NAME|brand|BRAND/.test(match.line)) continue;
        violations.push(`${relative(root, file)}:${match.index} hard-codes "${needle}"`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Brand check failed. Move these values into src/config/brand.ts:\n');
  for (const violation of [...new Set(violations)]) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(
  `Brand check passed: no hard-coded brand strings outside src/config/brand.ts (${forbidden.length} patterns checked).`,
);
