// The part of the client Deep Roon MCP uses (see README.md here): the connection with the Core, search, playback and
// the play history. The ~1550 generated, untried method wrappers of the original aren't included.
export { RoonClient, RoonClientOptions } from './proto/client';
export { RoonObject, isRef } from './proto/objects';
export { CallResult } from './proto/remoting';
export { exportPlayHistory, HistoryEvent, HistoryExportResult } from './history-export';
