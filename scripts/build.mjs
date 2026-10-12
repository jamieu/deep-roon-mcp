// One file for Node 18+: src/index.ts and everything it uses (the MCP SDK, zod, ws) bundled by esbuild — no install
// step for the user, and no git (Roon's own packages aren't on npm).
import { build } from 'esbuild';

await build({
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
});
console.log('dist/deep-roon-mcp.js');
