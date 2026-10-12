// Search, Qobuz's shelves and genres, an album's page, reviews, biographies and discographies — read-only.
import { isRef } from '../intern';
import { Arg, buildArgs } from '../intern/proto/serializer';
import { BinaryReader } from '../intern/proto/reader';
import { BinaryWriter } from '../intern/proto/writer';
import { withCore, RoonError } from '../core/session';
import { Any, C, albumRow, clean, dateText, duration, field, flag, items, obj, partialList, refList, resultRow, short, strings, untilField, untilLoaded, wait } from './graph';

const qobuz = (c: C) => {
  const q = c.graph.findByType('Qobuz')[0];
  if (!q) throw new RoonError('This Roon Core has no Qobuz service (Qobuz isn\'t signed in?)', 'unavailable');
  return q;
};

export async function search(query: string, limit: number, kind?: 'album' | 'track' | 'artist') {
  return withCore(async (c) => {
    const n = Math.min(Math.max(1, limit), 100);
    // The results come as top hits, artists, composers, albums, tracks: a long artist list fills the limit before the
    // tracks' turn ("long long long beatles" → a hundred artists). With a kind, ask wide and filter here.
    const res = await c.search(query, kind ? 400 : n, false);
    let rows = res.map((o) => resultRow(c, o));
    if (kind) rows = rows.filter((r: Any) => r.kind === kind).slice(0, n);
    return { query, rows };
  });
}

export const SECTIONS: Record<string, string> = {
  new: 'GetNewAlbums', qobuzissimes: 'GetQobuzissimesAlbums', press_awards: 'GetPressAwardsAlbums', top: 'GetTopAlbums',
  trending: 'GetStillTrendingAlbums', ideal_discography: 'GetIdealDiscographyAlbums',
};

export async function section(name: string, limit: number, offset: number, genres: string[] = []) {
  const method = SECTIONS[name];
  if (!method) throw new RoonError(`Unknown section; choose from ${Object.keys(SECTIONS).join(', ')}`, 'invalid');
  return withCore(async (c) => {
    const q = qobuz(c);
    const res = await c.call('Qobuz', method,
      [{ type: 'int', name: 'offset' }, { type: 'int', name: 'count' }, { type: 'IList<string>', name: 'filter_genre_ids' }, { type: 'ResultCallback<PartialList<AlbumLite>>', name: 'cb_result' }],
      buildArgs([Arg.int(Math.max(0, offset)), Arg.int(Math.min(Math.max(1, limit), 100)), Arg.collection(genres.map((g) => buildArgs([Arg.str(g)])))]), q.oid);
    if (!res.success) throw new RoonError(`Qobuz::${method}: ${res.status}`);
    const list = partialList(c, c.graph.decodeReturnValue(Uint8Array.from(res.payload)));
    await untilLoaded(c, list.items);
    return { section: name, genre: genres.length ? genres : undefined, total: list.total, offset,
             rows: list.items.map((x) => obj(c, x)).filter(Boolean).map((o) => albumRow(c, o)) };
  });
}

/** Qobuz's genres (Qobuz::GetGenres): a list of structs {Name, GenreId} by value — the length, the count, and per item a
 *  marker (1 = by value), a type number, a length and the members as (index, text) up to a 0. */
export async function genres(parent?: string) {
  return withCore(async (c) => {
    const q = qobuz(c);
    const res = await c.call('Qobuz', 'GetGenres', [{ type: 'string', name: 'parentGenreId' }, { type: 'ResultCallback<IList<QobuzGenre>>', name: 'cb_result' }],
      buildArgs([Arg.str(parent || null)]), q.oid);
    if (!res.success) throw new RoonError(`Qobuz::GetGenres: ${res.status}`);
    const rows: { id: string; name?: string }[] = [];
    if (res.payload.length > 2) {
      const r = new BinaryReader(Uint8Array.from(res.payload)); r.integer(); const n = r.flexInt();
      for (let i = 0; i < n && r.remaining > 0; i++) {
        r.flexInt(); r.flexInt(); const len = r.flexInt(); const m = new BinaryReader(r.bytes(len)); const g: Any = {};
        for (;;) { const idx = m.remaining > 0 ? m.flexInt() : 0; if (!idx) break; const t = m.string(); if (idx === 1) g.name = t; else if (idx === 2) g.id = t; }
        if (g.id) rows.push({ id: g.id, name: g.name });
      }
    }
    return { parent: parent || undefined, genres: rows };
  });
}

