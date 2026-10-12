# Deep Roon MCP

The parts of Roon the official API doesn't reach, for Claude and any other MCP client: the reviews and biographies Roon
shows, search across your library and Qobuz at once, Qobuz's editorial shelves, album pages with credits, artist
discographies, and your own play history with real "most played" counts.

> **Read this first.** Deep Roon MCP is unofficial: it is not made, endorsed or supported by Roon Labs. It uses Roon's
> internal protocol — the one Roon's own apps use — through Arthur Soares'
> [roon-api-reverse-engineering](https://github.com/arthursoares/roon-api-reverse-engineering), which Roon Labs allows
> for tinkering with your own system. Brian Luczkiewicz (Roon Labs) on that protocol: it is *"not hardened for 3rd party
> use"*, it can change with any Roon update, and misuse can cause memory or compute leaks in the Core. Read
> [Arthur's thread on the Roon Community](https://community.roonlabs.com/t/reverse-engineering-the-roon-desktop-clients-local-protocol-typescript-client-docs/321731)
> before you use it.
>
> **Use it entirely at your own risk.** It comes without any warranty (see the licence). If your Core misbehaves, quit
> Deep Roon MCP and restart the Core. Report problems here, not to Roon's support. Keep port 9332 on your own network,
> never forward it to the internet. A Roon update can break a tool until Deep Roon MCP is updated. With the internal
> protocol switched off (see the settings below) only Roon's official extension API is used.

**What stays at home.** Deep Roon MCP runs on your computer and talks to your Roon Core over your own network. It has no
server of its own and sends nothing anywhere else. What you ask goes to your MCP client's model like any other question.

## Status

Version 0.1: fifty tools.

**Reading** — changes nothing in Roon:

| Tool | What it does |
|---|---|
| `roon_search` | Your library and Qobuz at once: albums (with format), artists, tracks |
| `roon_new` | Qobuz's shelves: new, qobuzissimes, press awards, top, trending, ideal discography — by genre |
| `roon_genres` | Qobuz's genres and their ids |
| `roon_album` | An album's page: tracks, release dates, label, barcode, credits |
| `roon_review` | The review Roon shows, in full, with its author |
| `roon_bio` | The biography Roon shows, in full, with related artists |
| `roon_artist` | An artist's discography, oldest first |
| `roon_status` | How Deep Roon MCP stands: Core, pairing, internal protocol, self-test, newer version |
| `roon_zones` | Roon's zones and groups |
| `roon_now_playing` | What plays in each zone, with the volume |
| `roon_queue` | A zone's queue |
| `roon_cover` | The cover of what plays, as an image |
| `roon_history` | Roon's play history, newest first |
| `roon_top` | Most played albums, artists or tracks over your whole history |
| `roon_library` | Your library with Roon's Focus: stars, genre, label, artist, composer, producer, years, hi-res, live … sorted any way |
| `roon_focus` | The Focus panel: what your library (or part of it) is made of, with counts |
| `roon_tracks`, `roon_artists` | Focus on tracks and artists (and composers) |
| `roon_works`, `roon_work` | Compositions, and one work with its description and your recordings of it |
| `roon_daily_picks` | Today's Daily Picks from Roon's Home, with why |
| `roon_new_for_you` | New releases Roon picked for you |
| `roon_mixes` | Today's Daily Mixes |
| `roon_playlists`, `roon_playlist` | Your playlists, and one playlist's tracks |
| `roon_favorites` | Albums with a heart in Roon, or your Qobuz favourites |
| `roon_listen_later` | Your Listen Later list |
| `roon_versions` | Other versions of an album: remasters, hi-res, in your library and at Qobuz |
| `roon_similar` | More like this, for an album or an artist |
| `roon_signal_path` | Roon's signal path for what plays: is it bit-perfect, what happens on the way |
| `roon_dsp` | MUSE: the DSP set up for a zone |

**Playing** — only on your request:

| Tool | What it does |
|---|---|
| `roon_play` | An album on a zone: now, next or at the end of the queue, optionally shuffled |
| `roon_play_tracks` | Your own running order of tracks |
| `roon_control` | Pause, play, stop, next, previous |
| `roon_seek` | A position in the playing track |
| `roon_volume` | A zone's volume, mute |
| `roon_settings` | Shuffle, repeat, Roon Radio |
| `roon_queue_clear` | Clear what comes after the playing track (or everything) |
| `roon_transfer` | Move what plays, with its queue, to another zone |
| `roon_group`, `roon_ungroup` | Group zones, and undo it |
| `roon_sleep` | A sleep timer |
| `roon_standby` | Put a device in standby, or wake it |
| `roon_play_playlist` | A playlist on a zone, optionally shuffled |
| `roon_play_mix` | One of today's Daily Mixes |

**Changing your library or sound** — only on your request; each one reads the result back and says if Roon didn't follow:

| Tool | What it does |
|---|---|
| `roon_favorite` | A heart on an album or track, or off |
| `roon_listen_later_set` | On or off the Listen Later list |
| `roon_library_add` | A Qobuz album into your library |
| `roon_playlist_create` | A new playlist from tracks |
| `roon_dsp_set` | MUSE on or off, one part on or off, or a preset |

## Install

Deep Roon MCP runs on a computer on the same network as your Roon Core (Mac, Windows or Linux), next to your MCP client.

### Claude Desktop — one click

1. Download **`deep-roon-mcp-<version>.mcpb`** from the [latest release](https://github.com/renebouwmeester/deep-roon-mcp/releases/latest).
2. Open it (double-click, or drag it onto Claude Desktop's Settings › Extensions). Claude Desktop shows the tools and the
   settings; click Install. It runs on Claude Desktop's own Node — nothing else to install.
3. **In Roon:** Settings › Extensions › **Enable** next to "Deep Roon MCP". Once.
4. Ask something: "What's new on Qobuz in jazz?", "Show me Roon's review of Kind of Blue", "Play Spirit of Eden in the
   living room".

The settings (Claude Desktop › Settings › Extensions › Deep Roon MCP):

| Setting | What it does |
|---|---|
| Roon Core address | Empty: found on your network. Fill in the Core's address for another subnet or a private VPN (Tailscale) |
| Essentials only | Seventeen tools instead of fifty, for small models |
| Use Roon's internal protocol | Off: only the official API — zones, playback, volume, grouping; no search, reviews, Focus or history |

### Other clients

Needs [Node.js](https://nodejs.org) 18 or newer. The package runs straight from npm with `npx`:

**Claude Code**

```sh
claude mcp add deep-roon -- npx -y deep-roon-mcp
```

**Cursor, VS Code, Windsurf, Cline, LM Studio, Claude Desktop by hand …** — in the client's MCP configuration:

```json
{
  "mcpServers": {
    "deep-roon": {
      "command": "npx",
      "args": ["-y", "deep-roon-mcp"],
      "env": { "ROON_HOST": "", "DEEP_ROON_TOOLS": "", "DEEP_ROON_INTERNAL": "" }
    }
  }
}
```

The same three settings as environment variables: `ROON_HOST` (the Core's address, empty = find it), `DEEP_ROON_TOOLS=essentials`,
`DEEP_ROON_INTERNAL=off`. Leave out what you don't need. VS Code calls the block `"servers"` instead of `"mcpServers"`.

Then, once, in Roon: Settings › Extensions › **Enable** next to "Deep Roon MCP". Until then the tools say so.

### From source

```sh
git clone https://github.com/renebouwmeester/deep-roon-mcp
cd deep-roon-mcp && npm install && npm run build
# then use: node /path/to/deep-roon-mcp/dist/deep-roon-mcp.js
```

## When something's wrong

**"No Roon Core found" on a Mac:** macOS asks once whether the app may use the local network — for Claude Desktop that's
Claude and Claude Helper. Allow both (System Settings › Privacy & Security › Local Network), then try again.

Ask your client to run **`roon_status`**: the Core it found, whether it's enabled in Roon, whether the internal protocol
works, and a self-test of a few reads with the tools each stands for. After a Roon update a tool may break until Deep Roon
MCP is updated — the first answer says so when a newer version is out. Issues:
[github.com/renebouwmeester/deep-roon-mcp/issues](https://github.com/renebouwmeester/deep-roon-mcp/issues) (paste the
status; it holds no secrets).

## How it behaves

- Short connections, as Roon Labs asked: opened for a question, closed after two minutes of quiet, one at a time, questions
  one after another; a PING every 10 s while open, so the Core doesn't drop the session.
- Album, track and artist keys stay valid between calls.
- The log goes to stderr (your MCP client keeps it).
- At the start it asks GitHub once whether a newer release is out (`DEEP_ROON_NO_UPDATE_CHECK=1` turns that off). Nothing
  else leaves your network except what your client sends to its model.
- The pairing with Roon is kept in your configuration folder (Mac `~/Library/Application Support/deep-roon-mcp`, Windows
  `%APPDATA%\deep-roon-mcp`, Linux `~/.config/deep-roon-mcp`).

## Credits

Arthur Soares for the protocol work (MIT, in `src/intern`). Roon Labs for allowing it.

## License

Apache 2.0 — see `LICENSE` and `NOTICE`. Roon is a trademark of Roon Labs LLC; Qobuz of Xandrie SA.
