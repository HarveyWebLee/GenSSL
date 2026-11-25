const { spawnSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const path = require('node:path');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const srcDir = path.resolve(__dirname, '../src');
const files = walk(srcDir).sort();
if (files.length === 0) {
  console.error('No test files found');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--require', 'ts-node/register', '--test', ...files],
  { stdio: 'inherit', cwd: path.resolve(__dirname, '..') },
);
process.exit(result.status === null ? 1 : result.status);
