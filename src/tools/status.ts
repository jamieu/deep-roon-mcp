// roon_status: how Deep Roon MCP stands — for the user, and for a bug report.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { version } from '../../package.json';
import { findTarget } from '../core/session';
import { isPaired, paired as waitPaired } from '../core/official';
import { selfTest, selfTestResults, updateInfo } from '../core/status';
import { runSelfTest } from '../roon/selftest';
import { run } from './run';

export function registerStatusTool(server: McpServer, internal: boolean): void {
  server.registerTool('roon_status', {
    title: 'Deep Roon MCP status',
    description: 'How Deep Roon MCP stands: its version (and whether a newer one is out), the Roon Core it talks to, whether it is enabled in Roon (Settings › Extensions), whether Roon\'s internal protocol works, and a self-test of a few reads with the tools each one stands for. Use it when a tool fails, or when the user asks whether everything works.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, () => run(async () => {
    const t = await findTarget().catch((e: Error) => ({ error: e.message }));
    const core = 'error' in t ? { error: t.error } : { name: t.info.name, version: t.info.version, address: t.host };
    if (!('error' in t)) await waitPaired(5000).catch(() => null);   // a fresh start pairs within a second or two
    const paired = isPaired();
    if (internal && paired && !selfTestResults()) await selfTest(runSelfTest);
    const checks = selfTestResults();
    return {
      deep_roon_mcp: version, newer_version: updateInfo() ?? undefined,
      core, enabled_in_roon: paired || 'not yet: Roon › Settings › Extensions › Enable next to "Deep Roon MCP"',
      internal_protocol: internal ? (checks ? (checks.every((c) => c.ok) ? 'works' : 'partly broken — see self_test') : 'not tested yet') : 'switched off (only the official API)',
      self_test: checks ?? undefined,
    };
  }));
}
