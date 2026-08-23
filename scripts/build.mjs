#!/usr/bin/env node
// esbuild-based ESM/CJS bundler for dsh-plugin-cli-hub
// Usage: node scripts/build.mjs
//
// Design:
//   1) tsc first emits .d.ts into dist/, plus temporary JS into dist_built/
//   2) esbuild bundles dist_built/src/index.js into ESM + CJS (external: cordis and other peer deps)
//   3) delete the temporary dist_built/ directory
//
// History: originally used tsdown, but tsdown's internal rolldown crashed on nested MemberExpression
//      (internal error: entered unreachable code: Always rewrite to MemberExpression for nested MemberExpression).
//      Switched to esbuild + a separate tsc emit-decl step.
import * as b from 'esbuild';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const base = process.cwd();
const distDir = path.join(base, 'dist');
const tmpDir = path.join(base, 'dist_built');

// Clean
fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

// 1) tsc generates types + temporary JS
const tscArgs = [
  '--target', 'ES2022',
  '--module', 'ESNext',
  '--moduleResolution', 'bundler',
  '--outDir', tmpDir,
  '--declaration',
  '--declarationDir', distDir,
  '--skipLibCheck',
  '--esModuleInterop',
  '--allowSyntheticDefaultImports',
  '--resolveJsonModule',
];
const tscRes = spawnSync('pnpm', ['tsc', ...tscArgs], { stdio: 'inherit', shell: process.platform === 'win32' });
if (tscRes.status !== 0) {
  console.error('tsc failed with exit code', tscRes.status);
  process.exit(tscRes.status ?? 1);
}

// 2) esbuild bundle ESM + CJS
const entry = path.join(tmpDir, 'src', 'index.js');
const targets = [
  { outfile: path.join(distDir, 'index.js'),  format: 'esm' },
  { outfile: path.join(distDir, 'index.cjs'), format: 'cjs' },
];
const external = [
  'cordis',
  'cosmokit',
  'minimatch',
  'json-schema-to-ts',
  'node:*',
  '@deepseek-ai/*',
];

for (const { outfile, format } of targets) {
  await b.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format,
    platform: 'node',
    target: 'node18',
    allowOverwrite: true,
    external,
    logLevel: 'error',
  });
  console.log(`esbuild: ${format} → ${path.relative(base, outfile)}`);
}

console.log('esbuild bundle OK');

// 3) Clean up the temporary directory
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('cleaned dist_built/');
