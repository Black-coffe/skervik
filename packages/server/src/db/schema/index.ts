// @skervik/server — schema barrel (S2.6.1). The single import surface
// `db/client.ts` and every repository read the table definitions through.
export { matches, type MatchStatus } from './matches.js';
export { type MatchPlayerResult, matchPlayers } from './matchPlayers.js';
export { type AuthProvider, users } from './users.js';
