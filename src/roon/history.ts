// Roon's own play history (Library::VirtualHistoryQuery, through src/intern/history-export) and the top lists counted
// over all of it. The export wants a graph without earlier plays: a fresh connection, closed again afterwards.
import { exportPlayHistory } from '../intern';
import { withCore, fresh, closeSoon } from '../core/session';
import { Any, clean, field, imageKey, localTime, obj } from './graph';
import { findTracks } from './library';

// The whole history in pages of 500 within a time budget (0.5.1, a forum tester: "play history only goes back to July 2024,
// my Roon remote shows 2015"): roon_history took the newest 500 and roon_top the newest 20,000. A history since 2015 can
// be far longer; what doesn't fit in the budget is said, not hidden.
const PAGE = 500, BUDGET_MS = 45_000;
const at = (e: { playedAt: string }) => Date.parse(e.playedAt);

export async function history(limit: number, offset = 0, before?: string) {
  return withCore(async (first) => {
    const c = first.graph.findByType('HistoryPlay').length > 0 ? await fresh() : first;
    const n = Math.min(Math.max(0, limit), 500), skip = Math.max(0, offset);
    const cutoff = before ? Date.parse(before) : null;
    // `before` goes to Roon itself (MaxPlayDate): the query starts at that date, however far back.
    const all = await exportPlayHistory(c, { limit: skip + n, pageSize: PAGE, timeoutMs: 15_000, deadline: Date.now() + BUDGET_MS,
      maxDate: cutoff === null ? undefined : new Date(cutoff) });
    const picked = (cutoff === null ? all.events : all.events.filter((e) => at(e) < cutoff)).slice(skip, skip + n);
    const out = { ...all, events: picked };
    // The album and its cover per play (13 Oct 2026, Rosso's history): the tracks by their keys, in one question — at most
    // a hundred, the newest first; a key Roon no longer knows is skipped.
    const keys = [...new Set(out.events.map((e) => e.roonTrackId).filter((k): k is string => !!k))].slice(0, 100);
    const byKey = new Map<string, Any>();
    if (keys.length) {
      const tracks = await findTracks(c, keys, true).catch(() => [] as Any[]);
      for (const t of tracks) if (t) byKey.set(String(field(t, 'TrackId')), t);
    }
    closeSoon('after the history');
    const oldest = all.events.length ? localTime(at(all.events[all.events.length - 1])) : null;
    return {
      total: out.total ?? null,
      // When the budget ran out before the asked plays: how far back it got (a smaller offset or a later `before` helps).
      note: all.complete === false && picked.length < n ? `Roon's history is long: this reached back to ${oldest} within the time — ask with a \`before\` date to start further back.` : undefined,
      plays: out.events.map((e) => {
        const r: Any = { at: localTime(e.playedAt), title: e.title, artist: clean(e.artist), album: e.album ?? undefined, played_pct: e.completionPct ?? undefined, track_key: e.roonTrackId ?? undefined };
        const t = e.roonTrackId ? byKey.get(e.roonTrackId) : undefined;
        if (t) { const al = obj(c, field(t, 'Album')); const ak = field(al, 'AlbumId'); if (ak !== undefined && ak !== null) r.album_key = String(ak); const img = imageKey(c, al); if (img) r.image = img; }
        return r;
      }),
    };
  });
}

/** Most played albums, artists or tracks over the whole history; a play counts when at least half was heard. */
export async function top(what: 'albums' | 'artists' | 'tracks', limit: number, since?: string) {
  return withCore(async (first) => {
    const c = first.graph.findByType('HistoryPlay').length > 0 ? await fresh() : first;
    const from = since ? Date.parse(since) : null;
    // The whole history (no longer the newest 20,000); with `since` it stops at the first page older than that date.
    const out = await exportPlayHistory(c, { limit: Number.MAX_SAFE_INTEGER, pageSize: PAGE, timeoutMs: 15_000, deadline: Date.now() + BUDGET_MS,
      minDate: from === null ? undefined : new Date(from) });
    closeSoon('after the history');
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
    const reachedAll = out.complete !== false;
    return { what, plays_counted: counted, plays_in_roon: out.total ?? null, from: earliest ? localTime(earliest) : null,
      note: reachedAll ? undefined : `Counted back to ${earliest ? localTime(earliest) : '?'} — Roon's history goes further, but the rest didn't fit in the time. Use \`since\` for a period.`,
      rows };
  });
}
