// The connection with the Core over the internal protocol, as Roon Labs asked in the forum: short-lived — opened for a
// question, closed after two minutes of quiet —, one at a time, and the questions one after another. While open, the
// client sends a PING every 10 s (the Core drops a silent session after 30–35 s; see src/intern).
//
// Objects are only valid within one connection; the ids (AlbumId, TrackId, PerformerId) aren't — an id from an earlier
// connection is fetched from the Core again (see roon/library.ts).
import { RoonClient } from '../intern';
import { brokerId, coreInfo, findCores } from './discover';
import { RoonError, Target } from './errors';
import { paired, startOfficial } from './official';
import { log } from './log';

export { RoonError } from './errors';

const IDLE_MS = 120_000;
const INTERNAL_PORT = 9332;

let target: Target | null = null;
let client: RoonClient | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Runs once, after the first connection (the self-test, set by index.ts). */
let onFirstConnect: (() => Promise<void>) | null = null;
export function afterFirstConnect(f: () => Promise<void>): void { onFirstConnect = f; }
/** What's known now, without connecting. */
export const knownTarget = (): Target | null => target;

/** The Core: ROON_HOST ("host" or "host:port", the extension API's port) or the local network. */
let finding: Promise<Target> | null = null;
export function findTarget(): Promise<Target> {
  if (target) return Promise.resolve(target);
  // One search at a time: the start of the server and the first tool may ask together.
  finding ??= locate().finally(() => { finding = null; });
  return finding;
}
async function locate(): Promise<Target> {
  const configured = process.env.ROON_HOST?.trim();
  let host: string, port: number;
  if (configured) {
    const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(configured);
    host = m?.[1] ?? configured; port = Number(m?.[2] ?? 9330);
  } else {
    const cores = await findCores();
    if (!cores.length) {
      // macOS 15 and later: an app needs the user's permission for the local network, and Claude Desktop runs this with its
      // own Node — without it the search finds nothing, silently (12 Oct, René's Mac: Claude asked, he allowed, found).
      const mac = process.platform === 'darwin' ? ' On a Mac, check System Settings › Privacy & Security › Local Network: the app that runs Deep Roon MCP must be allowed (for Claude Desktop: Claude and Claude Helper).' : '';
      throw new RoonError(`No Roon Core found on this network.${mac} On another network (a VPN, Tailscale), set ROON_HOST to the Core's address.`, 'unavailable');
    }
    if (cores.length > 1) log(`found ${cores.length} Roon Cores (${cores.map((c) => c.name ?? c.host).join(', ')}) — using ${cores[0].name ?? cores[0].host}; set ROON_HOST to choose`);
    host = cores[0].host; port = cores[0].port;
  }
  const info = await coreInfo(host, port);
  target = { host, port, info };
  log(`Roon Core: ${info.name} ${info.version} at ${host}`);
  startOfficial(target);
  return target;
}

function close(reason: string): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  // Clear `client` first: closing fires onclosed at once, and that must not read as the Core closing it.
  const c = client; client = null;
  if (c) { try { c.close(); } catch { /* closed */ } log(`connection closed (${reason})`); }
}

async function open(): Promise<RoonClient> {
  if (client) return client;
  const t = await findTarget();
  // The user's consent first: the extension enabled in Roon (see official.ts).
  await paired();
  const c = new RoonClient({ host: t.host, port: INTERNAL_PORT, serverBrokerId: brokerId(t.info.coreId), settleMs: 1500 });
  c.conn.onclosed = () => { try { c.remoting.failPending('broker connection closed'); } catch { /* nothing pending */ } if (client === c) { client = null; log('connection closed by the Core'); } };
  const t0 = Date.now();
  try { await c.connect(); }
  catch (e) { target = null; throw new RoonError(`Can't connect to Roon's internal protocol at ${t.host}:${INTERNAL_PORT} (${(e as Error).message})`, 'unavailable'); }
  client = c;
  log(`connected to the Core in ${Date.now() - t0} ms — ${c.graph.objects.size} objects`);
  if (onFirstConnect) { const f = onFirstConnect; onFirstConnect = null; setTimeout(() => { f().catch(() => {}); }, 0); }
  return c;
}

/** One question to the Core: queued, with the open connection or a new one; then the idle clock starts again. */
export function withCore<T>(work: (c: RoonClient) => Promise<T>): Promise<T> {
  const task = queue.then(async () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    try { return await work(await open()); }
    catch (e) {
      // A question Roon can't answer (an unknown key, a bad argument) leaves the connection fine; anything else may not.
      if (!(e instanceof RoonError && (e.kind === 'not_found' || e.kind === 'invalid'))) close('after an error');
      throw e;
    }
    finally { if (client) idleTimer = setTimeout(() => close('two minutes quiet'), IDLE_MS); }
  });
  queue = task.catch(() => {});
  return task;
}

/** A fresh connection inside withCore (the play history wants a graph without earlier plays). */
export async function fresh(): Promise<RoonClient> {
  close('a fresh graph');
  return open();
}

/** Close after this question (the history leaves its plays in the graph). */
export function closeSoon(reason: string): void { close(reason); }

export function shutdown(): void { close('shutting down'); }
