// Finding the Roon Core, and what it is.
//
// SOOD (after node-roon-api/sood.js): one UDP datagram to the multicast group 239.255.90.90:9003 and to the broadcast
// address, asking for Roon's service id; every Core answers the sender with its name, version and ports. That only works
// on the local network — over a VPN (Tailscale and the like) set ROON_HOST instead.
//
// Then the Core's id, from the extension API's registry (websocket on 9330, MOO/1, no pairing needed): the internal
// protocol (9332) wants it as the "server broker id" in its handshake.
import dgram from 'dgram';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';

const ROON_SERVICE_ID = '00720724-5143-4a9b-abac-0e50cba674bb';
const SOOD_PORT = 9003;

export interface FoundCore {
  host: string;
  /** the extension API's port, normally 9330 */
  port: number;
  name?: string;
  version?: string;
}

function soodQuery(): Buffer {
  const parts: Buffer[] = [Buffer.from('SOOD'), Buffer.from([2, 'Q'.charCodeAt(0)])];
  const property = (name: string, value: string) => {
    const n = Buffer.from(name), v = Buffer.from(value);
    parts.push(Buffer.from([n.length]), n, Buffer.from([v.length >> 8, v.length & 0xff]), v);
  };
  property('query_service_id', ROON_SERVICE_ID);
  property('_tid', randomUUID());
  return Buffer.concat(parts);
}

function soodReply(b: Buffer): Record<string, string | null> | null {
  if (b.length < 6 || b.toString('latin1', 0, 4) !== 'SOOD' || b[4] !== 2 || b[5] !== 'R'.charCodeAt(0)) return null;
  const props: Record<string, string | null> = {};
  let i = 6;
  while (i < b.length) {
    const nl = b[i]; i += 1;
    if (i + nl + 2 > b.length) return null;
    const name = b.toString('utf8', i, i + nl); i += nl;
    const vl = (b[i] << 8) | b[i + 1]; i += 2;
    if (vl === 0xffff) { props[name] = null; continue; }
    if (i + vl > b.length) return null;
    props[name] = b.toString('utf8', i, i + vl); i += vl;
  }
  return props;
}

/** Asks the local network which Roon Cores there are, and collects the answers for `ms`. */
export function findCores(ms = 2500): Promise<FoundCore[]> {
  return new Promise((resolve) => {
    const found = new Map<string, FoundCore>();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = () => { try { socket.close(); } catch { /* closed already */ } resolve([...found.values()]); };
    socket.on('error', done);
    socket.on('message', (msg, from) => {
      const p = soodReply(msg);
      if (!p || p.service_id !== ROON_SERVICE_ID) return;
      const id = p.unique_id ?? from.address;
      found.set(id, { host: from.address, port: Number(p.http_port ?? 9330) || 9330, name: p.name ?? undefined, version: p.display_version ?? undefined });
    });
    socket.bind(0, () => {
      try { socket.setBroadcast(true); socket.setMulticastTTL(1); } catch { /* not on every system */ }
      const q = soodQuery();
      for (const target of ['239.255.90.90', '255.255.255.255']) socket.send(q, SOOD_PORT, target, () => {});
      setTimeout(done, ms);
    });
  });
}

export interface CoreInfo {
  /** the Core's id as the registry gives it, e.g. "3f2a…-…" */
  coreId: string;
  name: string;
  version: string;
}

/** The registry's info: `com.roonlabs.registry:1/info` over the extension API's websocket (MOO/1). */
export function coreInfo(host: string, port = 9330, ms = 5000): Promise<CoreInfo> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}/api`);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error(`no answer from the Roon Core at ${host}:${port}`)); }, ms);
    const finish = (err: Error | null, info?: CoreInfo) => { clearTimeout(timer); try { ws.close(); } catch { /* closed */ } err ? reject(err) : resolve(info!); };
    ws.on('open', () => ws.send(Buffer.from('MOO/1 REQUEST com.roonlabs.registry:1/info\nRequest-Id: 0\n\n')));
    ws.on('message', (data: WebSocket.RawData) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      const split = text.indexOf('\n\n');
      const header = split >= 0 ? text.slice(0, split) : text;
      if (!/^MOO\/1 COMPLETE Success/.test(header) || !/^Request-Id: 0$/m.test(header)) return;
      try {
        const body = JSON.parse(text.slice(split + 2));
        if (!body.core_id) return finish(new Error('the Roon Core gave no core_id'));
        finish(null, { coreId: String(body.core_id), name: String(body.display_name ?? 'Roon Core'), version: String(body.display_version ?? '') });
      } catch (e) { finish(e as Error); }
    });
    ws.on('error', (e: Error) => finish(new Error(`can't reach the Roon Core at ${host}:${port} (${e.message})`)));
  });
}

/** The core_id as the internal protocol's handshake wants it: .NET byte order (Guid.ToByteArray — the first three
 *  groups reversed). Written as is, the Core refuses (0x81). */
export function brokerId(coreId: string): Buffer {
  const hex = coreId.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`not a Roon core_id: ${coreId}`);
  const b = Buffer.from(hex, 'hex');
  return Buffer.concat([Buffer.from(b.subarray(0, 4)).reverse(), Buffer.from(b.subarray(4, 6)).reverse(), Buffer.from(b.subarray(6, 8)).reverse(), b.subarray(8)]);
}
