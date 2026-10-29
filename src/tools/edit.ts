// Fork (Jamie Unwin, 29 Oct 2026): an album's credits and version group. They change the library through Roon's internal
// protocol: left out with DEEP_ROON_READ_ONLY (index.ts, LIBRARY_WRITES).
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as ed from '../roon/edit';
import { run } from './run';

// Changes the user's library: clients may ask for confirmation.
const CHANGES = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export function registerEditTools(server: McpServer): void {
  server.registerTool('roon_album_credit', {
    title: 'A credit on an album',
    description: 'Put a credit on an album in the library — an artist in a role ("Piano", "Producer", "Drums" …) — or take one off (`on: false`). `key` is the album; `artist` an artist key (roon_search with kind artist) — Roon must know the artist; to take a credit off, the name as the album\'s credits show it works too. Use a role Roon knows, as roon_album shows them with `credits: true`: Roon drops one it doesn\'t. Changes the library: only on an explicit request. Reads the credits back and says if Roon didn\'t change them.',
    inputSchema: { key: z.string().describe('An album key (in the library).'), artist: z.string().describe('An artist key, or (to take a credit off) the name.'), role: z.string().min(1), on: z.boolean().optional() },
    annotations: CHANGES,
  }, ({ key, artist, role, on }) => run(() => ed.albumCredit(key, artist, role, on !== false)));

  server.registerTool('roon_versions_group', {
    title: 'Group album versions',
    description: 'Group albums in the library as versions of one album, as Roon\'s Edit › Group alternate versions does — for copies Roon didn\'t group itself (a local rip and the Qobuz edition, a remaster …). `keys`: two or more album keys; the FIRST becomes the primary version, the one Roon shows, and the others go in its group — unless the first is already a version in a group: then that group\'s primary stays the primary and the others join it (roon_versions marks a group\'s primary with `primary: true`; changing which copy is primary isn\'t done here). An album taken out of one of Roon\'s own groups goes back into it. About album versions, not zones (that\'s roon_group). Changes the library: only on an explicit request, after roon_versions. Reads the group back.',
    inputSchema: { keys: z.array(z.string()).min(2).max(20).describe('Album keys; the first is the primary version.') },
    annotations: CHANGES,
  }, ({ keys }) => run(() => ed.groupVersions(keys)));

  server.registerTool('roon_versions_ungroup', {
    title: 'Ungroup an album version',
    description: 'Take one album out of its version group, so Roon shows it on its own again — also out of a group Roon made itself. `key`: the version to take out, not the primary (roon_versions marks the albums in the group with `grouped`). About album versions, not zones (that\'s roon_ungroup). Changes the library: only on an explicit request. Reads it back.',
    inputSchema: { key: z.string().describe('An album key: a version in a group.') },
    annotations: CHANGES,
  }, ({ key }) => run(() => ed.ungroupVersion(key)));
}
