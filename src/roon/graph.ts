// Reading Roon's object graph: the fields of an object, references, Roon's own text markup and date formats, and the
// rows the tools return (albums, artists, tracks).
import { isRef, RoonClient, RoonObject } from '../intern';
import { BinaryReader } from '../intern/proto/reader';

export type C = RoonClient;
// The graph is untyped: objects carry `fields` keyed "Type::Name".
export type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A field by its short name (the graph keys them "Type::Name"). */
export function field(o: Any, name: string): Any {
  if (!o) return undefined;
  const f = o.fields || o;
  for (const [k, v] of Object.entries(f)) if (k.endsWith('::' + name)) return v;
  return undefined;
}
/** A reference resolved to its object (or the value itself). */
export const obj = (c: C, v: Any): Any => (isRef(v) ? c.graph.getObject(v.$ref) : v);
/** Roon's markup "[[123|Name]]" and "[Name](123)" → Name. */
export const clean = (s: Any): string => String(s ?? '').replace(/\[\[\d+\/?\|([^\]]*)\]\]/g, '$1').replace(/\[([^\]\[]+)\]\(\d+\)/g, '$1');
export const typeOf = (o: RoonObject | Any): string => String(o?.typeName || '').split('.').pop() ?? '';
/** The items of a list object (DataList) in the graph, resolved. */
export const items = (c: C, v: Any): Any[] => (obj(c, v)?.fields?.$items ?? []).map((x: Any) => obj(c, x)).filter(Boolean);
/** A list of strings: a DataList<string> as an object in the graph, or by value inside another object. */
export const strings = (c: C, v: Any): string[] => { const o = obj(c, v); return (o?.fields?.$items ?? o?.$items ?? []).filter((x: Any) => typeof x === 'string'); };
/** IsFavorite and IsListenLater are per profile: a count, then the profiles. 00 = nobody. */
export const flag = (v: Any): boolean => v === true || (Buffer.isBuffer(v) && v.length > 1 && v[0] >= 1);

