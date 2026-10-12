// One file for Node 18+: src/index.ts and everything it uses (the MCP SDK, zod, ws) bundled by esbuild — no install
// step for the user, and no git (Roon's own packages aren't on npm).
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

const result = await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/deep-roon-mcp.js',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'linked',
  logLevel: 'warning',
  // Roon's node-roon-api finds a service by its class name (core.services.RoonApiTransport): keep the names as they are.
  keepNames: true,
  metafile: true,
});
// The licences of what went into the bundle (MIT, Apache-2.0, ISC …), from each package's own licence file.
const pkgs = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (!m) continue;
  const dir = input.slice(0, input.indexOf(m[0]) + m[0].length);
  pkgs.set(m[1], dir);
}
let text = 'Deep Roon MCP bundles the packages below. Their licences follow.\n';
for (const [name, dir] of [...pkgs].sort()) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  text += `\n\n==== ${name} ${meta.version} — ${meta.license ?? 'see below'} ====\n\n`;
  text += file ? fs.readFileSync(path.join(dir, file), 'utf8') : `(no licence file; package.json says: ${meta.license ?? 'nothing'})\n`;
}
text += `\n\n==== roon-api-reverse-engineering (Arthur Soares) — MIT ====\n\n${fs.readFileSync('src/intern/LICENSE', 'utf8')}`;
fs.writeFileSync('dist/THIRD_PARTY_LICENSES.txt', text);
console.log(`dist/deep-roon-mcp.js (${pkgs.size} packages bundled, licences in dist/THIRD_PARTY_LICENSES.txt)`);
