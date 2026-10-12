// The official extension API (node-roon-api, websocket on 9330): Deep Roon MCP appears in Roon under Settings →
// Extensions, and the user enables it there once. That's the moment of consent — the internal protocol (session.ts) only
// opens once it's paired, though technically it wouldn't need to. Through it: the zones as Roon's own API knows them
// (state, volume) and changing the volume.
//
// The pairing token stays in the user's own configuration folder (pairing.json, readable only by the user).
//
// Roon keeps one connection per extension: a second copy of Deep Roon MCP (Claude Desktop's chat and a Claude Code
// session, or another client) takes it over and the first is removed (RoonServer_log: "removing [apiclient …]"). Two
// copies that reconnect by themselves then push each other out for ever — measured 12 Oct 2026, every 5, 15, 60, 300 s,
// and a question that came in between was told to enable the extension. So after a close there is no reconnect of its
// own: the connection opens again when a tool needs it, and whoever asks has it.
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
let zonesIn = false;                  // the first "Subscribed" came in
let zoneWaiting: (() => void)[] = [];
let roon: any = null;                 // eslint-disable-line @typescript-eslint/no-explicit-any
let core: Target | null = null;
let open = false;                     // a websocket to the Core is open (or opening)

/** Connects to the Core's extension API once at the start (so Deep Roon MCP shows up in Roon to be enabled); later
 *  only on demand (paired()). */
export function startOfficial(target: Target): void {
  if (started) return;
  started = true;
  core = target;
  roon = new RoonApi({
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
        if (cmd === 'Subscribed') {
          zones.clear(); for (const z of data.zones ?? []) zones.set(z.zone_id, z);
          zonesIn = true; const w = zoneWaiting; zoneWaiting = []; for (const f of w) f();
        }
        else if (cmd === 'Changed') {
          for (const z of data.zones_added ?? []) zones.set(z.zone_id, z);
          for (const z of data.zones_changed ?? []) zones.set(z.zone_id, z);
          for (const id of data.zones_removed ?? []) zones.delete(id);
          for (const s of data.zones_seek_changed ?? []) { const z = zones.get(s.zone_id); if (z?.now_playing) z.now_playing.seek_position = s.seek_position; }
        }
      });
      const w = waiting; waiting = []; for (const f of w) f();
    },
    core_unpaired() { transport = null; zones.clear(); zonesIn = false; log('unpaired from the Core'); },
  });
  roon.init_services({ required_services: [RoonApiTransport] });
  connect();
}
function connect(): void {
  if (open || !roon || !core) return;
  open = true;
  roon.ws_connect({
    host: core.host, port: core.port,
    onclose: () => {
      open = false; transport = null; zones.clear(); zonesIn = false;
      log('the extension connection closed (another copy of Deep Roon MCP may have taken it over) — it opens again when a tool needs it');
    },
  });
}

/** The paired transport, waiting up to `ms` for it — else what the user has to do. */
export async function paired(ms = 8000): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (transport) return transport;
  connect();
  await new Promise<void>((resolve) => { waiting.push(resolve); setTimeout(resolve, ms).unref(); });
  if (transport) return transport;
  throw new RoonError('Deep Roon MCP isn\'t enabled in Roon yet: open Roon › Settings › Extensions and click Enable next to "Deep Roon MCP" — once.', 'unavailable');
}

export const officialZones = (): OfficialZone[] => [...zones.values()];
export const isPaired = (): boolean => !!transport;

/** Paired, and the zones in (they come a moment after the pairing): what the volume and the state need. */
export async function officialReady(ms = 4000): Promise<void> {
  await paired();
  if (zonesIn) return;
  await new Promise<void>((resolve) => { zoneWaiting.push(resolve); setTimeout(resolve, ms).unref(); });
}

/** A zone by (part of) its name, as the official API knows it. */
export function officialZone(name: string): OfficialZone | undefined {
  const want = name.toLowerCase(), all = officialZones();
  return all.find((z) => z.display_name.toLowerCase() === want) ?? all.find((z) => z.display_name.toLowerCase().split(' + ').includes(want))
    ?? all.find((z) => z.display_name.toLowerCase().includes(want));
}

/** Absolute volume on every output of a zone that has one, in that zone's own scale; or mute / unmute. */
export async function setVolume(name: string, change: { value?: number; mute?: boolean }) {
  const t = await paired();
  await officialReady();
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
