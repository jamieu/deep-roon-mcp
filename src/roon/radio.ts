// Roon's Live Radio (the Radio service): the user's own stations, the directory by category and genre, and playing a
// station (Transport::PlayChannel). Measured 13 Oct 2026: BrowseChannels wants its nullable count with a presence byte;
// a Genre is a category's name ("Jazz", not "jazz"); the top categories are Music, News & Talk, Sports, Locations.
import { isRef } from '../intern';
import { Arg, buildArgs } from '../intern/proto/serializer';
import { BinaryWriter } from '../intern/proto/writer';
import { withCore, RoonError } from '../core/session';
import { log } from '../core/log';
import { Any, C, field, imageKey, items, obj, untilLoaded, wait } from './graph';
import { findZone } from './zones';
import { started } from './control';

const hex = (v: Any) => (Buffer.isBuffer(v) ? v.toString('hex') : '');
const decoded = (c: C, payload: Buffer) => (payload.length ? c.graph.decodeReturnValue(Uint8Array.from(payload)) : null);
const radioOid = (c: C) => c.serviceOid('Radio');

function stationRow(c: C, o: Any): Any {
  const r: Any = { key: hex(field(o, 'ChannelId')), name: field(o, 'Name') ?? '' };
  const loc = field(o, 'Location'); if (loc) r.location = loc;
  const d = field(o, 'Description'); if (d) r.description = String(d).slice(0, 200);
  if (field(o, 'IsInLibrary') === true) r.in_library = true;
  const img = imageKey(c, o); if (img) r.image = img;
  return r;
}
const categoryRow = (c: C, o: Any) => ({ key: hex(field(o, 'CategoryId')), name: field(o, 'Name') ?? '' });

/** RadioBrowseCriteria: a category (by key), a genre (a category's name), or nothing (the top). */
function criteria(c: C, category?: string, genre?: string): Buffer {
  const members: { name: string; propType: number; value: Buffer }[] = [];
  if (category) {
    const cat = c.structArg('Sooloos.Broker.Api.RadioCategory', [{ name: 'System.Sooid Sooloos.Broker.Api.RadioCategory::CategoryId', propType: 4, value: new BinaryWriter().sooid(Buffer.from(category, 'hex')).toBuffer() }]);
    members.push({ name: 'Sooloos.Broker.Api.RadioCategory Sooloos.Broker.Api.RadioBrowseCriteria::Category', propType: 23, value: cat });
  }
  if (genre) members.push({ name: 'string Sooloos.Broker.Api.RadioBrowseCriteria::Genre', propType: 20, value: new BinaryWriter().string(genre).toBuffer() });
  return c.structArg('Sooloos.Broker.Api.RadioBrowseCriteria', members);
}

/** The user's own stations (Radio::ChannelQuery, in the library). */
async function myStations(c: C): Promise<Any[]> {
  const crit = c.structArg('Sooloos.Broker.Api.ChannelQueryCriteria', [{ name: 'bool Sooloos.Broker.Api.ChannelQueryCriteria::RequireInLibrary', propType: 2, value: new BinaryWriter().boolean(true).toBuffer() }]);
  const res = await c.call('Radio', 'ChannelQuery', [{ type: 'Sooid', name: 'profileid' }, { type: 'ChannelQueryCriteria', name: 'criteria' }, { type: 'ResultCallback<Query<Channel>>', name: 'cb_result' }], Buffer.concat([buildArgs([Arg.sooid(c.profile())]), crit]), radioOid(c));
  if (!res.success) throw new RoonError(`Roon refused the radio stations (${res.status})`);
  const v = decoded(c, res.payload);
  const end = Date.now() + 3000; let list: Any[] = [];
  while (Date.now() < end) {
    list = ((isRef(v) ? (c.graph.getObject(v.$ref) as Any)?.fields?.$items : null) ?? []) as Any[];
    if (!list.length || list.every((x) => field(obj(c, x), 'Name') !== undefined)) break;
    await wait(60);
  }
  return list.map((x) => obj(c, x)).filter(Boolean);
}

