// Roon's zones as the internal protocol knows them, and what plays in each.
import { isRef } from '../intern';
import { withCore, RoonError } from '../core/session';
import { Any, C, clean, dotnetDate, duration, field, items, localTime, obj } from './graph';

/** The outputs there are now: per name only the current one. A Squeezebox player that reconnects leaves its old output
 *  in the graph; prefer an output whose zone has a track, then one that plays or pauses, then the newest. */
export function currentEndpoints(c: C): Any[] {
  const score = (e: Any) => {
    const z = obj(c, field(e, 'Zone'));
    const hasTrack = items(c, field(obj(c, field(z, 'NowPlaying')), 'Tracks')).length > 0;
    const state = field(z, 'State') ?? 0;     // 0 playing, 1 loading, 2 paused, 3 stopped
    return (hasTrack ? 4 : 0) + (state !== 3 ? 2 : 0);
  };
  const byName = new Map<string, Any>();
  for (const e of c.graph.findByType('Endpoint')) {
    const n = field(e, 'Name'); if (typeof n !== 'string') continue;
    const was = byName.get(n);
    if (!was) { byName.set(n, e); continue; }
    const a = score(e), b = score(was);
    if (a > b || (a === b && Number(e.oid) > Number(was.oid))) byName.set(n, e);
  }
  return [...byName.values()];
}

/** The name per zone: its output, or for a group the outputs together ("Kitchen + Living Room"). */
export function zoneNames(c: C): Map<string, string> {
  const per = new Map<string, string[]>();
  for (const e of currentEndpoints(c)) { const z = field(e, 'Zone'), n = field(e, 'Name'); if (isRef(z) && typeof n === 'string') per.set(String(z.$ref), [...(per.get(String(z.$ref)) ?? []), n]); }
  return new Map([...per].map(([k, v]) => [k, v.join(' + ')]));
}

/** A zone by (part of) its name. */
export function findZone(c: C, name: string): { name: string; oid: bigint } {
  const zones = [...zoneNames(c)].map(([oid, n]) => ({ name: n, oid: BigInt(oid) }));
  const want = String(name).toLowerCase();
  const z = zones.find((x) => x.name.toLowerCase() === want) ?? zones.find((x) => x.name.toLowerCase().split(' + ').includes(want)) ?? zones.find((x) => x.name.toLowerCase().includes(want));
  if (!z) throw new RoonError(`No Roon zone called "${name}"; Roon has: ${zones.map((x) => x.name).join(', ')}`, 'not_found');
  return z;
}

export async function zones() {
  return withCore(async (c) => {
    const names = zoneNames(c);
    return { zones: [...new Set(currentEndpoints(c).map((e) => field(e, 'Name')).filter((n) => typeof n === 'string'))].sort(),
             groups: [...names.values()].filter((n) => n.includes(' + ')).map((n) => n.split(' + ')) };
  });
}

const STATE: Record<number, string> = { 0: 'playing', 1: 'loading', 2: 'paused', 3: 'stopped' };   // ZoneState; an absent field is 0
const REPEAT: Record<number, string> = { 1: 'all', 2: 'one' };                                      // LoopMode: Disabled, Loop, LoopOne

/** What plays per zone: state, track, album, artist, format, position. */
export async function nowPlaying() {
  return withCore(async (c) => {
    const names = zoneNames(c);
    // Only zones with an output: after a transfer the old zone objects stay in the graph.
    const out = c.graph.findByType('Zone').filter((z) => names.has(String(z.oid))).map((z) => {
      const r: Any = { zone: names.get(String(z.oid)), state: STATE[field(z, 'State') ?? 0] ?? String(field(z, 'State')) };
      if (field(z, 'Shuffle') === true) r.shuffle = true;
      const loop = REPEAT[field(z, 'Loop') ?? 0]; if (loop) r.repeat = loop;
      if (field(z, 'AutoSwim') === true) r.roon_radio = true;
      if (field(z, 'IsSleepTimerEnabled') === true) r.sleep_timer = { minutes: field(z, 'SleepTimerDurationMinutes') ?? undefined, until: localTime(dotnetDate(field(z, 'SleepTimerExpiration'))) };
      if (r.state === 'stopped') return r;            // what still "stands" in a stopped zone is old news
      const np = obj(c, field(z, 'NowPlaying'));
      const tr = obj(c, field(items(c, field(np, 'Tracks'))[0], 'Track'));
      if (tr && field(tr, 'Title')) {
        const al = obj(c, field(tr, 'Album'));
        r.title = field(tr, 'Title'); r.artist = clean(field(al, 'PerformedBy')); r.album = field(al, 'Title');
        const f = field(tr, 'Format'); if (f) r.format = f;
        const l = field(tr, 'LengthSeconds'); if (typeof l === 'number') r.length = duration(l);
      } else {
        // A stream through Roon's audio input (another app feeding Roon) or a radio station: no track in the graph.
        r.line = 'a stream Roon receives from elsewhere (no track details)';
      }
      const pos = field(z, 'SeekPosition'); if (typeof pos === 'number') r.position = duration(pos);
      const left = field(obj(c, field(z, 'Queue')), 'TrackCountRemaining'); if (typeof left === 'number') r.tracks_left_in_queue = left;
      return r;
    });
    return { zones: out };
  });
}
