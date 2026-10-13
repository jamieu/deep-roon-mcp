// Roon's Home: Daily Picks, New releases for you, and the Daily Mixes (and playing one).
import { isRef } from '../intern';
import { Arg, buildArgs } from '../intern/proto/serializer';
import { BinaryWriter } from '../intern/proto/writer';
import { withCore, RoonError } from '../core/session';
import { log } from '../core/log';
import { Any, C, albumRow, clean, field, imageKey, imageKeys, items, obj, resultRow, strings, untilLoaded } from './graph';
import { toplevelGenres } from './focus';
import { findZone } from './zones';
import { How, PRIORITY, playParams, started } from './control';

/** Local time as Roon's own app sends it (the day decides which picks and mixes apply). */
const localNow = () => { const d = new Date(), t = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())}T${t(d.getHours())}:${t(d.getMinutes())}:${t(d.getSeconds())}`; };
const decoded = (c: C, payload: Buffer) => (payload.length ? c.graph.decodeReturnValue(Uint8Array.from(payload)) : null);

/** Daily Picks: GetDailyPicks(Sooid, DailyPicksParameters {LocalTime, OverrideCache, …}) — the signature of current Cores,
 *  read from Roon's own client. OverrideCache stays off: only read what there is today. */
export async function dailyPicks(perBox: number) {
  return withCore(async (c) => {
    const DP = 'Sooloos.Broker.Api.DailyPicksParameters';
    const params = c.structArg(DP, [{ name: `string ${DP}::LocalTime`, propType: 20, value: new BinaryWriter().string(localNow()).toBuffer() },
                                    { name: `bool ${DP}::OverrideCache`, propType: 2, value: new BinaryWriter().boolean(false).toBuffer() }]);
    const res = await c.call('Library', 'GetDailyPicks', [{ type: 'Sooid', name: 'profileid' }, { type: 'DailyPicksParameters', name: 'parameters' }, { type: 'ResultCallback<DataList<DailyPicksBox>>', name: 'cb_result' }],
      Buffer.concat([buildArgs([Arg.sooid(c.profile())]), params]), c.serviceOid('Library'));
    if (!res.success) throw new RoonError(`Roon refused the Daily Picks (${res.status})`);
    const boxes = items(c, decoded(c, res.payload));
    const things = (b: Any): Any[] => { for (const k of ['DisplayAlbums', 'Albums', 'Tracks', 'Performers']) { const l = obj(c, field(b, k))?.fields?.$items ?? []; if (l.length) return l; } return []; };
    await untilLoaded(c, boxes.flatMap((b) => [...things(b).slice(0, perBox), field(b, 'SeedAlbum'), field(b, 'SeedPerformer')]).filter(isRef), 3500);
    return {
      day: field(boxes[0], 'GeneratedForDate') ?? undefined,
      boxes: boxes.map((b) => {
        const all = things(b).map((x) => obj(c, x)).filter((o) => o && (field(o, 'Title') !== undefined || field(o, 'Name') !== undefined));
        const r: Any = { kind: field(b, 'OneBoxType') ?? undefined, reason: field(b, 'Reason') ?? undefined, total: all.length, rows: all.slice(0, perBox).map((o) => resultRow(c, o)) };
        const sa = obj(c, field(b, 'SeedAlbum')); if (sa && field(sa, 'Title') !== undefined) r.because_you_played = albumRow(c, sa);
        const sp = obj(c, field(b, 'SeedPerformer')); if (!r.because_you_played && sp && field(sp, 'Name') !== undefined) r.because_you_played = field(sp, 'Name');
        return r;
      }),
    };
  });
}

/** "New releases for you": a list of AlbumWithExtras {Album, Review {Text, Author}}. */
export async function newForYou(limit: number, offset: number, genre?: string) {
  return withCore(async (c) => {
    const res = await c.call('Library', 'GetNewReleasesForYou', [{ type: 'Sooid', name: 'profileid' }, { type: 'ResultCallback<DataList<AlbumWithExtras>>', name: 'cb_result' }], buildArgs([Arg.sooid(c.profile())]), c.serviceOid('Library'));
    if (!res.success) throw new RoonError(`Roon refused New releases for you (${res.status})`);
    let all = items(c, decoded(c, res.payload));
    // The shelf's top-level genres with their album counts (13 Oct 2026): what a genre filter on this shelf can choose from.
    await untilLoaded(c, all.map((x) => field(x, 'Album')).filter(isRef), 4000);
    const top = await toplevelGenres(c);
    const counts = new Map<string, number>();
    for (const x of all) for (const n of new Set(strings(c, field(obj(c, field(x, 'Album')), 'Genres')))) if (top.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
    const genres = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, albums]) => ({ name, albums }));
    if (genre) {
      // A genre filter (13 Oct 2026): keep the albums whose genres name it — the albums come first, then the filter.
      const g = genre.toLowerCase();
      const names = (x: Any) => strings(c, field(obj(c, field(x, 'Album')), 'Genres')).map((n) => n.toLowerCase());
      const exact = all.filter((x) => names(x).includes(g));
      all = exact.length ? exact : all.filter((x) => names(x).some((n) => n.includes(g)));
    }
    const part = all.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(Math.max(1, limit), 100));
    await untilLoaded(c, part.map((x) => field(x, 'Album')).filter(isRef), 3000);
    return { total: all.length, offset: Math.max(0, offset), genres, rows: part.map((x) => {
      const a = obj(c, field(x, 'Album')); if (!a || field(a, 'Title') === undefined) return null;
      const r: Any = albumRow(c, a); const t = field(obj(c, field(x, 'Review')), 'Text');
      if (t) r.review = clean(t).replace(/\s+/g, ' ').slice(0, 320);
      return r;
    }).filter(Boolean) };
  });
}

/** The Daily Mixes: per mix the artist or genre it's built around, with a few touchstones. The key is the MixId. */
const mixKey = (m: Any) => { const id = field(m, 'MixId'); return Buffer.isBuffer(id) ? id.subarray(2).toString('utf8') : String(id ?? ''); };
const mixName = (c: C, m: Any) => field(obj(c, field(m, 'PerformerMixDescription')), 'PerformerName') ?? field(obj(c, field(m, 'GenreMixDescription')), 'GenreName') ?? '';
async function readMixes(c: C): Promise<Any[]> {
  const res = await c.call('Library', 'GetMixes', [{ type: 'Sooid', name: 'profileid' }, { type: 'string', name: 'localtime' }, { type: 'ResultCallback<DataList<Mix>>', name: 'cb_result' }],
    buildArgs([Arg.sooid(c.profile()), Arg.str(localNow())]), c.serviceOid('Library'));
  if (!res.success) throw new RoonError(`Roon refused the Daily Mixes (${res.status})`);
  return items(c, decoded(c, res.payload));
}
export async function mixes() {
  return withCore(async (c) => ({ mixes: (await readMixes(c)).map((m) => {
    const pd = obj(c, field(m, 'PerformerMixDescription')), gd = obj(c, field(m, 'GenreMixDescription'));
    const r: Any = { key: mixKey(m), kind: gd && field(gd, 'GenreName') ? 'genre' : 'artist', name: mixName(c, m) };
    const ts = (obj(c, field(pd ?? gd, 'Touchstones'))?.fields?.$items ?? []).filter((x: Any) => typeof x === 'string').map(clean).slice(0, 8);
    if (ts.length) r.touchstones = ts;
    // The picture of a mix (13 Oct 2026): the artist's photo (or avatar) for an artist mix, the genre's images for a genre mix.
    const img = pd ? (imageKey(c, pd, 'Photo') ?? imageKey(c, pd, 'Avatar')) : undefined; if (img) r.image = img;
    const imgs = gd ? imageKeys(c, gd) : []; if (imgs.length) r.images = imgs;
    return r;
  }) }));
}
/** Playing a Daily Mix (Transport::PlayMix, from the start). */
export async function playMix(key: string, zoneName: string, how: How) {
  const p = PRIORITY[how];
  const r = await withCore(async (c) => {
    const z = findZone(c, zoneName);
    const all = await readMixes(c);
    const m = all.find((x) => mixKey(x) === key) ?? all.find((x) => String(mixName(c, x)).toLowerCase() === key.toLowerCase());
    if (!m?.oid) throw new RoonError('Unknown mix — read roon_mixes for today\'s keys', 'not_found');
    const args = Buffer.concat([buildArgs([Arg.ref(z.oid), Arg.sooid(c.profile())]), playParams(c, p), buildArgs([Arg.ref(m.oid), Arg.int(0)])]);
    const res = await c.call('Transport', 'PlayMix',
      [{ type: 'Zone', name: 'zone' }, { type: 'Sooid', name: 'profileid' }, { type: 'PlayParameters', name: 'parameters' }, { type: 'Mix', name: 'mix' }, { type: 'int', name: 'from_index' },
       { type: 'ResultCallback<PlayFeedback>', name: 'cb_result' }], args, c.serviceOid('Transport'));
    log(`play_mix (${how}): ${mixName(c, m)} on ${z.name} → ${res.success ? 'ok' : res.status}`);
    if (!res.success) throw new RoonError(`Roon refused to play the mix (${res.status})`);
    return { zone: z.name, how, name: mixName(c, m) };
  });
  return { ok: true, ...r, ...(await started(r.zone, p)) };
}
