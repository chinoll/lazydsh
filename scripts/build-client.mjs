// SPDX-License-Identifier: GPL-3.0-only
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const options = {
  entryPoints: ['src/client/index.jsx'], outfile: 'lib/client.js', bundle: true, write: false,
  format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic',
  external: ['react-dom', 'react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: 'window.__ModuleLoader__.load({id:"lazydsh",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
};
const first = await build(options);
const css = first.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
const result = await build({ ...options, define: { ...options.define, __LAZYDSH_MODELS_CSS__: JSON.stringify(css) } });
await mkdir('lib', { recursive: true });
await writeFile('lib/client.js', result.outputFiles.find(file => file.path.endsWith('.js')).contents);
