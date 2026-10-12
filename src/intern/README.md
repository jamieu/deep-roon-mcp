# src/intern — Roon's internal protocol

The core of Arthur Soares' [roon-api-reverse-engineering](https://github.com/arthursoares/roon-api-reverse-engineering)
(MIT, see `LICENSE` here): a TypeScript client for the protocol between Roon's own apps and the Core — plain TCP on
port 9332, the binary `Sooloos.Broker.Remoting`. Copied from commit `8b67208` (v0.1.1, 1 Oct 2026).

**What's here:** `proto/` (connection, frames, remoting, object graph, serialisation, the client),
`catalog/signature.ts`, `generated/struct-schemas.ts`, `history-export.ts`. Not included: the ~1550 generated method
wrappers, the method catalogue, the examples and tests. `index.ts` and this file are ours.

**Changed from the original:**
- `proto/objects.ts`: a `DataList<T>` by value (an album's labels and genres) is decoded instead of coming back empty.
- `proto/remoting.ts`, `proto/client.ts`: a PING every 10 s while connected — the Core drops a session that sent
  nothing for 30–35 s ("no keepalive … reaping dead peer").

**Roon Labs on this protocol:** it's internal and changes freely (every Roon update can break it), it's *"not hardened
for 3rd party use"*, and misuse can leak memory or CPU in the Core. Hence short connections, one at a time, and
requests one after another.