const library = (c: C) => c.serviceOid('Library');

/** The album for a key: from the graph if it's there, else fetched from the Core again. A Qobuz album that's also in the
 *  library comes back as the library album (its key may differ). */
export async function findAlbum(c: C, key: string): Promise<Any> {
  const inGraph = [...c.graph.objects.values()].find((o) => /\.Album(Lite)?$/.test(o.typeName) && String(field(o, 'AlbumId') ?? '') === key && field(o, 'Title') !== undefined);
  if (inGraph) return inGraph;
  if (!/^\d+$/.test(key)) throw new RoonError('An album key is a number', 'invalid');
  const res = await short(c.call('Library', 'GetAlbumLite', [{ type: 'long', name: 'albumid' }, { type: 'ResultCallback<AlbumLite>', name: 'cb_result' }], buildArgs([Arg.long(BigInt(key))]), library(c)));
  const v = res?.success && res.payload.length ? c.graph.decodeReturnValue(Uint8Array.from(res.payload)) : null;
  if (isRef(v)) { await untilLoaded(c, [v], 2000); const o = c.graph.getObject(v.$ref); if (o && field(o, 'Title') !== undefined) return o; }
  throw new RoonError(`Roon knows no album with key ${key}`, 'not_found');
}

/** The tracks for a list of keys, in that order; an unknown key gives an error naming it. */
export async function findTracks(c: C, keys: string[]): Promise<Any[]> {
  const look = () => { const all = [...c.graph.objects.values()].filter((o) => /\.Track(Lite)?$/.test(o.typeName) && field(o, 'Title') !== undefined); return keys.map((k) => all.find((o) => String(field(o, 'TrackId') ?? '') === k)); };
  let tracks = look();
  const missing = keys.filter((_, i) => !tracks[i]);
  if (missing.length) {
    if (missing.some((k) => !/^\d+$/.test(k))) throw new RoonError('A track key is a number', 'invalid');
    const res = await short(c.call('Library', 'GetTrackLites', [{ type: 'IEnumerable<long>', name: 'trackids' }, { type: 'ResultCallback<IList<TrackLite>>', name: 'cb_result' }],
      buildArgs([Arg.collection(missing.map((k) => buildArgs([Arg.long(BigInt(k))])))]), library(c)));
    if (res?.success) await untilLoaded(c, refList(res.payload).map((oid) => ({ $ref: oid })), 2500);
    tracks = look();
  }
  const gone = keys.filter((_, i) => !tracks[i]);
  if (gone.length) throw new RoonError(`Roon doesn't know ${gone.length} of the ${keys.length} tracks (keys ${gone.join(', ')})`, 'not_found');
  return tracks;
}

/** The full album (Library::GetAlbum, also for a Qobuz album outside the library), or null. */
export async function fullAlbum(c: C, al: Any): Promise<Any> {
  const res = await short(c.call('Library', 'GetAlbum', [{ type: 'AlbumBase', name: 'album' }, { type: 'ResultCallback<Album>', name: 'cb_result' }], buildArgs([Arg.ref(al.oid)]), library(c)), 6000);
  return res?.success && res.payload.length ? c.graph.decodeReturnValue(Uint8Array.from(res.payload)) : null;
}

const CREDIT_KIND: Record<number, string> = { 1: 'composition', 2: 'conductor', 3: 'main artist', 4: 'performance', 5: 'ensemble', 6: 'production' };

