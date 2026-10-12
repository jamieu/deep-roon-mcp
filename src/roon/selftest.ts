// The self-test: a few reads through the internal protocol, each one standing for a group of tools. Read-only.
import type { Check } from '../core/status';
import * as lib from './library';

async function timed(name: string, affects: string, f: () => Promise<string | undefined>): Promise<Check> {
  const t0 = Date.now();
  try { const detail = await f(); return { name, ok: true, ms: Date.now() - t0, detail, affects }; }
  catch (e) { return { name, ok: false, ms: Date.now() - t0, detail: (e as Error).message, affects }; }
}

export async function runSelfTest(): Promise<Check[]> {
  const out: Check[] = [];
  let albumKey: string | undefined;
  out.push(await timed('search', 'roon_search and everything that starts from a key', async () => {
    const r = await lib.search('Miles Davis', 5, 'album');
    albumKey = (r.rows[0] as { key?: string } | undefined)?.key;
    if (!r.rows.length) throw new Error('no results for a search that always has some');
    return `${r.rows.length} albums`;
  }));
  out.push(await timed('album page', 'roon_album, roon_review, roon_versions, roon_similar', async () => {
    if (!albumKey) throw new Error('no album to open (search failed)');
    const a = await lib.album(albumKey, false);
    if (!a.tracks?.length) throw new Error('an album without tracks');
    return `${a.tracks.length} tracks`;
  }));
  out.push(await timed('streaming shelf', 'roon_new, roon_genres, roon_artist, roon_tidal_playlists', async () => {
    try { const s = await lib.section('new', 1, 0); return `${s.total ?? '?'} new albums at ${s.service}`; }
    catch (e) { if (/Neither Qobuz nor TIDAL/i.test((e as Error).message)) return 'no Qobuz or TIDAL signed in on this Core (not an error)'; throw e; }
  }));
  return out;
}
