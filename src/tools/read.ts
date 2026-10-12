// The read-only tools: search, Qobuz's shelves and genres, album pages, reviews, biographies, discographies, zones,
// what plays, and the play history. Nothing here changes anything in Roon.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as lib from '../roon/library';
import * as hist from '../roon/history';
import * as zn from '../roon/zones';
import { run } from './run';

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const limit = (max: number, dflt: number) => z.number().int().min(1).max(max).optional().describe(`How many (default ${dflt}, at most ${max}).`);

export function registerReadTools(server: McpServer): void {
  server.registerTool('roon_search', {
    title: 'Search Roon',
    description: 'Search Roon — the user\'s Roon library and the whole Qobuz catalogue at once. Returns albums (with format, e.g. FLAC 96kHz 24bit), artists and tracks. `kind` narrows to album, track or artist — use `kind: "track"` with the song title (and artist) to find one specific track; a broad query without `kind` can fill up with artists. Albums and tracks carry a `key` for `roon_album`; artists carry a `key` for `roon_artist` and `roon_bio`. Albums say their `year`, and `in_library` when the user has them in Roon. Keys stay valid between calls.',
    inputSchema: { query: z.string().min(1), kind: z.enum(['album', 'track', 'artist']).optional(), limit: limit(100, 30) },
    annotations: READ,
  }, ({ query, kind, limit: n }) => run(() => lib.search(query, n ?? 30, kind)));

  server.registerTool('roon_new', {
    title: 'Qobuz shelves in Roon',
    description: 'Qobuz\'s editorial shelves as Roon shows them (the same for everyone): `new` (new albums), `qobuzissimes`, `press_awards`, `top`, `trending`, `ideal_discography`. Albums carry their format and a `key` for `roon_album`. `genre` narrows a shelf to one or more Qobuz genres — ids from `roon_genres`; use it for "new jazz", "what\'s new in classical". `offset` pages through the shelf; `total` says how many there are.',
    inputSchema: {
      section: z.enum(['new', 'qobuzissimes', 'press_awards', 'top', 'trending', 'ideal_discography']).optional(),
      genre: z.string().regex(/^\s*\d+(\s*,\s*\d+)*\s*$/, 'Qobuz genre ids (numbers), comma-separated — see roon_genres').optional().describe('Qobuz genre id(s) from roon_genres, comma-separated.'),
      limit: limit(100, 30), offset: z.number().int().min(0).optional(),
    },
    annotations: READ,
  }, ({ section, genre, limit: n, offset }) => run(() => lib.section(section ?? 'new', n ?? 30, offset ?? 0, (genre ?? '').split(',').map((x) => x.trim()).filter(Boolean))));

  server.registerTool('roon_genres', {
    title: 'Qobuz genres',
    description: 'The genres of Qobuz with their ids, for the `genre` filter of `roon_new`. Without `parent`: the main genres (names as Qobuz gives them in the account\'s language). With `parent` (a genre id): its sub-genres, e.g. the kinds of jazz.',
    inputSchema: { parent: z.string().optional().describe('A genre id, to list its sub-genres.') },
    annotations: READ,
  }, ({ parent }) => run(() => lib.genres(parent)));

  server.registerTool('roon_album', {
    title: 'Album page',
    description: 'One album in Roon, by its `key` (from roon_search, roon_new, roon_artist): the album with year, format, label and whether it is in the library, its genres, release date (and the date of this edition), barcode and — when Roon has them — catalogue number and country, its main artist(s) with a `key` for `roon_artist` / `roon_bio`, and every track with its own `key`. A Qobuz album that is also in the library comes back as the library copy (its key may differ; both work). `credits: true` adds who played, produced, engineered and wrote, grouped by role — Roon\'s own data.',
    inputSchema: { key: z.string().describe('An album key.'), credits: z.boolean().optional() },
    annotations: READ,
  }, ({ key, credits }) => run(() => lib.album(key, credits === true)));

  server.registerTool('roon_review', {
    title: 'Album review',
    description: 'The review Roon shows on an album\'s page, in full, with its author — by album `key`. When the user asks for the review ("what does Roon say about this album", "show me the review"), they want to read the review itself: show the text complete and exactly as returned, as a quote with the author\'s name — no paraphrase or shortening unless they ask for a summary, and don\'t go to the web for it. `wikipedia: true` adds the album\'s Wikipedia text; it also comes by itself when Roon has no review of its own. `max_chars` only when a shorter excerpt is asked for.',
    inputSchema: { key: z.string().describe('An album key.'), wikipedia: z.boolean().optional(), max_chars: z.number().int().min(200).optional() },
    annotations: READ,
  }, ({ key, wikipedia, max_chars }) => run(() => lib.review(key, max_chars ?? 1e9, wikipedia === true)));

  server.registerTool('roon_bio', {
    title: 'Artist biography',
    description: 'The biography Roon shows on an artist\'s page, in full, with its author — by artist `key` — plus where they are from, active since, genres, and the related artists Roon lists: `similar`, `influenced_by`, `influenced`, `worked_with`, `member_of`, `members`, each with a `key` for `roon_artist` / `roon_bio`. When the user asks for the bio ("who is …", "tell me about this artist"), show the text complete and exactly as returned, with the author\'s name — no paraphrase or shortening unless they ask for a summary. For a narrower question ("who influenced them") answer from the lists. `wikipedia: true` adds the Wikipedia text; `max_chars` only when a shorter excerpt is asked for.',
    inputSchema: { key: z.string().describe('An artist key.'), wikipedia: z.boolean().optional(), max_chars: z.number().int().min(200).optional() },
    annotations: READ,
  }, ({ key, wikipedia, max_chars }) => run(() => lib.bio(key, max_chars ?? 1e9, wikipedia === true)));

  server.registerTool('roon_artist', {
    title: 'Discography',
    description: 'An artist\'s discography in Roon: the main albums Qobuz has, oldest first, each with year, format and a `key` for `roon_album`. The artist `key` comes from roon_search (`kind: "artist"`) or from the `artists` of roon_album. Use this for "the album before/after …", "their debut", "what else did they make" — don\'t answer discography questions from memory. The year is the original release where Roon knows it; reissues and compilations are in the list too.',
    inputSchema: { key: z.string().describe('An artist key.') },
    annotations: READ,
  }, ({ key }) => run(() => lib.discography(key)));

  server.registerTool('roon_zones', {
    title: 'Roon zones',
    description: 'The zones Roon can play on (Roon\'s own names), and which are grouped right now (`groups`).',
    inputSchema: {},
    annotations: READ,
  }, () => run(() => zn.zones()));

  server.registerTool('roon_now_playing', {
    title: 'Now playing in Roon',
    description: 'What plays in Roon, per zone: state (playing, loading, paused, stopped), the track with album, artist and format, the position, how many tracks are left in the queue, shuffle, repeat, Roon Radio and a sleep timer. Read this before saying anything about what Roon plays — it changes all the time.',
    inputSchema: {},
    annotations: READ,
  }, () => run(() => zn.nowPlaying()));

  server.registerTool('roon_history', {
    title: 'Play history',
    description: 'What was played in Roon, newest first — Roon\'s own play history, with how much of each track was heard. For "most played" questions use roon_top instead of counting this.',
    inputSchema: { limit: limit(300, 30) },
    annotations: READ,
  }, ({ limit: n }) => run(() => hist.history(n ?? 30)));

  server.registerTool('roon_top', {
    title: 'Most played',
    description: 'The most played albums, artists or tracks in Roon, counted over the WHOLE play history (a play counts when at least half the track was heard). Use this for "most listened" questions — don\'t tally roon_history yourself. `since` (YYYY-MM-DD) limits the period.',
    inputSchema: { what: z.enum(['albums', 'artists', 'tracks']).optional(), limit: limit(100, 20), since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Only plays from this date on (YYYY-MM-DD).') },
    annotations: READ,
  }, ({ what, limit: n, since }) => run(() => hist.top(what ?? 'albums', n ?? 20, since)));
}