/** The directory: categories under a category (or the top), and the stations in it (or of a genre). */
export async function radio(category?: string, genre?: string, limit = 40) {
  return withCore(async (c) => {
    const out: Any = {};
    if (!category && !genre) out.my_stations = (await myStations(c)).map((o) => stationRow(c, o));
    const crit = criteria(c, category, genre);
    if (!genre) {
      const res = await c.call('Radio', 'BrowseCategories', [{ type: 'Sooid', name: 'profileid' }, { type: 'RadioBrowseCriteria', name: 'criterid' }, { type: 'ResultCallback<DataList<RadioCategory>>', name: 'cb_result' }], Buffer.concat([buildArgs([Arg.sooid(c.profile())]), crit]), radioOid(c));
      if (!res.success) throw new RoonError(`Roon refused the radio categories (${res.status})`);
      const cats = items(c, decoded(c, res.payload));
      await untilLoaded(c, cats.map((x) => ({ $ref: x.oid })), 2500);
      out.categories = cats.map((x) => categoryRow(c, x));
    }
    if (category || genre) {
      const n = Math.min(Math.max(1, limit), 100);
      const res = await c.call('Radio', 'BrowseChannels', [{ type: 'Sooid', name: 'profileid' }, { type: 'RadioBrowseCriteria', name: 'criteria' }, { type: 'int?', name: 'count' }, { type: 'ResultCallback<DataList<Channel>>', name: 'cb_result' }],
        Buffer.concat([buildArgs([Arg.sooid(c.profile())]), crit, Buffer.from([1]), new BinaryWriter().integer(n).toBuffer()]), radioOid(c));
      if (!res.success) throw new RoonError(`Roon refused the radio stations (${res.status})`);
      const chs = items(c, decoded(c, res.payload));
      await untilLoaded(c, chs.map((x) => ({ $ref: x.oid })), 3500);
      out.stations = chs.map((x) => stationRow(c, x));
    }
    return out;
  });
}

/** A station by key (Radio::GetChannel) or, for the user's own, by name. */
async function findStation(c: C, key: string): Promise<Any> {
  if (/^[0-9a-f]{20,}$/i.test(key)) {
    const res = await c.call('Radio', 'GetChannel', [{ type: 'Sooid', name: 'channelid' }, { type: 'ResultCallback<Channel>', name: 'cb_result' }], buildArgs([Arg.sooid(Buffer.from(key, 'hex'))]), radioOid(c));
    const v = res.success ? decoded(c, res.payload) : null;
    if (isRef(v)) { await untilLoaded(c, [v], 2500); const o = c.graph.getObject(v.$ref); if (o && field(o, 'Name') !== undefined) return o; }
    throw new RoonError('Roon knows no station with that key', 'not_found');
  }
  const mine = await myStations(c);
  const want = key.toLowerCase();
  const o = mine.find((x) => String(field(x, 'Name') ?? '').toLowerCase() === want) ?? mine.find((x) => String(field(x, 'Name') ?? '').toLowerCase().includes(want));
  if (!o) throw new RoonError(`No station called "${key}" among your own; give a key from roon_radio`, 'not_found');
  return o;
}

/** Play a station on a zone (Transport::PlayChannel), and say whether the zone started. */
export async function playRadio(key: string, zoneName: string) {
  const r = await withCore(async (c) => {
    const st = await findStation(c, key);
    const z = findZone(c, zoneName);
    const res = await c.call('Transport', 'PlayChannel', [{ type: 'Zone', name: 'zone' }, { type: 'Sooid', name: 'profileid' }, { type: 'Channel', name: 'channel' }, { type: 'ResultCallback<PlayFeedback>', name: 'cb_result' }],
      buildArgs([Arg.ref(z.oid), Arg.sooid(c.profile()), Arg.ref(st.oid)]), c.serviceOid('Transport'));
    log(`play_radio: ${field(st, 'Name')} on ${z.name} → ${res.success ? 'ok' : res.status}`);
    if (!res.success) throw new RoonError(`Roon refused to play the station (${res.status})`);
    return { zone: z.name, station: field(st, 'Name') };
  });
  return { ok: true, ...r, ...(await started(r.zone, 0)) };
}
