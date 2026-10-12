// Deep Roon MCP — an MCP server for Roon over stdio. It talks to the user's own Roon Core on the local network: the
// extension API (9330) for the Core's identity, and Roon's internal protocol (9332) for everything the official API
// doesn't reach. Nothing leaves the network except what the MCP client sends to its model.
//
//   ROON_HOST=<address>[:port]   the Core, when it can't be found on the network (another subnet, a VPN)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReadTools } from './tools/read';
import { registerControlTools } from './tools/control';
import { registerLibraryTools } from './tools/library';
import { registerStatusTool } from './tools/status';
import { afterFirstConnect } from './core/session';
import { checkForUpdate, selfTest } from './core/status';
import { runSelfTest } from './roon/selftest';
import { findTarget, shutdown } from './core/session';
import { log } from './core/log';
import { version } from '../package.json';

const INSTRUCTIONS = `Deep Roon MCP connects to the user's own Roon Core (music player software, with Qobuz and/or TIDAL behind it when the user has them).
- Albums, tracks and artists come with a \`key\`; keys stay valid between calls — no need to search again.
- Reviews and biographies are Roon's own texts: when asked for them, show them in full with the author's name.
- What plays changes all the time: read roon_now_playing afresh before describing it.
- "Daily Mixes" are Roon's own (roon_mixes); the user's TIDAL mixes (My Mix 1 …, My Daily Discovery) are roon_tidal_playlists with shelf my_mixes, and their tracks can be read with roon_playlist.
- Unofficial: this uses Roon's internal protocol, which a Roon update can change; if a tool says so, tell the user to check for an update.`;

async function main(): Promise<void> {
  const server = new McpServer({ name: 'deep-roon-mcp', title: 'Deep Roon MCP', version, websiteUrl: 'https://github.com/renebouwmeester/deep-roon-mcp' }, { instructions: INSTRUCTIONS });
  // The switches (the bundle's settings, or the environment):
  //   DEEP_ROON_INTERNAL=off   only the official extension API — Roon's internal protocol stays closed
  //   DEEP_ROON_TOOLS=essentials   seventeen tools instead of all, for clients and small models that choke on many
  const internal = !/^(off|false|0|no)$/i.test(process.env.DEEP_ROON_INTERNAL ?? '');
  const essentials = /^(essentials|true|1|yes)$/i.test(process.env.DEEP_ROON_TOOLS ?? process.env.DEEP_ROON_ESSENTIALS ?? '');
  if (essentials) {
    const keep = new Set(['roon_status', 'roon_search', 'roon_album', 'roon_review', 'roon_bio', 'roon_artist', 'roon_zones', 'roon_now_playing', 'roon_play',
      'roon_play_tracks', 'roon_control', 'roon_volume', 'roon_queue', 'roon_playlists', 'roon_play_playlist', 'roon_daily_picks', 'roon_top']);
    const original = server.registerTool.bind(server) as Function;
    (server as { registerTool: Function }).registerTool = (name: string, cfg: unknown, cb: unknown) => (keep.has(name) ? original(name, cfg, cb) : undefined);
  }
  registerStatusTool(server, internal);
  registerReadTools(server, internal);
  registerControlTools(server, internal);
  if (internal) {
    registerLibraryTools(server);
    afterFirstConnect(() => selfTest(runSelfTest));
  }
  checkForUpdate().catch(() => {});
  log(`${internal ? 'internal protocol on' : 'internal protocol OFF — official API only'}${essentials ? ', essentials' : ''}`);
  await server.connect(new StdioServerTransport());
  log(`${version} ready (stdio)`);
  // Find the Core and connect the extension right away, so Deep Roon MCP shows up in Roon's Settings → Extensions.
  findTarget().catch((e) => log(`no Roon Core yet: ${(e as Error).message}`));
  const stop = () => { shutdown(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  process.stdin.on('close', stop);
}

main().catch((e) => { log(`fatal: ${(e as Error).message}`); process.exit(1); });
