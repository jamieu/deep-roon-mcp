// The official extension API (node-roon-api, websocket on 9330): Deep Roon MCP appears in Roon under Settings →
// Extensions, and the user enables it there once. That's the moment of consent — the internal protocol (session.ts) only
// opens once it's paired, though technically it wouldn't need to. Through it: the zones as Roon's own API knows them
// (state, volume) and changing the volume.
//
// The pairing token stays in the user's own configuration folder (pairing.json, readable only by the user).
import fs from 'fs';
import os from 'os';
import path from 'path';
import RoonApi from 'node-roon-api';
import RoonApiTransport from 'node-roon-api-transport';
import { version } from '../../package.json';
import { log } from './log';
import { RoonError, Target } from './errors';

function configDir(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'deep-roon-mcp');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'deep-roon-mcp');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'deep-roon-mcp');
}
const STATE_FILE = path.join(configDir(), 'pairing.json');
const readState = (): Record<string, unknown> => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } };
const writeState = (s: unknown) => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
};

export interface OfficialZone {
  zone_id: string; display_name: string; state: string;
  outputs: { output_id: string; display_name: string; volume?: { type: string; min: number; max: number; value: number; step: number; is_muted: boolean } }[];
  now_playing?: { image_key?: string; seek_position?: number; one_line?: { line1: string }; three_line?: { line1: string; line2?: string; line3?: string } };
}

let transport: any = null;   // eslint-disable-line @typescript-eslint/no-explicit-any
const zones = new Map<string, OfficialZone>();
let started = false;
let waiting: (() => void)[] = [];

/** Connects to the Core's extension API and keeps the connection (back off 5 s, 15 s, 60 s, then every 5 minutes). */
export function startOfficial(target: Target): void {
  if (started) return;
  started = true;
  const roon = new RoonApi({
    extension_id: 'nl.renebouwmeester.deep-roon-mcp',
    display_name: 'Deep Roon MCP',
    display_version: version,
    publisher: 'René Bouwmeester',
    email: 'https://github.com/renebouwmeester/deep-roon-mcp/issues',
    website: 'https://github.com/renebouwmeester/deep-roon-mcp',
    log_level: 'none',
    get_persisted_state: readState,
    set_persisted_state: writeState,
    core_paired(core: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      transport = core.services.RoonApiTransport ?? Object.entries(core.services ?? {}).find(([k]) => k.startsWith('RoonApiTransport'))?.[1];
      if (!transport) { log('paired, but the Core offers no transport service'); return; }
      log(`paired with ${core.display_name} (Roon › Settings › Extensions)`);
      transport.subscribe_zones((cmd: string, data: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (cmd === 'Subscribed') { zones.clear(); for (const z of data.zones ?? []) zones.set(z.zone_id, z); }
        else if (cmd === 'Changed') {
          for (const z of data.zones_added ?? []) zones.set(z.zone_id, z);
          for (const z of data.zones_changed ?? []) zones.set(z.zone_id, z);
          for (const id of data.zones_removed ?? []) zones.delete(id);
          for (const s of data.zones_seek_changed ?? []) { const z = zones.get(s.zone_id); if (z?.now_playing) z.now_playing.seek_position = s.seek_position; }
        }
      });
      const w = waiting; waiting = []; for (const f of w) f();
    },
    core_unpaired() { transport = null; zones.clear(); log('unpaired from the Core'); },
  });
  roon.init_services({ required_services: [RoonApiTransport] });
  let tries = 0;
  const connect = () => {
    roon.ws_connect({
      host: target.host, port: target.port,
      onclose: () => {
        transport = null; zones.clear();
        const delay = [5, 15, 60][tries] ?? 300; tries += 1;
        setTimeout(connect, delay * 1000).unref();
      },
    });
  };
  connect();
}

/** The paired transport, waiting up to `ms` for it — else what the user has to do. */
export async function paired(ms = 8000): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (transport) return transport;
  await new Promise<void>((resolve) => { waiting.push(resolve); setTimeout(resolve, ms).unref(); });
  if (transport) return transport;
  throw new RoonError('Deep Roon MCP isn\'t enabled in Roon yet: open Roon › Settings › Extensions and click Enable next to "Deep Roon MCP" — once.', 'unavailable');
}

export const officialZones = (): OfficialZone[] => [...zones.values()];

/** A zone by (part of) its name, as the official API knows it. */
export function officialZone(name: string): OfficialZone | undefined {
  const want = name.toLowerCase(), all = officialZones();
  return all.find((z) => z.display_name.toLowerCase() === want) ?? all.find((z) => z.display_name.toLowerCase().split(' + ').includes(want))
    ?? all.find((z) => z.display_name.toLowerCase().includes(want));
}

/** Absolute volume on every output of a zone that has one, in that zone's own scale; or mute / unmute. */
export async function setVolume(name: string, change: { value?: number; mute?: boolean }) {
  const t = await paired();
  const z = officialZone(name);
  if (!z) throw new RoonError(`No Roon zone called "${name}"; Roon has: ${officialZones().map((x) => x.display_name).join(', ')}`, 'not_found');
  const outs = z.outputs.filter((o) => o.volume);
  if (!outs.length) throw new RoonError(`${z.display_name} has a fixed volume (Roon can't change it)`, 'invalid');
  const call = (fn: (cb: (err: unknown) => void) => void) => new Promise<void>((res, rej) => fn((err) => (err ? rej(new RoonError(`Roon refused: ${err}`)) : res())));
  for (const o of outs) {
    if (change.value !== undefined) {
      const v = o.volume!;
      if (v.type === 'incremental') throw new RoonError(`${o.display_name} only steps its volume up or down (no level)`, 'invalid');
      const value = Math.max(v.min, Math.min(v.max, change.value));
      await call((cb) => t.change_volume(o.output_id, 'absolute', value, cb));
    }
    if (change.mute !== undefined) await call((cb) => t.mute(o.output_id, change.mute ? 'mute' : 'unmute', cb));
  }
  return { zone: z.display_name, outputs: outs.map((o) => ({ output: o.display_name, scale: `${o.volume!.min}–${o.volume!.max}` })), volume: change.value, muted: change.mute };
}
