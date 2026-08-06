#!/usr/bin/env node
/**
 * Vendors packages/* sources into apps/web/vendor so the web app is fully
 * self-contained (no npm-workspace resolution needed at deploy time).
 * packages/* remain the source of truth — run this after editing them.
 */
import { cp, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pairs = [
  ['packages/engine/src', 'apps/web/vendor/engine/src'],
  ['packages/shared/src', 'apps/web/vendor/shared/src'],
];

// shared's type imports point at @mip/engine; inside vendor they must be relative
for (const [from, to] of pairs) {
  const src = join(root, from);
  const dest = join(root, to);
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
  console.log(`vendored ${from} -> ${to}`);
}

// rewrite '@mip/engine' → '../../engine/src' inside vendored shared
const sharedDir = join(root, 'apps/web/vendor/shared/src');
const { readdir } = await import('node:fs/promises');
for (const f of await readdir(sharedDir)) {
  if (!f.endsWith('.ts')) continue;
  const p = join(sharedDir, f);
  const content = await readFile(p, 'utf8');
  if (content.includes("'@mip/engine'")) {
    await writeFile(p, content.replaceAll("'@mip/engine'", "'../../engine/src'"));
    console.log(`rewrote @mip/engine import in vendor/shared/src/${f}`);
  }
}
console.log('done.');
