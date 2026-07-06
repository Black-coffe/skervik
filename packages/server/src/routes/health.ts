// @skervik/server — the readiness probe (S1.7.1). A no-auth `GET /health` that
// a load balancer / orchestrator polls to know the process is up and serving
// HTTP. Machine-shaped JSON (`{ status: 'ok' }`), never a translated string.
import type { FastifyInstance } from 'fastify';

/** Register `GET /health` → `200 { status: 'ok' }` on the given Fastify instance. */
export function registerHealthRoute(fastify: FastifyInstance): void {
  fastify.get('/health', () => ({ status: 'ok' as const }));
}
