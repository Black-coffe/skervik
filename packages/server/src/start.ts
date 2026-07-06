// @skervik/server — the process entry point (the `start` npm script runs
// `node dist/start.js`). Thin wrapper over `startServer()`: boot the real
// HTTP+WS server from env config and keep the process alive. All wiring lives
// in `boot.ts`; this file exists only so tsup emits a runnable `dist/start.js`.
import { startServer } from './boot.js';

void startServer().catch((error: unknown) => {
  console.error('[skervik/server] failed to start:', error);
  process.exitCode = 1;
});
