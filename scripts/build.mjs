#!/usr/bin/env node
// esbuild-based ESM/CJS bundler for dsh-plugin-cli-hub
// 调用方式：node scripts/build.mjs
//
// 设计：
//   1) tsc 先生成 .d.ts 到 dist/，以及临时 JS 到 dist_built/
//   2) esbuild 把 dist_built/src/index.js bundle 成 ESM + CJS（external: cordis 等 peer 依赖）
//   3) 删除 dist_built/ 临时目录
//
// 历史：原本用 tsdown，但 tsdown 内部 rolldown 在处理 MemberExpression 嵌套时崩溃
//      （internal error: entered unreachable code: Always rewrite to MemberExpression for nested MemberExpression）。
//      改用 esbuild + 单独的 tsc emit-decl 步骤。
import * as b from 'esbuild';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const base = process.cwd();
const distDir = path.join(base, 'dist');
const tmpDir = path.join(base, 'dist_built');

// 清理
fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

// 1) tsc 生成类型 + 临时 JS
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

// 3) 清理临时目录
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('cleaned dist_built/');
