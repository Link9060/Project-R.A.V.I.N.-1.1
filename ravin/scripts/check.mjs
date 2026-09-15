import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const roots = ['server.js', 'src', 'public'];
const ignored = new Set(['node_modules']);
const files = [];

function walk(target) {
  const full = path.join(root, target);
  const stat = statSync(full);
  if (stat.isFile()) {
    if (/\.(?:js|mjs)$/.test(target)) files.push(target);
    return;
  }
  for (const entry of readdirSync(full)) {
    if (ignored.has(entry)) continue;
    walk(path.join(target, entry));
  }
}

for (const target of roots) walk(target);

let failed = 0;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`\nRAVIN quality check failed for ${failed} file(s).`);
  process.exit(1);
}

console.log(`RAVIN quality check passed (${files.length} JavaScript files).`);
