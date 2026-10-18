// Running a tool: its answer as JSON text, or an error the model can act on — never a stack trace.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RoonError } from '../core/session';
import { log } from '../core/log';
import { updateNotice } from '../core/status';
import { coreWeb } from '../core/official';

/** A ready-to-load cover URL next to every image key (0.4.8, a forum tester: "how would I render the artwork from
 *  the Deep Roon image reference?"). Roon has two kinds of keys on the same port: the official API's (32+ hex, from the
 *  zone feed) at /api/image/<key>, and the internal library's (e.g. "doicaaaa") at /image/<key>.jpg — not
 *  interchangeable. `image` → `image_url`, `images` → `image_urls`; an `image_url` that is already there (a radio
 *  logo) stays. */
function withImageUrls(v: unknown, base: string): unknown {
  if (Array.isArray(v)) return v.map((x) => withImageUrls(x, base));
  if (!v || typeof v !== 'object') return v;
  const url = (k: string) => (/^[0-9a-f]{32,}$/.test(k) ? `${base}/api/image/${k}?scale=fit&width=600&height=600` : `${base}/image/${k}.jpg`);
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = withImageUrls(x, base);
  if (typeof o.image === 'string' && o.image && o.image_url === undefined) o.image_url = url(o.image);
  if (Array.isArray(o.images) && o.image_urls === undefined) o.image_urls = (o.images as unknown[]).filter((k): k is string => typeof k === 'string').map(url);
  return o;
}

/** Drops undefined values, so answers stay short. */
const compact = (_k: string, v: unknown) => (v === undefined ? undefined : typeof v === 'bigint' ? v.toString() : v);

export async function run(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const base = coreWeb();
    const result = base ? withImageUrls(await work(), base) : await work();
    const notice = updateNotice();
    return { content: [{ type: 'text', text: JSON.stringify(result, compact) }, ...(notice ? [{ type: 'text' as const, text: notice }] : [])] };
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

/** A tool whose answer is an image, with its details as text beside it (not every client shows images). */
export async function runImage(work: () => Promise<{ info: unknown; image: { data: string; mimeType: string } }>): Promise<CallToolResult> {
  let image: { data: string; mimeType: string } | null = null;
  const r = await run(async () => { const x = await work(); image = x.image; return x.info; });
  if (r.isError || !image) return r;
  const { data, mimeType } = image as { data: string; mimeType: string };
  return { content: [...r.content, { type: 'image', data, mimeType }] };
}
