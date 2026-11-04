import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Cross-platform test runner.
 *
 * Uses Node's built-in test runner with native TypeScript type stripping: no
 * Jest, no ts-node, no transpiler configuration. Test files are discovered by
 * walking `tests/`, so the same command works on Windows, macOS and Linux.
 */
const root = process.cwd();
const testsDir = join(root, 'tests');

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = collect(testsDir).sort();
if (files.length === 0) {
  console.error('No test files found under tests/');
  process.exit(1);
}

const filter = process.argv.slice(2).join(' ');
const selected = filter ? files.filter((file) => relative(root, file).includes(filter)) : files;

console.log(`Running ${selected.length} test file(s) with the Node test runner\n`);

const child = spawn(process.execPath, ['--test', '--test-reporter=spec', ...selected], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: '--no-warnings' },
});

child.on('exit', (code) => process.exit(code ?? 1));
