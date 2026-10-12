// Running a tool: its answer as JSON text, or an error the model can act on — never a stack trace.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RoonError } from '../core/session';
import { log } from '../core/log';

/** Drops undefined values, so answers stay short. */
const compact = (_k: string, v: unknown) => (v === undefined ? undefined : typeof v === 'bigint' ? v.toString() : v);

export async function run(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await work();
    return { content: [{ type: 'text', text: JSON.stringify(result, compact) }] };
  } catch (e) {
    const err = e as Error;
    let text: string;
    if (err instanceof RoonError) text = err.message;
    else if (/MissingMethod|method not found|unknown method/i.test(err.message)) {
      // The internal protocol changes with Roon's versions: say so plainly.
      text = `Roon changed this part of its internal protocol in this version (${err.message}). Check for an update of Deep Roon MCP.`;
    } else text = `Roon didn't answer as expected: ${err.message}`;
    log(`tool error: ${err.message}`);
    return { isError: true, content: [{ type: 'text', text }] };
  }
}
