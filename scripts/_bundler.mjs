// Fallback bundler using esbuild (replaces broken tsdown build → single bundle)
import * as esbuild from 'esbuild';
const entry = '/Users/wf/自进化/临时/dsh-cli/dist_built/src/index.js';
// esbuild bundle into ESM then CJS
await esbuild.build({
  entryPoints: [entry],
  outfile: '/Users/wf/自进化/临时/dsh-cli/dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  allowOverwrite: true,
  external: ['cordis','cosmokit','minimatch','json-schema-to-ts','node:*','@deepseek-ai/*']
});
await esbuild.build({
  entryPoints: [entry],
  outfile: '/Users/wf/自进化/临时/dsh-cli/dist/index.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  allowOverwrite: true,
  external: ['cordis','cosmokit','minimatch','json-schema-to-ts','node:*','@deepseek-ai/*']
});
console.log('esbuild bundle OK.');
