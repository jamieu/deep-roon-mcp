// Roon's own play history (Library::VirtualHistoryQuery, through src/intern/history-export) and the top lists counted
// over all of it. The export wants a graph without earlier plays: a fresh connection, closed again afterwards.
import { exportPlayHistory } from '../intern';
import { withCore, fresh, closeSoon } from '../core/session';
import { clean, localTime } from './graph';

export async function history(limit: number) {
  return withCore(async (first) => {
    const c = first.graph.findByType('HistoryPlay').length > 0 ? await fresh() : first;
    const out = await exportPlayHistory(c, { limit: Math.min(Math.max(0, limit), 500) });
    closeSoon('after the history');
    return {
      total: out.total ?? null,
      plays: out.events.map((e) => ({ at: localTime(e.playedAt), title: e.title, artist: clean(e.artist), album: e.album ?? undefined, played_pct: e.completionPct ?? undefined,
                                      track_key: e.roonTrackId ?? undefined })),   // for roon_play_tracks (13 Oct 2026, Rosso's history)
    };
  });
}

/** Most played albums, artists or tracks over the whole history; a play counts when at least half was heard. */
export async function top(what: 'albums' | 'artists' | 'tracks', limit: number, since?: string) {
  return withCore(async (first) => {
    const c = first.graph.findByType('HistoryPlay').length > 0 ? await fresh() : first;
    const out = await exportPlayHistory(c, { limit: 20000, timeoutMs: 8000 });
    closeSoon('after the history');
    const from = since ? Date.parse(since) : null;
    const count = new Map<string, { plays: number; last: number; title?: string; album?: string; artist: string }>();
    let counted = 0, earliest: number | null = null;
    for (const e of out.events) {
      const at = Date.parse(e.playedAt);
      if (from && at < from) continue;
      if (typeof e.completionPct === 'number' && e.completionPct < 50) continue;
      counted += 1; if (earliest === null || at < earliest) earliest = at;
      const artist = clean(e.artist);
      const key = what === 'artists' ? artist : what === 'tracks' ? `${e.title}\u0000${artist}` : `${e.album ?? '?'}\u0000${artist}`;
      const r = count.get(key) ?? { plays: 0, last: 0, title: what === 'tracks' ? e.title : undefined, album: what === 'albums' ? e.album ?? undefined : undefined, artist };
      r.plays += 1; if (at > r.last) r.last = at;
      count.set(key, r);
    }
    const rows = [...count.values()].sort((a, b) => b.plays - a.plays || b.last - a.last).slice(0, Math.min(Math.max(1, limit), 100))
      .map((r) => ({ plays: r.plays, title: r.title, album: r.album, artist: r.artist, last_played: localTime(r.last) }));
    return { what, plays_counted: counted, plays_in_roon: out.total ?? null, from: earliest ? localTime(earliest) : null, rows };
  });
}