/** The image key of an object's picture (the Core serves it on :9330/api/image/<key>). */
/** The keys of an object's image list (Playlist/Work/GenreMixDescription `Images`): up to `max`, for a cover mosaic (13 Oct 2026). */
export function imageKeys(c: C, o: Any, name = 'Images', max = 4): string[] {
  return items(c, field(o, name)).map((im) => { const m = /^broker:\/\/\/image\/([^.]+)\./.exec(String(field(im, 'Url') ?? '')); return m ? m[1] : ''; }).filter(Boolean).slice(0, max);
}
/** The plain https pictures of an object's image list (TIDAL playlists: resources.tidal.com), up to `max`. */
export function imageUrls(c: C, o: Any, name = 'Images', max = 4): string[] {
  return items(c, field(o, name)).map((im) => String(field(im, 'Url') ?? '')).filter((u) => /^https?:\/\//.test(u)).slice(0, max);
}
export function imageKey(c: C, o: Any, name = 'Image'): string | undefined {
  const url = field(obj(c, field(o, name)), 'Url');
  const m = /^broker:\/\/\/image\/([^.]+)\./.exec(String(url ?? ''));
  return m ? m[1] : undefined;
}

/** Roon's date is one number: (year << 16) | (month << 8) | day; month and day may be 0. */
function dateParts(v: Any): [number, number, number] | undefined {
  if (!Buffer.isBuffer(v) || v.length < 2) return undefined;
  const n = new BinaryReader(Uint8Array.from(v)).flexInt();
  const y = n >>> 16, m = (n >>> 8) & 0xff, d = n & 0xff;
  return y > 1000 && y < 3000 ? [y, m, d] : undefined;
}
export const yearOf = (v: Any): number | undefined => dateParts(v)?.[0];
/** "1972", "1972-10" or "2008-11-11". */
export function dateText(v: Any): string | undefined {
  const p = dateParts(v); if (!p) return undefined;
  const [y, m, d] = p, t = (x: number) => String(x).padStart(2, '0');
  return m >= 1 && m <= 12 ? (d >= 1 && d <= 31 ? `${y}-${t(m)}-${t(d)}` : `${y}-${t(m)}`) : String(y);
}
/** .NET DateTime.ToBinary: the lower 62 bits are ticks of 100 ns since year 1. */
export function dotnetDate(v: Any): string | undefined {
  try { const t = BigInt(v) & 0x3FFFFFFFFFFFFFFFn; return new Date(Number((t - 621355968000000000n) / 10000n)).toISOString(); } catch { return undefined; }
}

/** An answer IList<T> of objects: the length in bytes, the count, and an object reference per item. */
export function refList(payload: Buffer | Uint8Array | undefined): bigint[] {
  if (!payload || payload.length < 2) return [];
  const r = new BinaryReader(Uint8Array.from(payload)); r.integer(); const n = r.flexInt(); const refs: bigint[] = [];
  for (let i = 0; i < n && r.remaining > 0; i++) refs.push(BigInt(r.flexLong()));
  return refs;
}
/** A PartialList<T>: TotalCount and Items — a length list: flexInt(count), then an object reference per item. */
export function partialList(c: C, value: Any): { total: number | null; items: Any[] } {
  const root = obj(c, value);
  let list = field(root, 'Items');
  if (isRef(list)) list = c.graph.getObject(list.$ref)?.fields?.$items;
  if (Buffer.isBuffer(list)) {
    const r = new BinaryReader(Uint8Array.from(list)); const n = r.flexInt(); const out: Any[] = [];
    for (let i = 0; i < n && r.remaining > 0; i++) out.push({ $ref: r.flexLong() });
    list = out;
  }
  return { total: field(root, 'TotalCount') ?? null, items: Array.isArray(list) ? list : [] };
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until the objects of a list are in the graph (they arrive after the answer), at most `ms`. */
export async function untilLoaded(c: C, refs: Any[], ms = 2500): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (refs.every((x) => { if (!isRef(x)) return true; const o = c.graph.getObject(x.$ref); return field(o, 'Title') !== undefined || field(o, 'Name') !== undefined; })) return;
    await wait(40);
  }
}
/** Waits for a field that arrives after the object itself, at most `ms`. */
export async function untilField(c: C, oid: Any, name: string, ms = 3000): Promise<Any> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = field(c.graph.getObject(oid), name); if (v !== undefined) return v; await wait(50); }
  return undefined;
}
/** A question by id: for an unknown id the Core doesn't answer, and the request only times out after 15 s (measured).
 *  At most `ms` here; after that it counts as "unknown". */
export function short<T>(p: Promise<T>, ms = 4000): Promise<T | null> {
  return Promise.race([p.catch(() => null), wait(ms).then(() => null)]);
}

