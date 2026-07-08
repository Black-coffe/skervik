// S1.7.2 Phase B — the deterministic scripted TEST driver seat. `decideAction`
// used to live here; S2.4.1 MOVED it (behavior-preserving) to `@skervik/bots`
// as the canonical v0 bot brain (`packages/bots/src/heuristic/v0.ts`), since
// "what a client does" and "what a bot decides" are the same seam. This file
// re-exports it unchanged so `scriptedDriver.test.ts` and the socket E2E
// suites (which import `decideAction` from here) keep working byte-identical
// — the S1.7.2 determinism/termination gate is the proof the move preserved
// behavior.
export { decideAction } from '@skervik/bots';
