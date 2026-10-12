// TIDAL's playlists in Roon: its editorial shelves, genre and mood pages, and the user's own TIDAL mixes. They are
// ordinary Roon playlists (Playlist::GetItems and Transport::PlayPlaylist take them — measured 12 Oct 2026), but they
// aren't in Roon's list of playlists: a key is remembered with the shelf it came from, to find it again later.
import { withCore, RoonError } from '../core/session';
import { Any, C, clean, duration, field, obj, strings } from './graph';
import { shelf, streaming, tidalPick, tidalStruct } from './library';

export const PLAYLIST_SHELVES: Record<string, string> = {
  new: 'GetNewPlaylists', recommended: 'GetRecommendedPlaylists', exclusive: 'GetExclusivePlaylists', masters: 'GetMastersPlaylists',
  popular: 'GetPopularPlaylists', essential: 'GetEssentialPlaylists', hires_classics: 'GetHiResHeadphoneClassicsPlaylists',
  recently_updated: 'GetRecentlyUpdatedPlaylists', forgotten_favorites: 'GetForgottenFavoritePlaylists',
  my_mixes: 'GetDailyMixes', history_mixes: 'GetHistoryMixes',
};
type Where = { shelf: string; genre?: string; mood?: string; offset: number; count: number };
const seen = new Map<string, Where>();

export const playlistKey = (p: Any) => { const id = field(p, 'PlaylistId'); return Buffer.isBuffer(id) ? id.toString('hex') : String(id ?? ''); };

async function fetch(c: C, w: Where): Promise<Any[]> {
  const { o } = streaming(c, 'tidal');
  if (w.genre) {
    const g = await tidalPick(c, o, 'GetGenres', w.genre);
    const r = await shelf(c, 'tidal', o, 'GetGenrePlaylists', 'Playlist', w.offset, w.count, { types: [{ type: 'TidalGenre', name: 'genre' }], args: tidalStruct(c, 'TidalGenre', g) });
    return Object.assign(r.items, { total: r.total });
  }
  if (w.mood) {
    const m = await tidalPick(c, o, 'GetMoods', w.mood);
    const r = await shelf(c, 'tidal', o, 'GetMoodPlaylists', 'Playlist', w.offset, w.count, { types: [{ type: 'TidalMood', name: 'mood' }], args: tidalStruct(c, 'TidalMood', m) });
    return Object.assign(r.items, { total: r.total });
  }
  const method = PLAYLIST_SHELVES[w.shelf];
  if (!method) throw new RoonError(`TIDAL has no playlist shelf "${w.shelf}"; choose from ${Object.keys(PLAYLIST_SHELVES).join(', ')}`, 'invalid');
  const r = await shelf(c, 'tidal', o, method, 'Playlist', w.offset, w.count);
  return Object.assign(r.items, { total: r.total });
}

export async function playlists(shelfName: string, genre: string | undefined, mood: string | undefined, limit: number, offset: number) {
  return withCore(async (c) => {
    const w: Where = { shelf: genre ? 'genre' : mood ? 'mood' : shelfName, genre, mood, offset: Math.max(0, offset), count: Math.min(Math.max(1, limit), 100) };
    const list = await fetch(c, w);
    const rows = list.map((p) => {
      const key = playlistKey(p); seen.set(key, w);
      const r: Any = { key, name: String(field(p, 'Name') ?? '').trim() };
      const d = field(p, 'Description'); if (d) r.description = clean(d).replace(/\s+/g, ' ').trim().slice(0, 240);
      const n = field(p, 'TrackCount') ?? field(p, 'ItemCount'); if (typeof n === 'number') r.tracks = n;
      const l = field(p, 'LengthSeconds'); if (typeof l === 'number') r.length = duration(l);
      const a = strings(c, field(p, 'SampleArtistNames')); if (a.length) r.artists = a.slice(0, 5);
      return r;
    });
    return { service: 'TIDAL', shelf: genre || mood ? undefined : shelfName, genre, mood, total: (list as Any).total ?? undefined, offset: w.offset, rows };
  });
}

/** A TIDAL playlist by its key: in the graph if this connection saw it, else fetched again from the shelf it came from. */
export async function findPlaylist(c: C, key: string): Promise<Any | null> {
  const here = [...c.graph.objects.values()].find((o) => /\.Playlist$/.test(o.typeName) && playlistKey(o) === key && field(o, 'Name') !== undefined);
  if (here) return here;
  const w = seen.get(key);
  if (!w) return null;
  return (await fetch(c, w)).map((p) => obj(c, p)).find((p) => playlistKey(p) === key) ?? null;
}