/** An album's page: the album, its facts, its main artists (with a key for the discography) and its tracks with keys. */
export async function album(key: string, withCredits: boolean) {
  return withCore(async (c) => {
    const al = await findAlbum(c, key);
    // The tracks come after the full album; if that fails, the light list.
    let refs: bigint[] = [];
    const full = await fullAlbum(c, al);
    if (isRef(full)) {
      const end = Date.now() + 3500;
      while (Date.now() < end) {
        const list = obj(c, field(c.graph.getObject(full.$ref), 'Tracks'))?.fields?.$items ?? [];
        if (list.length && list.every((x: Any) => field(obj(c, x), 'Title') !== undefined)) { refs = list.map((x: Any) => x.$ref); break; }
        await wait(50);
      }
    }
    if (!refs.length) {
      const res = await short(c.call('Library', 'GetAlbumTrackLites', [{ type: 'AlbumBase', name: 'album' }, { type: 'ResultCallback<IList<TrackLite>>', name: 'cb_result' }], buildArgs([Arg.ref(al.oid)]), library(c)));
      if (!res?.success) throw new RoonError(`The tracks of this album don't come (${res?.status ?? 'no answer'})`);
      refs = refList(res.payload);
      await untilLoaded(c, refs.map((oid) => ({ $ref: oid })), 2500);
    }
    const raw = refs.map((oid) => c.graph.getObject(oid)).filter((t) => t && field(t, 'Title') !== undefined);
    const discs = new Set(raw.map((t) => field(t, 'MediaNumber') ?? 1)).size > 1;
    const formats = new Set(raw.map((t) => field(t, 'Format'))).size > 1;
    let seconds = 0;
    const tracks = raw.map((t) => {
      const r: Any = { key: String(field(t, 'TrackId') ?? '') };
      if (discs) r.disc = field(t, 'MediaNumber') ?? 1;
      const n = field(t, 'TrackNumber'); if (n != null) r.n = n;
      r.title = field(t, 'Title');
      const l = field(t, 'LengthSeconds'); if (typeof l === 'number') { r.length = duration(l); seconds += l; }
      if (formats && field(t, 'Format')) r.format = field(t, 'Format');
      if (flag(field(t, 'IsFavorite'))) r.favorite = true;
      return r;
    });
    const out: Any = { album: albumRow(c, al) };
    const main = items(c, field(al, 'MainPerformers')).filter((p) => field(p, 'Name'));
    if (main.length) out.artists = main.map((p) => ({ key: String(field(p, 'PerformerId') ?? ''), name: field(p, 'Name') }));
    if (seconds) out.length = duration(seconds);
    out.tracks = tracks;
    // The facts of the album page: labels and genres by value in the album, the rest on the full album.
    const A = isRef(full) ? c.graph.getObject(full.$ref) : null;
    const g = strings(c, field(al, 'Genres')); if (g.length) out.genres = g;
    const released = dateText(field(al, 'OriginalReleaseDate')), edition = dateText(field(al, 'ReleaseDate'));
    if (released) out.released = released; if (edition && edition !== released) out.this_release = edition;
    const version = field(al, 'Version'); if (typeof version === 'string' && version) out.version = version;
    for (const [k, name] of [['CatalogNumber', 'catalogue_number'], ['ProductCode', 'barcode'], ['Country', 'country']]) { const w = field(A, k); if (typeof w === 'string' && w) out[name] = w; }
    for (const [k, name] of [['IsLive', 'live'], ['IsCompilation', 'compilation'], ['IsPick', 'roon_pick']]) if (field(al, k) === true) out[name] = true;
    if (withCredits && A) {
      // Album.Credits: {Role, Performer, Type} — grouped by role, in Roon's order. Roon's own data, as Roon has it.
      const byRole = new Map<string, Any>();
      for (const cr of items(c, field(A, 'Credits'))) {
        const role = field(cr, 'Role'), name = field(obj(c, field(cr, 'Performer')), 'Name');
        if (!role || !name) continue;
        const e = byRole.get(role) ?? { role, category: CREDIT_KIND[field(cr, 'Type')] ?? undefined, names: [] };
        if (!e.names.includes(name)) e.names.push(name);
        byRole.set(role, e);
      }
      out.credits = [...byRole.values()];
    }
    return out;
  });
}