/** "3:07" or "1:02:45". */
export function duration(seconds: number): string {
  const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
/** An ISO time in this computer's time zone: "2026-10-12 21:30". */
export function localTime(iso: string | number | undefined): string | undefined {
  if (iso === undefined || iso === null) return undefined;
  const d = new Date(iso); if (isNaN(d.getTime())) return undefined;
  const t = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${t(d.getMonth() + 1)}-${t(d.getDate())} ${t(d.getHours())}:${t(d.getMinutes())}`;
}

export type Source = 'library' | 'Qobuz' | 'TIDAL' | 'streaming';
/** Where an album or track comes from: ContentSource (MediaSource: Local = 1, TIDAL = 128, Qobuz = 256) — also for a
 *  streaming album that's in the library, whose Source is then Local (measured 12 Oct 2026). */
export function sourceOf(...os: Any[]): Source | undefined {
  for (const o of os) {
    const v = field(o, 'ContentSource') ?? field(o, 'Source');
    if (v === 128) return 'TIDAL';
    if (v === 256) return 'Qobuz';
    if (v === 1) return 'library';
  }
  return undefined;
}
export interface AlbumRow {
  kind: 'album'; key: string; title: string; artist: string; format?: string; year?: number; stars?: number; label?: string;
  source: Source; in_library?: boolean; favorite?: boolean; listen_later?: boolean; popularity?: number; image?: string; genres?: string[];
}
export function albumRow(c: C, o: Any): AlbumRow {
  const fm = obj(c, field(o, 'AlbumFormat'));
  const r: AlbumRow = { kind: 'album', key: String(field(o, 'AlbumId') ?? ''), title: field(o, 'Title') ?? '', artist: clean(field(o, 'PerformedBy')), source: sourceOf(o) ?? (field(fm, 'IsStreaming') === true ? 'streaming' : 'library') };
  const f = field(fm, 'FormatString'); if (f) r.format = f;
  const y = yearOf(field(o, 'OriginalReleaseDate')) ?? yearOf(field(o, 'ReleaseDate')); if (y) r.year = y;
  const st = field(o, 'Rating'); if (typeof st === 'number' && st > 0) r.stars = st / 2;   // Roon's rating 1–10 = half stars
  const lb = strings(c, field(o, 'Labels')); if (lb.length) r.label = lb.join(' / ');
  const gs = strings(c, field(o, 'Genres')); if (gs.length) r.genres = gs.slice(0, 8);   // Roon's genres of the album (top-level and sub-genres mixed), for a genre filter on a shelf (13 Oct 2026)
  if (field(o, 'Source') === 1) r.in_library = true;    // Source: Local = 1 — in the library, also a streaming album
  if (flag(field(o, 'IsFavorite'))) r.favorite = true;
  if (flag(field(o, 'IsListenLater'))) r.listen_later = true;
  const p = field(o, 'Popularity'); if (typeof p === 'number') r.popularity = Math.round(p * 100) / 100;
  // The cover's image key (12 Oct 2026, for clients that draw): the Core serves these graph keys at
  // http://<core>:9330/image/<key>.jpg, or scaled at /image/<key>.<px>.jpg (measured: .300.jpg → 300 px, 32 kB).
  const img = imageKey(c, o); if (img) r.image = img;
  return r;
}
export function resultRow(c: C, o: Any): Any {
  const t = typeOf(o);
  if (t === 'AlbumLite' || t === 'Album') return albumRow(c, o);
  if (t === 'PerformerLite' || t === 'Performer') {
    const r: Any = { kind: 'artist', key: String(field(o, 'PerformerId') ?? ''), name: field(o, 'Name') ?? '' };
    const n = field(o, 'MainPerformerAlbumCount'); if (typeof n === 'number' && n > 0) r.albums_in_library = n;
    const img = imageKey(c, o, 'Photo') ?? imageKey(c, o, 'Avatar'); if (img) r.image = img;   // a Performer has Photo and Avatar, not Image
    return r;
  }
  if (t === 'TrackLite' || t === 'Track') {
    const al = obj(c, field(o, 'Album'));
    const r: Any = { kind: 'track', key: String(field(o, 'TrackId') ?? ''), title: field(o, 'Title') ?? '', artist: clean(field(al, 'PerformedBy') ?? field(o, 'PerformedBy') ?? '') };
    const album = field(al, 'Title'); if (album) r.album = album;
    const ak = field(al, 'AlbumId'); if (ak !== undefined && ak !== null) r.album_key = String(ak);
    const f = field(o, 'Format'); if (f) r.format = f;
    const l = field(o, 'LengthSeconds'); if (typeof l === 'number') r.length = duration(l);
    r.source = sourceOf(o, al) ?? 'library';
    const img = imageKey(c, al) ?? imageKey(c, o); if (img) r.image = img;
    return r;
  }
  return { kind: t, title: field(o, 'Title') ?? field(o, 'Name') ?? '' };
}
