// Deep Roon MCP — an MCP server for Roon over stdio. It talks to the user's own Roon Core on the local network: the
// extension API (9330) for the Core's identity, and Roon's internal protocol (9332) for everything the official API
// doesn't reach. Nothing leaves the network except what the MCP client sends to its model.
//
//   ROON_HOST=<address>[:port]   the Core, when it can't be found on the network (another subnet, a VPN)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerReadTools } from './tools/read';
import { registerControlTools } from './tools/control';
import { findTarget, shutdown } from './core/session';
import { log } from './core/log';
import { version } from '../package.json';

const INSTRUCTIONS = `Deep Roon MCP connects to the user's own Roon Core (music player software, with Qobuz behind it when the user has it).
- Albums, tracks and artists come with a \`key\`; keys stay valid between calls — no need to search again.
- Reviews and biographies are Roon's own texts: when asked for them, show them in full with the author's name.
- What plays changes all the time: read roon_now_playing afresh before describing it.
- Unofficial: this uses Roon's internal protocol, which a Roon update can change; if a tool says so, tell the user to check for an update.`;

async function main(): Promise<void> {
  const server = new McpServer({ name: 'deep-roon-mcp', title: 'Deep Roon MCP', version, websiteUrl: 'https://github.com/renebouwmeester/deep-roon-mcp' }, { instructions: INSTRUCTIONS });
  registerReadTools(server);
  registerControlTools(server);
  await server.connect(new StdioServerTransport());
  log(`${version} ready (stdio)`);
  // Find the Core and connect the extension right away, so Deep Roon MCP shows up in Roon's Settings → Extensions.
  findTarget().catch((e) => log(`no Roon Core yet: ${(e as Error).message}`));
  const stop = () => { shutdown(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  process.stdin.on('close', stop);
}

main().catch((e) => { log(`fatal: ${(e as Error).message}`); process.exit(1); });