// ---- reviews and biographies ----
// The texts aren't in the album or artist themselves (Review and Biography stay empty): Roon fetches them with
// Library::GetLocalizedEntityText(Sooid? external id, long own id, kind, sources) → LocalizedDescriptionContainer.Blobs.
// The kinds ("review", "biography") and sources ("Rovi-albums:en", "Rovi-artists:en", "Wikipedia:en") are the ones Roon's
// own app asks for; without the external id the Core says InvalidArgument.
export interface Blob { source: string; author?: string; url?: string; text: string }
export async function entityText(c: C, external: Any, id: Any, kind: string, sources: string[]): Promise<Blob[]> {
  if (!Buffer.isBuffer(external)) return [];
  const args = Buffer.concat([new BinaryWriter().optionalSooid(external).toBuffer(), buildArgs([Arg.long(BigInt(id)), Arg.str(kind), Arg.collection(sources.map((s) => buildArgs([Arg.str(s)])))])]);
  const res = await short(c.call('Library', 'GetLocalizedEntityText',
    [{ type: 'Sooid?', name: 'sooid' }, { type: 'long', name: 'selfid' }, { type: 'string', name: 'blobtype' }, { type: 'IList<string>', name: 'sources' }, { type: 'ResultCallback<LocalizedDescriptionContainer>', name: 'cb' }],
    args, library(c)), 8000);
  if (!res?.success || !res.payload.length) return [];
  const container = obj(c, c.graph.decodeReturnValue(Uint8Array.from(res.payload)));
  return items(c, field(container, 'Blobs')).filter((b) => field(b, 'Text'))
    .map((b) => ({ source: /^rovi/i.test(String(field(b, 'Source'))) ? 'Roon (TiVo)' : String(field(b, 'Source') ?? ''), author: field(b, 'Author') ?? undefined, url: field(b, 'SourceUrl') ?? undefined, text: clean(field(b, 'Text')).trim() }));
}
const cut = (b: Blob, max: number) => {
  const r: Any = { source: b.source, author: b.author, url: b.url, length: b.text.length, text: b.text };
  if (b.text.length > max) { r.text = b.text.slice(0, max).replace(/\s+\S*$/, '') + ' …'; r.truncated = true; }
  return r;
};
/** Roon's own text (TiVo) first; Wikipedia when asked, or when there's nothing else. In full, unless a limit is asked. */
export const choose = (blobs: Blob[], max: number, wiki: boolean) => {
  const own = blobs.filter((b) => b.source !== 'Wikipedia'), w = blobs.filter((b) => b.source === 'Wikipedia');
  return [...own, ...(wiki || !own.length ? w : [])].map((b) => cut(b, max));
};

export async function review(key: string, max: number, wiki: boolean) {
  return withCore(async (c) => {
    const al = await findAlbum(c, key);
    const full = await fullAlbum(c, al);
    const external = isRef(full) ? await untilField(c, full.$ref, 'ExternalAlbumId') : undefined;
    const texts = choose(await entityText(c, external, field(al, 'AlbumId'), 'review', ['Rovi-albums:en', 'Wikipedia:en']), max, wiki);
    return { album: albumRow(c, al), texts, note: texts.length ? undefined : 'Roon has no review for this album.' };
  });
}

export async function performer(c: C, key: string): Promise<Any> {
  if (!/^\d+$/.test(key)) throw new RoonError('An artist key is a number', 'invalid');
  // The light artist by number first, then the full one by reference: GetPerformer(long) doesn't know an artist outside
  // the library (measured: The Kinks → refused at once).
  const light = await short(c.call('Library', 'GetPerformerLite', [{ type: 'long', name: 'performerid' }, { type: 'ResultCallback<PerformerLite>', name: 'cb_result' }], buildArgs([Arg.long(BigInt(key))]), library(c)));
  const lv = light?.success && light.payload.length ? c.graph.decodeReturnValue(Uint8Array.from(light.payload)) : null;
  if (!isRef(lv)) throw new RoonError(`Roon knows no artist with key ${key}`, 'not_found');
  return lv;
}

