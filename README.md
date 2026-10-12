# Deep Roon MCP

The parts of Roon the official API doesn't reach, for Claude and any other MCP client: the reviews and biographies Roon
shows, search across your library and Qobuz at once, Qobuz's editorial shelves, album pages with credits, artist
discographies, and your own play history with real "most played" counts.

> **Read this first.** Deep Roon MCP is unofficial. It uses Roon's internal protocol, through Arthur Soares'
> [roon-api-reverse-engineering](https://github.com/arthursoares/roon-api-reverse-engineering), which Roon Labs allows
> for personal use. Brian Luczkiewicz (Roon Labs) on that protocol: it is *"not hardened for 3rd party use"* — keep port
> 9332 on your own network, never forward it to the internet. A Roon update can break a tool until Deep Roon MCP is
> updated. It is not made or supported by Roon Labs.

**What stays at home.** Deep Roon MCP runs on your computer and talks to your Roon Core over your own network. It has no
server of its own and sends nothing anywhere else. What you ask goes to your MCP client's model like any other question.

## Status

Version 0.1 (in progress). Library, playlists, Focus, Home (Daily Picks, mixes) and DSP follow.

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
| `roon_zones` | Roon's zones and groups |
| `roon_now_playing` | What plays in each zone, with the volume |
| `roon_queue` | A zone's queue |
| `roon_cover` | The cover of what plays, as an image |
| `roon_history` | Roon's play history, newest first |
| `roon_top` | Most played albums, artists or tracks over your whole history |

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

## Install

Requires Node 18 or newer and a Roon Core on the same network.

```sh
npm install -g deep-roon-mcp        # not published yet — for now: build from source, below
```

**Claude Code:** `claude mcp add deep-roon -- deep-roon-mcp`

**Claude Desktop and other clients** (Cursor, VS Code, LM Studio …) — add to the client's MCP configuration:

```json
{
  "mcpServers": {
    "deep-roon": { "command": "deep-roon-mcp" }
  }
}
```

**Once, in Roon:** Settings › Extensions › Enable next to "Deep Roon MCP". Until then the tools say so. The pairing is kept
in your own configuration folder (on a Mac `~/Library/Application Support/deep-roon-mcp`).

Deep Roon MCP finds the Core on your network by itself. When it can't — another subnet, a VPN such as Tailscale — set
`ROON_HOST` to the Core's address (`"env": { "ROON_HOST": "192.168.1.20" }` in the configuration above). Over a VPN, only
ever a private one.

### From source

```sh
git clone https://github.com/renebouwmeester/deep-roon-mcp
cd deep-roon-mcp && npm install && npm run build
# then use: node /path/to/deep-roon-mcp/dist/deep-roon-mcp.js
```

## How it behaves

- Short connections, as Roon Labs asked: opened for a question, closed after two minutes of quiet, one at a time, questions
  one after another; a PING every 10 s while open, so the Core doesn't drop the session.
- Album, track and artist keys stay valid between calls.
- The log goes to stderr (your MCP client keeps it).

## Credits

Arthur Soares for the protocol work (MIT, in `src/intern`). Roon Labs for allowing it.

## License

Apache 2.0 — see `LICENSE` and `NOTICE`. Roon is a trademark of Roon Labs LLC; Qobuz of Xandrie SA.