export async function bio(key: string, max: number, wiki: boolean) {
  return withCore(async (c) => {
    const lv = await performer(c, key);
    const res = await short(c.call('Library', 'GetPerformer', [{ type: 'PerformerBase', name: 'performer' }, { type: 'ResultCallback<Performer>', name: 'cb_result' }], buildArgs([Arg.ref(lv.$ref)]), library(c)), 5000);
    const v = res?.success && res.payload.length ? c.graph.decodeReturnValue(Uint8Array.from(res.payload)) : null;
    if (!isRef(v) || (await untilField(c, v.$ref, 'Name', 2000)) === undefined) throw new RoonError(`Roon knows no artist with key ${key}`, 'not_found');
    const external = await untilField(c, v.$ref, 'ExternalPerformerId');
    const texts = choose(await entityText(c, external, key, 'biography', ['Rovi-artists:en', 'Wikipedia:en']), max, wiki);
    const p = c.graph.getObject(v.$ref);
    const list = (name: string): Any[] => obj(c, field(p, name))?.fields?.$items ?? [];
    await untilLoaded(c, ['SimilarTo', 'Followed', 'Influenced', 'CollaboratorWith', 'IsAssociatedWith', 'MemberOf', 'Members'].flatMap((k) => list(k).slice(0, 12)).filter(isRef), 1500);
    const people = (...names: string[]) => {
      const out: { key?: string; name: string }[] = [];
      for (const n of names) for (const x of list(n)) { const o = obj(c, x); const name = field(o, 'Name'); if (name && !out.some((y) => y.name === name)) out.push({ key: String(field(o, 'PerformerId') ?? '') || undefined, name }); }
      return out.length ? out.slice(0, 12) : undefined;
    };
    const artist: Any = { key, name: field(p, 'Name') };
    const country = field(p, 'Country'); if (country) artist.country = country;
    const from = field(p, 'BirthPlace'); if (from) artist.from = from;
    const ya = field(p, 'YearsActive'); if (Buffer.isBuffer(ya) && ya.length >= 2) { const y = new BinaryReader(Uint8Array.from(ya)).flexInt() >>> 16; if (y > 1000 && y < 3000) artist.active_since = y; }
    const g = list('Genres').filter((x) => typeof x === 'string'); if (g.length) artist.genres = g;
    return { artist, texts, note: texts.length ? undefined : 'Roon has no biography for this artist.',
             similar: people('SimilarTo'), influenced_by: people('Followed'), influenced: people('Influenced'),
             worked_with: people('CollaboratorWith', 'IsAssociatedWith'), member_of: people('MemberOf'), members: people('Members') };
  });
}

/** The discography: an artist's main albums at Qobuz (Qobuz::GetPerformerMainAlbumLites), oldest first. */
export async function discography(key: string) {
  return withCore(async (c) => {
    const q = qobuz(c);
    const pv = await performer(c, key);
    const end = Date.now() + 1500; while (Date.now() < end && field(c.graph.getObject(pv.$ref), 'Name') === undefined) await wait(40);
    const p = c.graph.getObject(pv.$ref);
    if (!p || field(p, 'Name') === undefined) throw new RoonError(`Roon knows no artist with key ${key}`, 'not_found');
    const res = await c.call('Qobuz', 'GetPerformerMainAlbumLites', [{ type: 'long', name: 'performerid' }, { type: 'ResultCallback<IList<AlbumLite>>', name: 'cb_result' }], buildArgs([Arg.long(BigInt(key))]), q.oid);
    if (!res.success) throw new RoonError(`Qobuz::GetPerformerMainAlbumLites: ${res.status}`);
    const refs = refList(res.payload);
    await untilLoaded(c, refs.map((oid) => ({ $ref: oid })), 3000);
    const albums = refs.map((oid) => c.graph.getObject(oid)).filter((o) => o && field(o, 'Title') !== undefined).map((o) => albumRow(c, o))
      .map((r, i) => ({ r, i })).sort((a, b) => (a.r.year ?? 9999) - (b.r.year ?? 9999) || a.i - b.i).map((x) => x.r);
    const artist: Any = { key, name: field(p, 'Name') };
    const n = field(p, 'MainPerformerAlbumCount'); if (typeof n === 'number') artist.albums_in_library = n;
    const from = field(p, 'BirthPlace'); if (from) artist.from = from;
    return { artist, albums };
  });
}
